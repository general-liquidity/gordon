import { describe, test, expect } from "bun:test";
import { Cache, createCache } from "./cache.ts";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe("Cache", () => {
  test("tracks misses and hits correctly", () => {
    const cache = new Cache<number>();

    expect(cache.get("missing")).toBeUndefined();
    cache.set("a", 1);
    expect(cache.get("a")).toBe(1);

    const stats = cache.getStats();
    expect(stats.misses).toBe(1);
    expect(stats.hits).toBe(1);
    expect(stats.hitRate).toBe(0.5);
  });

  test("respects TTL expiration in get and has", async () => {
    const cache = new Cache<number>({ defaultTtl: 20 });
    cache.set("short", 42);

    expect(cache.has("short")).toBe(true);
    expect(cache.get("short")).toBe(42);

    await sleep(30);

    expect(cache.has("short")).toBe(false);
    expect(cache.get("short")).toBeUndefined();
  });

  test("supports updateTtlOnAccess", async () => {
    const cache = new Cache<number>({ defaultTtl: 60, updateTtlOnAccess: true });
    cache.set("rolling", 7);

    await sleep(25);
    expect(cache.get("rolling")).toBe(7); // extends TTL
    await sleep(25);

    expect(cache.get("rolling")).toBe(7);
  });

  test("evicts oldest entries when at capacity", async () => {
    const cache = new Cache<number>({ maxEntries: 3, defaultTtl: 1000 });
    cache.set("a", 1);
    await sleep(2);
    cache.set("b", 2);
    await sleep(2);
    cache.set("c", 3);
    await sleep(2);

    cache.set("d", 4);

    expect(cache.size).toBe(3);
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBe(2);
    expect(cache.get("c")).toBe(3);
    expect(cache.get("d")).toBe(4);
  });

  test("supports getOrSet and avoids recompute on cache hit", async () => {
    const cache = new Cache<number>();
    let calls = 0;

    const first = await cache.getOrSet("k", async () => {
      calls++;
      return 99;
    });
    const second = await cache.getOrSet("k", async () => {
      calls++;
      return 123;
    });

    expect(first).toBe(99);
    expect(second).toBe(99);
    expect(calls).toBe(1);
  });

  test("prune removes expired keys and clear resets state", async () => {
    const cache = createCache<number>({ defaultTtl: 20 });
    cache.set("x", 1);
    cache.set("y", 2, 1000);

    await sleep(30);

    const pruned = cache.prune();
    expect(pruned).toBe(1);
    expect(cache.keys()).toEqual(["y"]);

    cache.clear();
    expect(cache.size).toBe(0);
    expect(cache.getStats().hits).toBe(0);
    expect(cache.getStats().misses).toBe(0);
  });

  test("delete removes key and reports result", () => {
    const cache = new Cache<number>();
    cache.set("tmp", 5);

    expect(cache.delete("tmp")).toBe(true);
    expect(cache.delete("tmp")).toBe(false);
  });
});
