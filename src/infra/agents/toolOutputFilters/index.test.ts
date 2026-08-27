import { describe, it, expect } from "bun:test";
import {
  applyToolOutputFilter,
  filterGetCandles,
  filterGetOrderbook,
  filterScanMarket,
  listRegisteredFilters,
  registerToolOutputFilter,
} from "./index.ts";

function makeCandles(count: number, startPrice = 100): unknown[] {
  return Array.from({ length: count }, (_, i) => {
    const open = startPrice + i * 0.5;
    const close = open + (i % 7 === 0 ? 2 : -1);
    return {
      open,
      high: Math.max(open, close) + 1,
      low: Math.min(open, close) - 1,
      close,
      volume: 100 + (i % 13 === 0 ? 500 : 10),
      timestamp: 1_700_000_000_000 + i * 60_000,
    };
  });
}

describe("filterGetCandles", () => {
  it("passes through small candle arrays unchanged", () => {
    const small = makeCandles(10);
    const r = filterGetCandles(small);
    expect(r.filterTag).toBe("passthrough");
    expect(r.filtered).toBe(small);
  });

  it("compresses large candle arrays preserving summary + tail + top-volume", () => {
    const big = makeCandles(200);
    const r = filterGetCandles(big);
    expect(r.filterTag).toContain("get_candles");
    expect(r.bytesAfter).toBeLessThan(r.bytesBefore);
    const f = r.filtered as Record<string, unknown>;
    expect(f.summary).toBeDefined();
    expect((f.recentTail as unknown[]).length).toBe(20);
    expect((f.notableVolumeCandles as unknown[]).length).toBeGreaterThan(0);
  });

  it("handles wrapped containers (candles / data / klines fields)", () => {
    const wrapped = { candles: makeCandles(100), symbol: "BTCUSDT" };
    const r = filterGetCandles(wrapped);
    expect(r.filterTag).toContain("get_candles");
  });

  it("bypasses error envelopes", () => {
    const err = { status: "error", message: "rate limited" };
    const r = filterGetCandles(err);
    expect(r.filterTag).toBe("passthrough");
  });

  it("bypasses non-candle shapes", () => {
    expect(filterGetCandles("just a string").filterTag).toBe("passthrough");
    expect(filterGetCandles(42).filterTag).toBe("passthrough");
    expect(filterGetCandles([{ foo: "bar" }]).filterTag).toBe("passthrough");
  });

  it("captures the price extremes correctly", () => {
    const candles = makeCandles(50);
    const r = filterGetCandles(candles);
    const summary = (r.filtered as Record<string, unknown>).summary as Record<string, number>;
    const hi = summary.highPrice as number;
    const lo = summary.lowPrice as number;
    expect(hi).toBeGreaterThanOrEqual(lo);
    expect(summary.count).toBe(50);
  });
});

describe("filterGetOrderbook", () => {
  function makeBook(bidCount: number, askCount: number, mid = 50000) {
    return {
      symbol: "BTCUSDT",
      lastUpdateId: 1234,
      bids: Array.from({ length: bidCount }, (_, i) => ({
        price: mid - 1 - i * 0.5,
        quantity: 0.5 + i * 0.01,
      })),
      asks: Array.from({ length: askCount }, (_, i) => ({
        price: mid + 1 + i * 0.5,
        quantity: 0.5 + i * 0.01,
      })),
    };
  }

  it("passes through small books unchanged", () => {
    const small = makeBook(4, 4);
    const r = filterGetOrderbook(small);
    expect(r.filterTag).toBe("passthrough");
  });

  it("compresses large books — top levels + banded liquidity", () => {
    const big = makeBook(30, 30);
    const r = filterGetOrderbook(big);
    expect(r.filterTag).toContain("get_orderbook");
    expect(r.bytesAfter).toBeLessThan(r.bytesBefore);
    const f = r.filtered as Record<string, unknown>;
    expect((f.topBids as unknown[]).length).toBe(5);
    expect((f.topAsks as unknown[]).length).toBe(5);
    expect((f.liquidityBands as unknown[]).length).toBeGreaterThan(0);
  });

  it("computes spread + mid correctly", () => {
    const book = makeBook(30, 30);
    const r = filterGetOrderbook(book);
    const summary = (r.filtered as Record<string, unknown>).summary as Record<string, number>;
    const bid = summary.bestBid as number;
    const ask = summary.bestAsk as number;
    expect(bid).toBeLessThan(ask);
    expect(summary.mid as number).toBeCloseTo((bid + ask) / 2, 5);
    expect(summary.spreadAbs as number).toBeGreaterThan(0);
  });

  it("handles array-of-tuples shape ([price, qty])", () => {
    const tupleBook = {
      symbol: "BTCUSDT",
      bids: Array.from({ length: 30 }, (_, i) => [50000 - i, 0.5]),
      asks: Array.from({ length: 30 }, (_, i) => [50001 + i, 0.5]),
    };
    const r = filterGetOrderbook(tupleBook);
    expect(r.filterTag).toContain("get_orderbook");
  });

  it("bypasses missing-bids / missing-asks shapes", () => {
    expect(filterGetOrderbook({ symbol: "x" }).filterTag).toBe("passthrough");
    expect(filterGetOrderbook(null).filterTag).toBe("passthrough");
  });

  it("bypasses error envelopes", () => {
    expect(filterGetOrderbook({ status: "error", message: "no symbol" }).filterTag).toBe(
      "passthrough",
    );
  });
});

describe("filterScanMarket", () => {
  function makeRows(count: number) {
    return Array.from({ length: count }, (_, i) => ({
      symbol: `SYM${i}`,
      changePct: (i - count / 2) * 0.5,
      price: 100 + i,
      volume: 1000 + ((i * 17) % 5000),
      regime: i % 3 === 0 ? "trending_up" : i % 3 === 1 ? "ranging" : "trending_down",
    }));
  }

  it("passes through small scans unchanged", () => {
    const small = makeRows(8);
    const r = filterScanMarket(small);
    expect(r.filterTag).toBe("passthrough");
  });

  it("compresses large scans — gainers + losers + volume + regime distribution", () => {
    const big = makeRows(200);
    const r = filterScanMarket(big);
    expect(r.filterTag).toContain("scan_market");
    expect(r.bytesAfter).toBeLessThan(r.bytesBefore);
    const f = r.filtered as Record<string, unknown>;
    expect((f.gainers as unknown[]).length).toBe(10);
    expect((f.losers as unknown[]).length).toBe(10);
    expect((f.volumeLeaders as unknown[]).length).toBe(5);
    expect(f.regimeDistribution).toBeDefined();
  });

  it("keeps focus symbols verbatim even if mid-pack", () => {
    const rows = makeRows(200);
    const r = filterScanMarket(rows, { focusSymbols: new Set(["SYM100"]) });
    const f = r.filtered as Record<string, unknown>;
    const focus = f.focusSymbols as Array<{ symbol: string }> | undefined;
    expect(focus).toBeDefined();
    expect(focus?.[0]?.symbol).toBe("SYM100");
  });

  it("handles wrapped containers (results / data / movers fields)", () => {
    const wrapped = { results: makeRows(100) };
    const r = filterScanMarket(wrapped);
    expect(r.filterTag).toContain("scan_market");
  });

  it("bypasses error envelopes + non-array shapes", () => {
    expect(filterScanMarket({ status: "error" }).filterTag).toBe("passthrough");
    expect(filterScanMarket("nope").filterTag).toBe("passthrough");
  });
});

describe("applyToolOutputFilter dispatcher", () => {
  it("routes by canonical tool name", () => {
    const candles = Array.from({ length: 100 }, (_, i) => ({
      open: 100,
      high: 101,
      low: 99,
      close: 100.5 + i * 0.01,
    }));
    expect(applyToolOutputFilter("get_candles", candles).filterTag).toContain("get_candles");
    expect(applyToolOutputFilter("get_historical_klines", candles).filterTag).toContain(
      "get_candles",
    );
  });

  it("passes through for unknown tool names", () => {
    const data = { foo: "bar" };
    expect(applyToolOutputFilter("totally_made_up_tool", data).filterTag).toBe("passthrough");
  });

  it("forwards scan options when filter supports them", () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({
      symbol: `SYM${i}`,
      changePct: 0,
      volume: 100,
    }));
    const r = applyToolOutputFilter("scan_market", rows, {
      scan: { focusSymbols: new Set(["SYM50"]) },
    });
    const f = r.filtered as Record<string, unknown>;
    expect(f.focusSymbols).toBeDefined();
  });

  it("listRegisteredFilters returns all known tool names", () => {
    const names = listRegisteredFilters();
    expect(names).toContain("get_candles");
    expect(names).toContain("get_orderbook");
    expect(names).toContain("scan_market");
  });

  it("registerToolOutputFilter adds custom filters", () => {
    const customTag = `test-${Date.now()}`;
    registerToolOutputFilter("custom_test_tool", (_raw) => ({
      filtered: { compressed: true },
      bytesBefore: 100,
      bytesAfter: 30,
      filterTag: customTag,
    }));
    const r = applyToolOutputFilter("custom_test_tool", { huge: "payload" });
    expect(r.filterTag).toBe(customTag);
  });
});
