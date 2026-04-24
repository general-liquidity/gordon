import { describe, expect, test } from "bun:test";

import { BASELINE_CHAR_STRINGS, createCharPool } from "./charPool.ts";

describe("charPool", () => {
  test("blank space has ID 0 (canonical empty-cell glyph)", () => {
    const pool = createCharPool();
    expect(pool.get(0)).toBe(" ");
  });

  test("pre-interns ASCII printables and box-drawing chars", () => {
    const pool = createCharPool();
    // ASCII printable covers 0x21..0x7e (94 chars) + space = 95 known glyphs.
    expect(pool.size).toBeGreaterThanOrEqual(95);
    // Sample a box-drawing char — must already be interned.
    const before = pool.size;
    pool.intern("─");
    expect(pool.size).toBe(before);
  });

  test("intern is idempotent for the same grapheme", () => {
    const pool = createCharPool();
    const a = pool.intern("Ω");
    const b = pool.intern("Ω");
    expect(a).toBe(b);
  });

  test("intern returns distinct IDs for distinct graphemes", () => {
    const pool = createCharPool();
    const a = pool.intern("Ω");
    const b = pool.intern("π");
    expect(a).not.toBe(b);
  });

  test("evicts the least-recently-used entry when full", () => {
    const cap = BASELINE_CHAR_STRINGS.length + 2;
    const pool = createCharPool(cap);

    pool.intern("αα"); // alpha
    const betaId = pool.intern("ββ");
    expect(pool.size).toBe(cap);

    // Touch every baseline so alpha and beta sit at the LRU head.
    for (const s of BASELINE_CHAR_STRINGS) pool.intern(s);

    // Touch beta, leaving alpha as LRU.
    pool.intern("ββ");
    const gammaId = pool.intern("γγ");
    expect(pool.get(betaId)).toBe("ββ");
    expect(pool.get(gammaId)).toBe("γγ");
    expect(pool.stats().evictions).toBeGreaterThan(0);
    // Re-intern alpha after eviction — pool must remain capped and record
    // another eviction rather than silently overflow.
    const sizeBefore = pool.size;
    pool.intern("αα");
    expect(pool.size).toBe(sizeBefore);
    expect(pool.stats().evictions).toBeGreaterThan(1);
  });

  test("reset restores baselines", () => {
    const pool = createCharPool();
    pool.intern("☃");
    const beforeSize = pool.size;
    pool.reset();
    expect(pool.size).toBe(BASELINE_CHAR_STRINGS.length);
    expect(pool.size).toBeLessThan(beforeSize);
    expect(pool.get(0)).toBe(" ");
  });

  test("stats reports size, capacity, evictions", () => {
    const pool = createCharPool(BASELINE_CHAR_STRINGS.length + 1);
    const s = pool.stats();
    expect(s.capacity).toBe(BASELINE_CHAR_STRINGS.length + 1);
    expect(s.size).toBe(BASELINE_CHAR_STRINGS.length);
    expect(s.evictions).toBe(0);
  });

  test("rejects capacity below baseline length", () => {
    expect(() => createCharPool(1)).toThrow();
  });
});
