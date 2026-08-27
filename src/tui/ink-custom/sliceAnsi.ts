// sliceAnsi — OSC-8-hyperlink-safe, combining-mark-safe horizontal slicer.
//
// Ported from Claude Code's src/utils/sliceAnsi.ts. Replaces the npm
// `slice-ansi` package on the ink-custom clip path (outputTarget.ts). npm
// slice-ansi has no OSC 8 awareness, so clipping a line that carries a
// terminal hyperlink (Gordon emits these via hyperlinkPool.ts /
// design-system/Link.tsx) corrupts the `ESC]8;;URL ST` sequence and
// miscounts width; it also mis-slices zero-width combining marks. This
// slicer tokenizes with @alcalzone/ansi-tokenize (already used by
// outputTarget.ts) so OSC 8 opens/closes are threaded through the slice and
// display width is measured in cells, not code units.

import {
  type AnsiCode,
  ansiCodesToString,
  reduceAnsiCodes,
  tokenize,
  undoAnsiCodes,
} from "@alcalzone/ansi-tokenize";
import stringWidth from "string-width";

// A code is an "end code" if its code equals its endCode (e.g. hyperlink close).
function isEndCode(code: AnsiCode): boolean {
  return code.code === code.endCode;
}

// Filter to only include "start codes" (not end codes).
function filterStartCodes(codes: AnsiCode[]): AnsiCode[] {
  return codes.filter((c) => !isEndCode(c));
}

/**
 * Slice a string containing ANSI escape codes.
 *
 * Unlike the slice-ansi package, this properly handles OSC 8 hyperlink
 * sequences because @alcalzone/ansi-tokenize tokenizes them correctly.
 */
export default function sliceAnsi(str: string, start: number, end?: number): string {
  // Don't pass `end` to tokenize — it counts code units, not display cells,
  // so it drops tokens early for text with zero-width combining marks.
  const tokens = tokenize(str);
  let activeCodes: AnsiCode[] = [];
  let position = 0;
  let result = "";
  let include = false;

  for (const token of tokens) {
    // Advance by display width, not code units. Combining marks (Devanagari
    // matras, virama, diacritics) are width 0 — counting them via .length
    // advanced position past `end` early and truncated the slice. Callers
    // pass start/end in display cells (via stringWidth), so position must
    // track the same units.
    const width = token.type === "ansi" ? 0 : token.fullWidth ? 2 : stringWidth(token.value);

    // Break AFTER trailing zero-width marks — a combining mark attaches to
    // the preceding base char, so "भा" (भ + ा, 1 display cell) sliced at
    // end=1 must include the ा. Breaking on position >= end BEFORE the
    // zero-width check would drop it and render भ bare. ANSI codes are
    // width 0 but must NOT be included past end (they open new style runs
    // that leak into the undo sequence), so gate on char type too. The
    // !include guard ensures empty slices (start===end) stay empty even
    // when the string starts with a zero-width char (BOM, ZWJ).
    if (end !== undefined && position >= end) {
      if (token.type === "ansi" || width > 0 || !include) break;
    }

    if (token.type === "ansi") {
      activeCodes.push(token);
      if (include) {
        // Emit all ANSI codes during the slice.
        result += token.code;
      }
    } else {
      if (!include && position >= start) {
        // Skip leading zero-width marks at the start boundary — they belong
        // to the preceding base char in the left half. Without this, the
        // mark appears in BOTH halves: left+right !== original. Only applies
        // when start > 0 (otherwise there's no preceding char to own it).
        if (start > 0 && width === 0) continue;
        include = true;
        // Reduce and filter to only active start codes.
        activeCodes = filterStartCodes(reduceAnsiCodes(activeCodes));
        result = ansiCodesToString(activeCodes);
      }

      if (include) {
        result += token.value;
      }

      position += width;
    }
  }

  // Only undo start codes that are still active.
  const activeStartCodes = filterStartCodes(reduceAnsiCodes(activeCodes));
  result += ansiCodesToString(undoAnsiCodes(activeStartCodes));
  return result;
}
