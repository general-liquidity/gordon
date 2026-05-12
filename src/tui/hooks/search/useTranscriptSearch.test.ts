/**
 * Tests for the bitmap pre-filter helpers in useTranscriptSearch.
 *
 * The full hook integration is exercised through React; here we just
 * verify the pure helpers (computeLetterBitmap, bitmapCouldContain) since
 * they're the new correctness-critical bit.
 */

import { describe, expect, test } from "bun:test";
import { computeLetterBitmap, bitmapCouldContain } from "./useTranscriptSearch.ts";

describe("computeLetterBitmap", () => {
  test("returns 0 for empty / non-letter input", () => {
    expect(computeLetterBitmap("")).toBe(0);
    expect(computeLetterBitmap("12345")).toBe(0);
    expect(computeLetterBitmap("!@#$ ")).toBe(0);
  });

  test("sets one bit per unique letter", () => {
    const a = computeLetterBitmap("a");
    const b = computeLetterBitmap("b");
    expect(a).toBe(1 << 0);
    expect(b).toBe(1 << 1);
    expect(a & b).toBe(0);
  });

  test("is case-insensitive", () => {
    expect(computeLetterBitmap("ABC")).toBe(computeLetterBitmap("abc"));
    expect(computeLetterBitmap("Hello")).toBe(computeLetterBitmap("hello"));
  });

  test("ignores duplicates and non-letters", () => {
    expect(computeLetterBitmap("aaa")).toBe(computeLetterBitmap("a"));
    expect(computeLetterBitmap("a1!a@b")).toBe(computeLetterBitmap("ab"));
  });

  test("mixed message produces composite bitmap", () => {
    const m = computeLetterBitmap("Buy BTC at $42k");
    expect(m & computeLetterBitmap("b")).toBe(computeLetterBitmap("b"));
    expect(m & computeLetterBitmap("u")).toBe(computeLetterBitmap("u"));
    expect(m & computeLetterBitmap("y")).toBe(computeLetterBitmap("y"));
    expect(m & computeLetterBitmap("t")).toBe(computeLetterBitmap("t"));
    expect(m & computeLetterBitmap("c")).toBe(computeLetterBitmap("c"));
    expect(m & computeLetterBitmap("a")).toBe(computeLetterBitmap("a"));
  });
});

describe("bitmapCouldContain — necessary condition", () => {
  test("identical bitmaps pass", () => {
    const a = computeLetterBitmap("hello");
    expect(bitmapCouldContain(a, a)).toBe(true);
  });

  test("subset query passes superset message", () => {
    const msg = computeLetterBitmap("the quick brown fox");
    const q = computeLetterBitmap("fox");
    expect(bitmapCouldContain(msg, q)).toBe(true);
  });

  test("query letter not in message fails", () => {
    const msg = computeLetterBitmap("hello world");
    const q = computeLetterBitmap("zoo");
    // 'z' is in q but not in msg → must reject
    expect(bitmapCouldContain(msg, q)).toBe(false);
  });

  test("empty query (mask 0) always passes — handled by caller", () => {
    const msg = computeLetterBitmap("anything");
    expect(bitmapCouldContain(msg, 0)).toBe(true);
  });

  test("filter never rejects a message that genuinely contains the query", () => {
    // Property: if msg.includes(q), then bitmapCouldContain(B(msg), B(q))
    const samples: Array<[string, string]> = [
      ["The price of BTC is $42000", "btc"],
      ["Set stop loss at 1.5%", "stop"],
      ["Long ETH position open", "eth"],
      ["Cancel order #123", "cancel"],
    ];
    for (const [msg, q] of samples) {
      expect(msg.toLowerCase().includes(q.toLowerCase())).toBe(true);
      expect(bitmapCouldContain(computeLetterBitmap(msg), computeLetterBitmap(q))).toBe(true);
    }
  });

  test("rejects messages missing letters from the query", () => {
    // 5-letter query 'pizza' against messages that lack 'z' or 'p' —
    // must be filtered out.
    const q = computeLetterBitmap("pizza");
    const candidates = [
      "the quick brown fox",        // no p, no z
      "buy ethereum",                // no p, no z
      "stop loss at one half",       // no z
    ];
    for (const c of candidates) {
      expect(bitmapCouldContain(computeLetterBitmap(c), q)).toBe(false);
    }
  });
});

describe("computeLetterBitmap — early-out at full alphabet", () => {
  test("all 26 letters returns 0x3FFFFFF", () => {
    expect(computeLetterBitmap("abcdefghijklmnopqrstuvwxyz")).toBe(0x3FFFFFF);
  });

  test("pangram with case + punctuation still returns full mask", () => {
    expect(computeLetterBitmap("The quick brown fox jumps over the lazy dog.")).toBe(0x3FFFFFF);
  });
});
