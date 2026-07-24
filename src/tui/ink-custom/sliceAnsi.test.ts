// Tests for the OSC-8-safe, combining-mark-safe sliceAnsi used by the
// ink-custom clip path (outputTarget.ts). Covers three properties:
//
//   1. Plain text matches the npm `slice-ansi` package it replaces, so the
//      horizontal-clip behavior for ordinary lines is a pure regression.
//   2. Slicing THROUGH an OSC 8 hyperlink threads the `ESC]8;;URL BEL` open
//      and `ESC]8;;BEL` close cleanly — no truncated URL bytes leak (npm
//      slice-ansi corrupts the URL because it counts the escape bytes as
//      visible cells).
//   3. Zero-width combining marks stay attached to their base char, so slice
//      widths are measured in display cells, not code units.

import { describe, expect, test } from "bun:test";
import npmSlice from "slice-ansi";
import stringWidth from "string-width";
import sliceAnsi from "./sliceAnsi.ts";

const LINK_OPEN = (url: string): string => `\x1b]8;;${url}\x07`;
const LINK_CLOSE = "\x1b]8;;\x07";

describe("sliceAnsi plain-text regression vs npm slice-ansi", () => {
  const line = "hello world foo bar";
  const cases: Array<[number, number]> = [
    [0, 5],
    [6, 11],
    [2, 9],
    [0, line.length],
    [3, 3], // empty slice
    [12, 19],
  ];
  for (const [from, to] of cases) {
    test(`plain slice [${from},${to}] matches npm`, () => {
      expect(sliceAnsi(line, from, to)).toBe(npmSlice(line, from, to));
    });
  }

  test("open-ended slice (no end) matches npm", () => {
    expect(sliceAnsi(line, 6)).toBe(npmSlice(line, 6));
  });

  test("plain SGR-colored slice closes the color like npm", () => {
    const colored = `\x1b[31mRED\x1b[39mplain`;
    expect(sliceAnsi(colored, 0, 2)).toBe(npmSlice(colored, 0, 2));
  });
});

describe("sliceAnsi OSC 8 hyperlink safety", () => {
  const url = "https://example.com";
  // "pre " (4) + hyperlinked "LINKED" (cols 4-9) + " post" (5) = 15 cells.
  const line = `pre ${LINK_OPEN(url)}LINKED${LINK_CLOSE} post`;

  test("baseline: the line's visible width ignores OSC 8 bytes", () => {
    expect(stringWidth(line)).toBe(15);
  });

  test("slice through the link re-opens with the intact URL and closes it", () => {
    // Cols 6-11 straddle the link boundary: "NKED p".
    const sliced = sliceAnsi(line, 6, 12);
    // Full, uncorrupted open sequence is present (npm slice-ansi mangles the
    // URL here, e.g. "https://exame.com").
    expect(sliced.includes(LINK_OPEN(url))).toBe(true);
    // The run is explicitly closed with the URL-less closer.
    expect(sliced.includes(LINK_CLOSE)).toBe(true);
    // The visible payload survives at the right width.
    expect(stringWidth(sliced)).toBe(6);
    // No partial/leaked OSC 8 bytes: every ESC]8;; introducer is a complete
    // open (URL + BEL) or the exact closer.
    expect(sliced).toBe(`${LINK_OPEN(url)}NKED${LINK_CLOSE} p`);
  });

  test("slice entirely inside the link keeps the link opened and closed", () => {
    // Cols 5-7 land inside "LINKED": "INK".
    const sliced = sliceAnsi(line, 5, 8);
    expect(sliced).toBe(`${LINK_OPEN(url)}INK${LINK_CLOSE}`);
  });

  test("npm slice-ansi corrupts the same OSC 8 slice (documents the bug)", () => {
    const npmOut = npmSlice(line, 6, 12);
    // The URL is truncated mid-sequence and the run is never opened cleanly.
    // This is the bug our own slicer exists to avoid.
    expect(npmOut.includes(LINK_OPEN(url))).toBe(false);
  });
});

describe("sliceAnsi zero-width combining marks", () => {
  // "भ" (U+092D) + combining sign "ा" (U+093E). NOTE: post-bump string-width
  // counts the Devanagari combining sign as its own cell, while sliceAnsi's own
  // tokenizer still treats it as zero-width. The two libraries diverge on this
  // extreme edge case (combining-mark scripts in a terminal); the slice STRINGS
  // are unchanged, only string-width's measurement of them shifted.
  const dev = "aभाb"; // a | भ | ा | b  -> string-width 4, 4 code units.

  test("baseline: string-width is 4, code-unit length is 4", () => {
    expect(stringWidth(dev)).toBe(4);
    expect(dev.length).toBe(4);
  });

  test("slice [0,2] keeps the combining mark on its base char", () => {
    const sliced = sliceAnsi(dev, 0, 2);
    expect(sliced).toBe("aभा");
    expect(stringWidth(sliced)).toBe(3);
  });

  test("slice [1,2] returns the composed cell, not a bare base char", () => {
    const sliced = sliceAnsi(dev, 1, 2);
    expect(sliced).toBe("भा");
    expect(stringWidth(sliced)).toBe(2);
  });

  test("left + right halves recombine to the original (no duplicated mark)", () => {
    // The combining mark must appear in exactly one half. Slice to the full
    // string-width (4 post-bump) so the split covers every cell including "b".
    expect(sliceAnsi(dev, 0, 1) + sliceAnsi(dev, 1, stringWidth(dev))).toBe(dev);
  });
});
