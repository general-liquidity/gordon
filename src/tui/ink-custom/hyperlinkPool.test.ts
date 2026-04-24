import { describe, expect, it } from "bun:test";

import { createHyperlinkPool } from "./hyperlinkPool.ts";

describe("hyperlinkPool", () => {
  it("returns the same ID for the same URL", () => {
    const pool = createHyperlinkPool(8);
    const a = pool.intern("https://example.com/a");
    const b = pool.intern("https://example.com/a");
    expect(a).toBe(b);
    expect(pool.size).toBe(1);
  });

  it("returns distinct IDs for different URLs", () => {
    const pool = createHyperlinkPool(8);
    const a = pool.intern("https://example.com/a");
    const b = pool.intern("https://example.com/b");
    const c = pool.intern("https://example.com/c");
    expect(a).not.toBe(b);
    expect(b).not.toBe(c);
    expect(a).not.toBe(c);
    expect(pool.size).toBe(3);
  });

  it("round-trips through get()", () => {
    const pool = createHyperlinkPool(8);
    const id = pool.intern("https://example.com/x");
    expect(pool.get(id)).toBe("https://example.com/x");
    expect(pool.get(9999)).toBeUndefined();
  });

  it("LRU-evicts the oldest entry when capacity is exceeded", () => {
    const capacity = 3;
    const pool = createHyperlinkPool(capacity);
    const oldId = pool.intern("https://example.com/1");
    pool.intern("https://example.com/2");
    pool.intern("https://example.com/3");
    expect(pool.size).toBe(capacity);
    expect(pool.stats().evictions).toBe(0);

    // One past capacity — oldest (id for /1) must be evicted.
    const newId = pool.intern("https://example.com/4");

    expect(pool.size).toBe(capacity);
    expect(pool.get(oldId)).toBeUndefined();
    expect(pool.get(newId)).toBe("https://example.com/4");
    expect(pool.stats().evictions).toBe(1);
  });

  it("treats intern() as a touch — accessed entries survive eviction", () => {
    const pool = createHyperlinkPool(3);
    const firstId = pool.intern("https://example.com/1");
    pool.intern("https://example.com/2");
    pool.intern("https://example.com/3");

    // Re-intern /1 to mark it most-recently-used.
    const firstAgain = pool.intern("https://example.com/1");
    expect(firstAgain).toBe(firstId);

    // Adding /4 should now evict /2 (the new oldest), not /1.
    pool.intern("https://example.com/4");

    expect(pool.get(firstId)).toBe("https://example.com/1");
  });

  it("reset() empties the pool", () => {
    const pool = createHyperlinkPool(8);
    const id = pool.intern("https://example.com/a");
    pool.intern("https://example.com/b");
    expect(pool.size).toBe(2);

    pool.reset();

    expect(pool.size).toBe(0);
    expect(pool.get(id)).toBeUndefined();
    expect(pool.stats().evictions).toBe(0);
  });

  it("reports capacity and size via stats()", () => {
    const pool = createHyperlinkPool(16);
    pool.intern("https://example.com/a");
    const stats = pool.stats();
    expect(stats.capacity).toBe(16);
    expect(stats.size).toBe(1);
  });

  it("rejects non-positive capacities", () => {
    expect(() => createHyperlinkPool(0)).toThrow();
    expect(() => createHyperlinkPool(-1)).toThrow();
    expect(() => createHyperlinkPool(2.5)).toThrow();
  });
});
