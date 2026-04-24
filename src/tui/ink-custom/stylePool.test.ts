import { describe, expect, test } from "bun:test";

import { BASELINE_STYLE_STRINGS, createStylePool } from "./stylePool.ts";

describe("stylePool", () => {
  test("pre-interns the baseline styles at stable IDs", () => {
    const pool = createStylePool();
    for (let i = 0; i < BASELINE_STYLE_STRINGS.length; i++) {
      expect(pool.get(i)).toBe(BASELINE_STYLE_STRINGS[i]!);
    }
    expect(pool.size).toBe(BASELINE_STYLE_STRINGS.length);
  });

  test("intern returns the same ID for repeated strings", () => {
    const pool = createStylePool();
    const a = pool.intern("\x1b[31m"); // red
    const b = pool.intern("\x1b[31m");
    expect(a).toBe(b);
  });

  test("intern returns distinct IDs for distinct strings", () => {
    const pool = createStylePool();
    const a = pool.intern("\x1b[31m");
    const b = pool.intern("\x1b[32m");
    expect(a).not.toBe(b);
  });

  test("get returns undefined for unknown IDs", () => {
    const pool = createStylePool();
    expect(pool.get(9999)).toBeUndefined();
  });

  test("evicts the least-recently-used entry when full", () => {
    // Capacity must be >= baseline count; use baseline + 2 extra slots.
    const cap = BASELINE_STYLE_STRINGS.length + 2;
    const pool = createStylePool(cap);

    pool.intern("\x1b[10m"); // alpha
    const betaId = pool.intern("\x1b[11m");
    expect(pool.size).toBe(cap);

    // Touch every baseline so they migrate to the MRU tail. Now alpha and
    // beta occupy the LRU head (alpha oldest, beta next).
    for (const s of BASELINE_STYLE_STRINGS) pool.intern(s);

    // Touch beta, leaving alpha at the LRU head.
    pool.intern("\x1b[11m");
    // Inserting gamma must evict alpha (LRU). Re-interning alpha should now
    // assign a new ID rather than return the old one.
    const gammaId = pool.intern("\x1b[12m");
    expect(pool.get(betaId)).toBe("\x1b[11m");
    expect(pool.get(gammaId)).toBe("\x1b[12m");
    expect(pool.stats().evictions).toBeGreaterThan(0);
    // Re-intern alpha post-eviction: it must get a fresh interning (size
    // exceeds cap, so another eviction happens), not be found already.
    const sizeBefore = pool.size;
    pool.intern("\x1b[10m");
    // Either the same size (it was evicted, now re-added, evicting the next
    // LRU) or a hit if our trace is off — but the important invariant is
    // that eviction happened.
    expect(pool.size).toBe(sizeBefore);
    expect(pool.stats().evictions).toBeGreaterThan(1);
  });

  test("reset restores baselines and clears custom entries", () => {
    const pool = createStylePool();
    pool.intern("\x1b[31m");
    const beforeSize = pool.size;
    pool.reset();
    expect(pool.size).toBe(BASELINE_STYLE_STRINGS.length);
    expect(pool.size).toBeLessThan(beforeSize);
  });

  test("stats reflects size, capacity, evictions", () => {
    const pool = createStylePool(BASELINE_STYLE_STRINGS.length + 1);
    const s = pool.stats();
    expect(s.capacity).toBe(BASELINE_STYLE_STRINGS.length + 1);
    expect(s.size).toBe(BASELINE_STYLE_STRINGS.length);
    expect(s.evictions).toBe(0);
  });

  test("rejects capacity below baseline length", () => {
    expect(() => createStylePool(1)).toThrow();
  });
});
