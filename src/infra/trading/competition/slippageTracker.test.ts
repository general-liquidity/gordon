import { describe, expect, it } from "bun:test";

import { SlippageTracker } from "./slippageTracker.ts";

describe("SlippageTracker", () => {
  it("scores a buy filled above mid as positive (adverse) bps", () => {
    const t = new SlippageTracker();
    // refPrice 100, fill 100.5 → (0.5/100)*1e4 = 50 bps adverse.
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.5, volume: 2 });
    const s = t.summary();
    expect(s.fills).toBe(1);
    expect(s.meanSlippageBps).toBeCloseTo(50, 6);
    // cost = 50/1e4 * 100 * 2 = 1.0 quote.
    expect(s.totalCostQuote).toBeCloseTo(1.0, 6);
  });

  it("scores a sell filled below mid as positive (adverse) bps", () => {
    const t = new SlippageTracker();
    // refPrice 200, fill 199 → (1/200)*1e4 = 50 bps adverse.
    t.record({ symbol: "ETHUSDT", side: "sell", refPrice: 200, fillPrice: 199, volume: 3 });
    const s = t.summary();
    expect(s.meanSlippageBps).toBeCloseTo(50, 6);
    // cost = 50/1e4 * 200 * 3 = 3.0 quote.
    expect(s.totalCostQuote).toBeCloseTo(3.0, 6);
  });

  it("scores a buy filled AT mid as zero bps and zero cost", () => {
    const t = new SlippageTracker();
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100, volume: 5 });
    const s = t.summary();
    expect(s.meanSlippageBps).toBe(0);
    expect(s.totalCostQuote).toBe(0);
  });

  it("records price improvement as negative bps and negative cost", () => {
    const t = new SlippageTracker();
    // buy below mid → favorable → negative adverse bps.
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 99.9, volume: 1 });
    const s = t.summary();
    expect(s.meanSlippageBps).toBeCloseTo(-10, 6);
    expect(s.totalCostQuote).toBeCloseTo(-0.1, 6);
  });

  it("computes mean and median across several fills", () => {
    const t = new SlippageTracker();
    // bps: 50, 0, -10, 30  → mean = 17.5
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.5, volume: 1 }); // 50
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100, volume: 1 }); // 0
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 99.9, volume: 1 }); // -10
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.3, volume: 1 }); // 30
    const s = t.summary();
    expect(s.fills).toBe(4);
    expect(s.meanSlippageBps).toBeCloseTo(17.5, 6);
    // sorted: -10, 0, 30, 50 → median = (0 + 30)/2 = 15
    expect(s.medianSlippageBps).toBeCloseTo(15, 6);
  });

  it("uses the middle element for odd-count median", () => {
    const t = new SlippageTracker();
    t.record({ symbol: "X", side: "buy", refPrice: 100, fillPrice: 100.5, volume: 1 }); // 50
    t.record({ symbol: "X", side: "buy", refPrice: 100, fillPrice: 100, volume: 1 }); // 0
    t.record({ symbol: "X", side: "buy", refPrice: 100, fillPrice: 100.3, volume: 1 }); // 30
    // sorted: 0, 30, 50 → median = 30
    expect(t.summary().medianSlippageBps).toBeCloseTo(30, 6);
  });

  it("breaks down stats per symbol", () => {
    const t = new SlippageTracker();
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.5, volume: 1 }); // 50
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.1, volume: 1 }); // 10
    t.record({ symbol: "ETHUSDT", side: "sell", refPrice: 200, fillPrice: 199, volume: 1 }); // 50
    const s = t.summary();
    expect(s.bySymbol.BTCUSDT!.fills).toBe(2);
    expect(s.bySymbol.BTCUSDT!.meanSlippageBps).toBeCloseTo(30, 6); // (50+10)/2
    expect(s.bySymbol.ETHUSDT!.fills).toBe(1);
    expect(s.bySymbol.ETHUSDT!.meanSlippageBps).toBeCloseTo(50, 6);
  });

  it("ignores fills with invalid refPrice", () => {
    const t = new SlippageTracker();
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 0, fillPrice: 100, volume: 1 });
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: -5, fillPrice: 100, volume: 1 });
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: NaN, fillPrice: 100, volume: 1 });
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: Infinity, fillPrice: 100, volume: 1 });
    // one valid fill survives
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.5, volume: 1 });
    const s = t.summary();
    expect(s.fills).toBe(1);
    expect(s.meanSlippageBps).toBeCloseTo(50, 6);
  });

  it("ignores fills with non-finite fillPrice or volume", () => {
    const t = new SlippageTracker();
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: NaN, volume: 1 });
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.5, volume: Infinity });
    const s = t.summary();
    expect(s.fills).toBe(0);
  });

  it("totalCostQuote sign and magnitude aggregate signed across fills", () => {
    const t = new SlippageTracker();
    // +1.0 cost
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.5, volume: 2 }); // +1.0
    // -0.2 cost (price improvement on a sell above mid)
    t.record({ symbol: "BTCUSDT", side: "sell", refPrice: 100, fillPrice: 100.1, volume: 2 }); // -10 bps → -0.2
    const s = t.summary();
    // net = 1.0 - 0.2 = 0.8
    expect(s.totalCostQuote).toBeCloseTo(0.8, 6);
  });

  it("returns zeros on an empty tracker and a clear empty readout", () => {
    const t = new SlippageTracker();
    const s = t.summary();
    expect(s.fills).toBe(0);
    expect(s.meanSlippageBps).toBe(0);
    expect(s.medianSlippageBps).toBe(0);
    expect(s.totalCostQuote).toBe(0);
    expect(s.bySymbol).toEqual({});
    expect(t.format()).toContain("no fills");
  });

  it("format produces an operator readout with mean, median and per-symbol lines", () => {
    const t = new SlippageTracker();
    t.record({ symbol: "BTCUSDT", side: "buy", refPrice: 100, fillPrice: 100.5, volume: 1 });
    t.record({ symbol: "ETHUSDT", side: "sell", refPrice: 200, fillPrice: 199, volume: 1 });
    const out = t.format();
    expect(out).toContain("mean");
    expect(out).toContain("median");
    expect(out).toContain("BTCUSDT");
    expect(out).toContain("ETHUSDT");
  });
});
