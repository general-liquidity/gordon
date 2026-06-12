import { describe, expect, test } from "bun:test";

import {
  computeChatWindow,
  estimateMessageLines,
  estimateWrappedLines,
} from "./chatWindowing.ts";

describe("estimateWrappedLines", () => {
  test("single short line = 1 row", () => {
    expect(estimateWrappedLines("hello", 80)).toBe(1);
  });

  test("empty content still occupies 1 row", () => {
    expect(estimateWrappedLines("", 80)).toBe(1);
  });

  test("wraps long lines by width", () => {
    expect(estimateWrappedLines("x".repeat(200), 80)).toBe(3);
    expect(estimateWrappedLines("x".repeat(160), 80)).toBe(2);
  });

  test("counts newlines and wraps per line", () => {
    expect(estimateWrappedLines("a\nb\nc", 80)).toBe(3);
    expect(estimateWrappedLines(`${"x".repeat(100)}\nshort`, 50)).toBe(3);
  });

  test("ignores ANSI escapes when measuring", () => {
    expect(estimateWrappedLines(`\x1b[31m${"x".repeat(80)}\x1b[0m`, 80)).toBe(1);
  });

  test("degenerate width clamps to 1 column", () => {
    expect(estimateWrappedLines("abc", 0)).toBe(3);
  });
});

describe("estimateMessageLines", () => {
  test("adds bubble chrome rows on top of content", () => {
    const content = estimateWrappedLines("hello", 80);
    expect(estimateMessageLines({ content: "hello" }, 80)).toBe(content + 2);
  });
});

describe("computeChatWindow", () => {
  test("empty transcript", () => {
    const w = computeChatWindow([], 20, null);
    expect(w).toEqual({
      start: 0, end: 0, topClip: 0, totalLines: 0, maxScroll: 0, scrollTop: 0, atBottom: true,
    });
  });

  test("everything fits: full slice, no scroll, at bottom", () => {
    const w = computeChatWindow([3, 4, 2], 20, null);
    expect(w.start).toBe(0);
    expect(w.end).toBe(3);
    expect(w.topClip).toBe(0);
    expect(w.maxScroll).toBe(0);
    expect(w.atBottom).toBe(true);
  });

  test("stick-to-bottom (null) pins scrollTop to maxScroll", () => {
    // 5 messages x 4 rows = 20 lines, viewport 10 → maxScroll 10
    const w = computeChatWindow([4, 4, 4, 4, 4], 10, null);
    expect(w.maxScroll).toBe(10);
    expect(w.scrollTop).toBe(10);
    expect(w.atBottom).toBe(true);
    // window covers lines [10, 20) → msg2 (rows 8-12) clipped 2 rows, then msg3, msg4
    expect(w.start).toBe(2);
    expect(w.end).toBe(5);
    expect(w.topClip).toBe(2);
  });

  test("stick-to-bottom keeps following as content grows", () => {
    const grown = computeChatWindow([4, 4, 4, 4, 4, 6], 10, null);
    expect(grown.scrollTop).toBe(grown.maxScroll);
    expect(grown.end).toBe(6);
    expect(grown.atBottom).toBe(true);
  });

  test("scrolled-up window is frozen when content grows", () => {
    const before = computeChatWindow([4, 4, 4, 4, 4], 10, 3);
    const after = computeChatWindow([4, 4, 4, 4, 4, 8], 10, 3);
    // Same anchor: scrollTop unchanged, same starting message and clip.
    expect(before.scrollTop).toBe(3);
    expect(after.scrollTop).toBe(3);
    expect(after.start).toBe(before.start);
    expect(after.topClip).toBe(before.topClip);
    expect(after.atBottom).toBe(false);
  });

  test("partial first message yields topClip", () => {
    // heights [5, 5, 5], viewport 7, scrollTop 3:
    // window lines [3, 10) → msg0 lines 3-4 visible (clip 3), msg1 fully
    const w = computeChatWindow([5, 5, 5], 7, 3);
    expect(w.start).toBe(0);
    expect(w.topClip).toBe(3);
    expect(w.end).toBe(2);
  });

  test("clamps scrollTop into [0, maxScroll]", () => {
    const low = computeChatWindow([10, 10], 8, -5);
    expect(low.scrollTop).toBe(0);
    expect(low.atBottom).toBe(false);

    const high = computeChatWindow([10, 10], 8, 999);
    expect(high.scrollTop).toBe(12); // 20 - 8
    expect(high.atBottom).toBe(true);
  });

  test("scrollTop 0 shows the head of the transcript", () => {
    const w = computeChatWindow([4, 4, 4], 6, 0);
    expect(w.start).toBe(0);
    expect(w.topClip).toBe(0);
    // window [0,6) → msg0 (0-4) + msg1 (4-8 partially)
    expect(w.end).toBe(2);
  });

  test("excludes messages entirely below the viewport", () => {
    const w = computeChatWindow([4, 4, 4, 4], 4, 0);
    expect(w.start).toBe(0);
    expect(w.end).toBe(1);
  });

  test("viewport of zero/negative rows clamps to 1", () => {
    const w = computeChatWindow([3, 3], 0, null);
    expect(w.maxScroll).toBe(5);
    expect(w.scrollTop).toBe(5);
    expect(w.end).toBe(2);
  });
});

describe("computeChatWindow — header as scroll-origin entry", () => {
  // VirtualMessageList prepends the FullscreenHeader as synthetic index 0:
  // heights = [headerRows, ...messageHeights]. start === 0 means the header
  // (banner + boxes) is visible; the visible message slice is [start-1, end-1).
  const HEADER = 26;

  test("empty conversation: header occupies the whole top, sticks to bottom", () => {
    // Tall header, short viewport, no messages — window pins to the header's
    // bottom; the header entry is the only thing in scroll.
    const w = computeChatWindow([HEADER], 10, null);
    expect(w.start).toBe(0);
    expect(w.end).toBe(1);
    expect(w.maxScroll).toBe(HEADER - 10);
    expect(w.scrollTop).toBe(HEADER - 10);
  });

  test("stick-to-bottom hides the header when content overflows", () => {
    // header 26 + 3 messages x 5 = 41 lines, viewport 10 → maxScroll 31.
    // Window lines [31, 41) start at line 31 — past the header (0-26), so the
    // header is NOT in the visible slice and start points at a message.
    const w = computeChatWindow([HEADER, 5, 5, 5], 10, null);
    expect(w.scrollTop).toBe(31);
    expect(w.start).toBeGreaterThan(0); // header (index 0) scrolled out
    expect(w.atBottom).toBe(true);
  });

  test("scrollTop 0 reveals the header at the top of the session", () => {
    const w = computeChatWindow([HEADER, 5, 5, 5], 10, 0);
    expect(w.start).toBe(0); // header visible
    expect(w.topClip).toBe(0); // top of the header, no clip
    expect(w.atBottom).toBe(false);
  });

  test("partial header at the top yields a topClip into the header", () => {
    // scrollTop 4 → window [4, 14): header lines 4-25 visible (clip 4).
    const w = computeChatWindow([HEADER, 5, 5], 10, 4);
    expect(w.start).toBe(0); // still showing the header
    expect(w.topClip).toBe(4);
  });

  test("total scroll height includes the header rows", () => {
    const w = computeChatWindow([HEADER, 5, 5], 10, null);
    expect(w.totalLines).toBe(HEADER + 10);
  });
});
