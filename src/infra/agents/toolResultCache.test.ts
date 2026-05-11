import { describe, it, expect, beforeEach } from "bun:test";
import {
  DEFAULT_TTL_MS,
  ToolResultCache,
  buildCacheKey,
} from "./toolResultCache.ts";

const NOW = 1_700_000_000_000;

describe("buildCacheKey", () => {
  it("is stable across argument key order", () => {
    const a = buildCacheKey("get_price", { symbol: "BTC", venue: "binance" }, "s1");
    const b = buildCacheKey("get_price", { venue: "binance", symbol: "BTC" }, "s1");
    expect(a).toBe(b);
  });

  it("differs across tool names", () => {
    const a = buildCacheKey("get_price", { symbol: "BTC" }, "s1");
    const b = buildCacheKey("get_ticker", { symbol: "BTC" }, "s1");
    expect(a).not.toBe(b);
  });

  it("differs across session keys", () => {
    const a = buildCacheKey("get_price", { symbol: "BTC" }, "session-a");
    const b = buildCacheKey("get_price", { symbol: "BTC" }, "session-b");
    expect(a).not.toBe(b);
  });

  it("differs across argument values", () => {
    const a = buildCacheKey("get_price", { symbol: "BTC" }, "s1");
    const b = buildCacheKey("get_price", { symbol: "ETH" }, "s1");
    expect(a).not.toBe(b);
  });

  it("handles nested objects and arrays deterministically", () => {
    const a = buildCacheKey(
      "scan_market",
      { filters: { regimes: ["bull", "ranging"], minVolume: 100 } },
      "s1",
    );
    const b = buildCacheKey(
      "scan_market",
      { filters: { minVolume: 100, regimes: ["bull", "ranging"] } },
      "s1",
    );
    expect(a).toBe(b);
  });
});

describe("ToolResultCache.record + lookup", () => {
  let cache: ToolResultCache;
  beforeEach(() => {
    cache = new ToolResultCache();
  });

  it("returns miss on first lookup", () => {
    const r = cache.lookup({ toolName: "get_price", args: { symbol: "BTC" }, sessionKey: "s1" });
    expect(r.kind).toBe("miss");
  });

  it("returns hit + delta envelope within TTL", () => {
    cache.record({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      payload: { price: 50000 },
      now: NOW,
    });
    const r = cache.lookup({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      now: NOW + 1000,
    });
    expect(r.kind).toBe("hit");
    expect(r.delta?.status).toBe("unchanged");
    expect(r.delta?.toolName).toBe("get_price");
    expect(r.delta?.ageSeconds).toBe(1);
    expect(r.delta?.cachedPayload).toEqual({ price: 50000 });
  });

  it("returns miss + drops entry after TTL elapses", () => {
    cache.record({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      payload: { price: 50000 },
      ttlMs: 1000,
      now: NOW,
    });
    const r = cache.lookup({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      now: NOW + 2000,
    });
    expect(r.kind).toBe("miss");
    // Entry should be dropped, second lookup also misses.
    expect(cache.size()).toBe(0);
  });

  it("computes drift % when freshPayload is provided and driftPath is set", () => {
    cache.record({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      payload: { price: 50000 },
      now: NOW,
    });
    const r = cache.lookup({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      freshPayload: { price: 50500 },
      now: NOW + 1000,
    });
    expect(r.delta?.driftPct).toBeCloseTo(1.0, 2);
    expect(r.delta?.note).toContain("drifted");
  });

  it("driftPct is null when freshPayload not provided", () => {
    cache.record({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      payload: { price: 50000 },
      now: NOW,
    });
    const r = cache.lookup({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      now: NOW + 1000,
    });
    expect(r.delta?.driftPct).toBeNull();
  });

  it("driftPct is null when tool has no default drift path", () => {
    cache.record({
      toolName: "get_orderbook",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      payload: { bids: [], asks: [] },
      now: NOW,
    });
    const r = cache.lookup({
      toolName: "get_orderbook",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      freshPayload: { bids: [], asks: [] },
      now: NOW + 1000,
    });
    expect(r.delta?.driftPct).toBeNull();
  });

  it("uses per-tool default TTL when ttlMs not specified", () => {
    cache.record({
      toolName: "get_candles",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      payload: { candles: [] },
      now: NOW,
    });
    // get_candles default TTL is 30s (verify it's not bypassed)
    const r1 = cache.lookup({
      toolName: "get_candles",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      now: NOW + 10_000,
    });
    expect(r1.kind).toBe("hit");
    // Past 30s should expire
    const r2 = cache.lookup({
      toolName: "get_candles",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      now: NOW + 31_000,
    });
    expect(r2.kind).toBe("miss");
  });

  it("falls back to DEFAULT_TTL_MS for unknown tools", () => {
    cache.record({
      toolName: "made_up_tool",
      args: {},
      sessionKey: "s1",
      payload: { ok: true },
      now: NOW,
    });
    const within = cache.lookup({
      toolName: "made_up_tool",
      args: {},
      sessionKey: "s1",
      now: NOW + DEFAULT_TTL_MS / 2,
    });
    expect(within.kind).toBe("hit");
    const expired = cache.lookup({
      toolName: "made_up_tool",
      args: {},
      sessionKey: "s1",
      now: NOW + DEFAULT_TTL_MS + 1,
    });
    expect(expired.kind).toBe("miss");
  });
});

describe("invalidation", () => {
  it("invalidate() removes a single entry", () => {
    const cache = new ToolResultCache();
    cache.record({
      toolName: "get_price",
      args: { symbol: "BTC" },
      sessionKey: "s1",
      payload: { price: 1 },
    });
    expect(cache.invalidate("get_price", { symbol: "BTC" }, "s1")).toBe(true);
    expect(cache.size()).toBe(0);
  });

  it("invalidateTool() drops all entries for a tool name", () => {
    const cache = new ToolResultCache();
    cache.record({ toolName: "get_price", args: { symbol: "BTC" }, sessionKey: "s1", payload: 1 });
    cache.record({ toolName: "get_price", args: { symbol: "ETH" }, sessionKey: "s1", payload: 1 });
    cache.record({ toolName: "get_ticker", args: { symbol: "BTC" }, sessionKey: "s1", payload: 1 });
    expect(cache.invalidateTool("get_price")).toBe(2);
    expect(cache.size()).toBe(1);
  });
});

describe("eviction", () => {
  it("evicts oldest entries when exceeding maxEntries", () => {
    const cache = new ToolResultCache(3);
    cache.record({ toolName: "t", args: { i: 1 }, sessionKey: "s", payload: 1, now: NOW });
    cache.record({ toolName: "t", args: { i: 2 }, sessionKey: "s", payload: 2, now: NOW + 1 });
    cache.record({ toolName: "t", args: { i: 3 }, sessionKey: "s", payload: 3, now: NOW + 2 });
    cache.record({ toolName: "t", args: { i: 4 }, sessionKey: "s", payload: 4, now: NOW + 3 });
    expect(cache.size()).toBe(3);
    // The first one (i=1) should be gone
    const r = cache.lookup({ toolName: "t", args: { i: 1 }, sessionKey: "s", now: NOW + 10 });
    expect(r.kind).toBe("miss");
  });
});
