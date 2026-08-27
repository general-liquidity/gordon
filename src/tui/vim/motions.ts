// ============================================================================
// Vim Motions — Cursor movement commands (h, l, w, b, e, 0, $, ^)
//
// All positions are GRAPHEME INDICES, not UTF-16 code units. This lets
// motions work correctly on CJK text and emoji: `h` always moves one visible
// "character" left, never landing mid-surrogate-pair or mid-emoji-ZWJ-sequence.
//
// Word motions (w/b/e) use Intl.Segmenter's Unicode word-break rules which
// treat each CJK ideograph as its own word — matching how vim in a locale-
// aware build behaves. ASCII word-like runs remain single units.
// ============================================================================
//
// Contract: input text is the raw buffer, input cursor is a grapheme index in
// [0, graphemeCount(text)]. Output is a clamped grapheme index. Callers
// convert to code-units via graphemeToCodeUnit when slicing.

import { splitGraphemes, wordSegments, codeUnitToGrapheme } from "../utils/graphemes.js";

export function applyMotion(text: string, cursor: number, motion: string, count = 1): number {
  const graphemes = splitGraphemes(text);
  const len = graphemes.length;
  if (len === 0) return 0;

  let pos = Math.max(0, Math.min(cursor, len));

  for (let i = 0; i < count; i++) {
    switch (motion) {
      case "h":
        pos = Math.max(0, pos - 1);
        break;
      case "l":
        pos = Math.min(len - 1, pos + 1);
        break;
      case "w":
        pos = nextWordStart(graphemes, text, pos);
        break;
      case "b":
        pos = prevWordStart(graphemes, text, pos);
        break;
      case "e":
        pos = wordEnd(graphemes, text, pos);
        break;
      case "W":
        pos = nextWORDStart(graphemes, pos);
        break;
      case "B":
        pos = prevWORDStart(graphemes, pos);
        break;
      case "E":
        pos = WORDEnd(graphemes, pos);
        break;
      case "0":
        pos = 0;
        break;
      case "$":
        pos = len > 0 ? len - 1 : 0;
        break;
      case "^":
        pos = firstNonSpace(graphemes);
        break;
    }
  }

  return Math.max(0, Math.min(pos, Math.max(0, len - 1)));
}

// ---------------------------------------------------------------------------
// Word helpers (w/b/e) — delegate boundary detection to Intl.Segmenter so CJK
// ideographs segment correctly. We convert the segmenter's code-unit indices
// back to grapheme indices before returning.
// ---------------------------------------------------------------------------

/**
 * Build a sorted array of grapheme indices that start a word segment.
 * Whitespace / punctuation runs do not count as words.
 */
function wordStartGraphemeIndices(text: string): number[] {
  const words = wordSegments(text);
  const out: number[] = [];
  for (const w of words) {
    out.push(codeUnitToGrapheme(text, w.start));
  }
  return out;
}

function wordEndGraphemeIndices(text: string): number[] {
  const words = wordSegments(text);
  const out: number[] = [];
  for (const w of words) {
    // Inclusive end: last grapheme of the word.
    const endExclusive = codeUnitToGrapheme(text, w.end);
    out.push(Math.max(w.start, endExclusive - 1));
  }
  return out;
}

function nextWordStart(_graphemes: string[], text: string, pos: number): number {
  const starts = wordStartGraphemeIndices(text);
  for (const s of starts) {
    if (s > pos) return s;
  }
  return _graphemes.length > 0 ? _graphemes.length - 1 : 0;
}

function prevWordStart(_graphemes: string[], text: string, pos: number): number {
  const starts = wordStartGraphemeIndices(text);
  let prev = 0;
  for (const s of starts) {
    if (s >= pos) break;
    prev = s;
  }
  return prev;
}

function wordEnd(_graphemes: string[], text: string, pos: number): number {
  const ends = wordEndGraphemeIndices(text);
  for (const e of ends) {
    if (e > pos) return e;
  }
  return _graphemes.length > 0 ? _graphemes.length - 1 : 0;
}

// ---------------------------------------------------------------------------
// WORD helpers (W/B/E) — whitespace-delimited only, like vim's "big word".
// These ignore punctuation boundaries. We operate directly on graphemes.
// ---------------------------------------------------------------------------

function isSpaceGrapheme(g: string): boolean {
  // A grapheme is whitespace-like if its first code point is a space-class
  // character. Safe for ASCII spaces, tabs, and most Unicode whitespace.
  return /^\s/.test(g);
}

function nextWORDStart(graphemes: string[], pos: number): number {
  let i = pos;
  // Skip current non-space run
  while (i < graphemes.length && !isSpaceGrapheme(graphemes[i]!)) i++;
  // Skip spaces
  while (i < graphemes.length && isSpaceGrapheme(graphemes[i]!)) i++;
  return i >= graphemes.length ? graphemes.length - 1 : i;
}

function prevWORDStart(graphemes: string[], pos: number): number {
  let i = pos - 1;
  if (i < 0) return 0;
  while (i > 0 && isSpaceGrapheme(graphemes[i]!)) i--;
  while (i > 0 && !isSpaceGrapheme(graphemes[i - 1]!)) i--;
  return i;
}

function WORDEnd(graphemes: string[], pos: number): number {
  let i = pos + 1;
  if (i >= graphemes.length) return Math.max(0, graphemes.length - 1);
  while (i < graphemes.length && isSpaceGrapheme(graphemes[i]!)) i++;
  while (i < graphemes.length - 1 && !isSpaceGrapheme(graphemes[i + 1]!)) i++;
  return i;
}

function firstNonSpace(graphemes: string[]): number {
  for (let i = 0; i < graphemes.length; i++) {
    if (!isSpaceGrapheme(graphemes[i]!)) return i;
  }
  return 0;
}
