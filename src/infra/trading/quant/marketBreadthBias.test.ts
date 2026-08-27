import { describe, it, expect } from "bun:test";
import { computeMarketBreadthBias, marketBreadthBiasToPayload } from "./marketBreadthBias.ts";

describe("computeMarketBreadthBias — validation", () => {
  it("rejects empty returns", () => {
    expect(() => computeMarketBreadthBias({ returns: [] })).toThrow();
  });

  it("rejects bullishThreshold out of (0,1]", () => {
    expect(() => computeMarketBreadthBias({ returns: [0.1], bullishThreshold: 0 })).toThrow();
    expect(() => computeMarketBreadthBias({ returns: [0.1], bullishThreshold: 1.5 })).toThrow();
  });

  it("rejects bearishThreshold out of (0,1]", () => {
    expect(() => computeMarketBreadthBias({ returns: [0.1], bearishThreshold: 0 })).toThrow();
  });

  it("rejects negative flatThreshold", () => {
    expect(() => computeMarketBreadthBias({ returns: [0.1], flatThreshold: -0.01 })).toThrow();
  });

  it("rejects non-finite returns", () => {
    expect(() => computeMarketBreadthBias({ returns: [0.1, NaN, 0.2] })).toThrow();
    expect(() => computeMarketBreadthBias({ returns: [0.1, Infinity] })).toThrow();
  });
});

describe("computeMarketBreadthBias — classification", () => {
  it("≥70% positive → bullish (default threshold)", () => {
    // 8 of 10 positive
    const r = computeMarketBreadthBias({
      returns: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, -0.01, -0.02],
    });
    expect(r.positiveFraction).toBe(0.8);
    expect(r.bias).toBe("bullish");
  });

  it("≥70% negative → bearish (default threshold)", () => {
    const r = computeMarketBreadthBias({
      returns: [-0.01, -0.02, -0.03, -0.04, -0.05, -0.06, -0.07, -0.08, 0.01, 0.02],
    });
    expect(r.negativeFraction).toBe(0.8);
    expect(r.bias).toBe("bearish");
  });

  it("balanced (50/50) → balanced", () => {
    const r = computeMarketBreadthBias({
      returns: [0.01, 0.02, 0.03, 0.04, 0.05, -0.01, -0.02, -0.03, -0.04, -0.05],
    });
    expect(r.bias).toBe("balanced");
    expect(r.positiveFraction).toBe(0.5);
    expect(r.negativeFraction).toBe(0.5);
  });

  it("just below 70% positive → balanced", () => {
    // 6 of 10 positive = 0.6 < 0.70 default threshold
    const r = computeMarketBreadthBias({
      returns: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, -0.01, -0.02, -0.03, -0.04],
    });
    expect(r.positiveFraction).toBe(0.6);
    expect(r.bias).toBe("balanced");
  });
});

describe("computeMarketBreadthBias — flat threshold", () => {
  it("returns within flatThreshold count as flat", () => {
    const r = computeMarketBreadthBias({
      returns: [0.005, -0.005, 0.05, -0.05, 0.005],
      flatThreshold: 0.01, // |return| ≤ 0.01 is flat
    });
    expect(r.flatCount).toBe(3);
    expect(r.positiveCount).toBe(1);
    expect(r.negativeCount).toBe(1);
  });
});

describe("computeMarketBreadthBias — custom thresholds", () => {
  it("looser bullish threshold (0.55) catches mild positive bias", () => {
    // 6 of 10 positive = 0.6 ≥ 0.55
    const r = computeMarketBreadthBias({
      returns: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, -0.01, -0.02, -0.03, -0.04],
      bullishThreshold: 0.55,
    });
    expect(r.bias).toBe("bullish");
  });

  it("strict bullish threshold (0.90) rejects mild positive bias", () => {
    // 8 of 10 positive = 0.8 < 0.90
    const r = computeMarketBreadthBias({
      returns: [0.01, 0.02, 0.03, 0.04, 0.05, 0.06, 0.07, 0.08, -0.01, -0.02],
      bullishThreshold: 0.9,
    });
    expect(r.bias).toBe("balanced");
  });
});

describe("computeMarketBreadthBias — statistics", () => {
  it("computes mean and median correctly", () => {
    const r = computeMarketBreadthBias({
      returns: [-0.04, -0.02, 0, 0.02, 0.04],
    });
    expect(r.meanReturn).toBeCloseTo(0, 6);
    expect(r.medianReturn).toBeCloseTo(0, 6);
  });

  it("median handles even-length arrays", () => {
    const r = computeMarketBreadthBias({
      returns: [-0.04, -0.02, 0.02, 0.04],
    });
    expect(r.medianReturn).toBeCloseTo(0, 6);
  });
});

describe("marketBreadthBiasToPayload", () => {
  it("emits stable shape", () => {
    const r = computeMarketBreadthBias({
      returns: [0.01, 0.02, 0.03, -0.01],
    });
    const p = marketBreadthBiasToPayload(r) as {
      kind: string;
      bias: string;
      total: number;
    };
    expect(p.kind).toBe("market_breadth_bias.computed");
    expect(p.total).toBe(4);
  });
});
