// ============================================================================
// Grapheme utilities — Unicode-correct text segmentation
//
// JavaScript strings index by UTF-16 code units, which doesn't match what
// humans think of as "characters". A single emoji like 🏳️‍⚧️ is 5 code points /
// 14 UTF-16 code units but renders as 1 grapheme cluster that occupies 2
// terminal columns. CJK characters (Chinese / Japanese / Korean) are typically
// 1 code unit but occupy 2 terminal columns.
//
// For cursor editing we want:
// - cursor movement to step by graphemes (one visible "character" at a time)
// - rendering to track visual columns (what the terminal shows)
// - slicing to use code-unit indices (what String.prototype.slice() expects)
//
// This module unifies those three spaces. Everything that takes a cursor
// position in PromptInput / vim motions / vim operators uses a grapheme index;
// we convert to code-unit only at the seam where we call value.slice().
// ============================================================================

import stringWidth from "string-width";

// Intl.Segmenter is built into V8 / JavaScriptCore / Bun — no polyfill needed.
// Cache per-locale segmenters. We pin to "en" for grapheme granularity because
// the segmentation rules are locale-invariant for graphemes (UAX #29).
const graphemeSegmenter = new Intl.Segmenter("en", { granularity: "grapheme" });
const wordSegmenter = new Intl.Segmenter("en", { granularity: "word" });

/**
 * Split a string into its grapheme clusters (what users perceive as one
 * "character"). Each returned element may be 1+ code units.
 */
export function splitGraphemes(text: string): string[] {
  if (!text) return [];
  const out: string[] = [];
  for (const seg of graphemeSegmenter.segment(text)) {
    out.push(seg.segment);
  }
  return out;
}

/**
 * Convert a grapheme index to the corresponding UTF-16 code-unit index in
 * the original string. Safe for any index 0..graphemeCount (end-position
 * allowed for slicing).
 */
export function graphemeToCodeUnit(text: string, graphemeIdx: number): number {
  if (graphemeIdx <= 0) return 0;
  let count = 0;
  for (const seg of graphemeSegmenter.segment(text)) {
    if (count === graphemeIdx) return seg.index;
    count++;
  }
  return text.length;
}

/**
 * Convert a code-unit index to the corresponding grapheme index. Points
 * within a grapheme cluster snap to the cluster's start.
 */
export function codeUnitToGrapheme(text: string, codeUnit: number): number {
  if (codeUnit <= 0) return 0;
  let idx = 0;
  for (const seg of graphemeSegmenter.segment(text)) {
    if (seg.index >= codeUnit) return idx;
    idx++;
  }
  return idx;
}

/**
 * Count grapheme clusters in a string.
 */
export function graphemeCount(text: string): number {
  if (!text) return 0;
  let n = 0;
  // Note: using the iterator directly avoids allocating an array.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  for (const _ of graphemeSegmenter.segment(text)) n++;
  return n;
}

/**
 * Visual width of text in terminal columns. CJK and emoji are 2 columns,
 * ASCII is 1, combining marks are 0.
 */
export function visualWidth(text: string): number {
  if (!text) return 0;
  return stringWidth(text);
}

/**
 * Iterate word segments (UAX #29 word-break) that are word-like. Used for
 * vim w/b/e motions. Each segment reports { index, segment, isWordLike }.
 *
 * Returns an array of { start, end } code-unit ranges for word-like segments
 * only (whitespace and punctuation runs are excluded).
 */
export function wordSegments(text: string): Array<{ start: number; end: number }> {
  if (!text) return [];
  const ranges: Array<{ start: number; end: number }> = [];
  for (const seg of wordSegmenter.segment(text)) {
    // isWordLike is present on Intl.Segmenter output in modern engines.
    const isWord = (seg as { isWordLike?: boolean }).isWordLike ?? false;
    if (isWord) {
      ranges.push({ start: seg.index, end: seg.index + seg.segment.length });
    }
  }
  return ranges;
}
