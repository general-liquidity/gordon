import { describe, it, expect } from "bun:test";
import {
  isMtfRsiEnabled,
  computeMtfRsi,
  mtfRsiToPayload,
  MTF_RSI_FLAG_ENV,
} from "./multiTimeframeRsi.ts";

describe("isMtfRsiEnabled", () => {
  it("respects the flag", () => {
    expect(isMtfRsiEnabled({})).toBe(false);
    expect(isMtfRsiEnabled({ [MTF_RSI_FLAG_ENV]: "1" })).toBe(true);
  });
});

function rising(n: number, start = 100, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}
function falling(n: number, start = 200, step = 1): number[] {
  return Array.from({ length: n }, (_, i) => start - i * step);
}

describe("computeMtfRsi", () => {
  it("no data → reasoning explains why", () => {
    const r = computeMtfRsi({ closes: {} });
    expect(r.totalCount).toBe(0);
    expect(r.reasoning).toContain("no timeframe");
  });

  it("all timeframes rising → all overbought, short bias (mean reversion)", () => {
    const r = computeMtfRsi({
      closes: {
        "5m": rising(50),
        "15m": rising(50),
        "1h": rising(50),
        "4h": rising(50),
        "1d": rising(50),
      },
    });
    expect(r.totalCount).toBe(5);
    expect(r.weightedAverage).toBeGreaterThan(80);
    expect(r.dominantZone).toBe("overbought");
    expect(r.bias).toBe("short");
  });

  it("all timeframes falling → oversold, long bias", () => {
    const r = computeMtfRsi({
      closes: {
        "5m": falling(50),
        "15m": falling(50),
        "1h": falling(50),
        "4h": falling(50),
        "1d": falling(50),
      },
    });
    expect(r.weightedAverage).toBeLessThan(20);
    expect(r.dominantZone).toBe("oversold");
    expect(r.bias).toBe("long");
  });

  it("higher timeframes weighted heavier than lower", () => {
    // 5m falling hard, 1d rising hard. Weighted should lean to 1d.
    const r = computeMtfRsi({
      closes: {
        "5m": falling(50),
        "1d": rising(50),
      },
    });
    expect(r.weightedAverage).toBeGreaterThan(50);
  });

  it("custom weights respected", () => {
    const r = computeMtfRsi({
      closes: {
        "5m": rising(50),
        "1d": falling(50),
      },
      weights: { "5m": 10, "1d": 1 },
    });
    // 5m dominates with custom weight → weighted average should be high
    expect(r.weightedAverage).toBeGreaterThan(50);
  });

  it("skips timeframes with insufficient data", () => {
    const r = computeMtfRsi({
      closes: {
        "5m": rising(50),
        "1d": [1, 2, 3], // too short
      },
    });
    expect(r.totalCount).toBe(1);
    expect(r.perTimeframe[0]!.timeframe).toBe("5m");
  });

  it("mixed signals → neutral bias", () => {
    // Oscillating prices keep RSI in the 40-60 range.
    const oscillating: number[] = [];
    let p = 100;
    for (let i = 0; i < 60; i++) {
      p += i % 2 === 0 ? 1 : -1;
      oscillating.push(p);
    }
    const r = computeMtfRsi({
      closes: {
        "1h": oscillating,
        "4h": oscillating,
      },
    });
    expect(r.weightedAverage).toBeGreaterThan(30);
    expect(r.weightedAverage).toBeLessThan(70);
    expect(["neutral", "uptrend", "downtrend"]).toContain(r.dominantZone);
  });

  it("custom overbought/oversold thresholds", () => {
    const r = computeMtfRsi({
      closes: {
        "1h": rising(50),
        "4h": rising(50),
      },
      overbought: 60,
      oversold: 40,
    });
    expect(r.dominantZone).toBe("overbought");
  });
});

describe("mtfRsiToPayload", () => {
  it("emits stable shape with per-TF entries", () => {
    const r = computeMtfRsi({
      closes: { "1h": rising(50), "4h": falling(50) },
    });
    const p = mtfRsiToPayload(r) as {
      kind: string;
      perTimeframe: Array<{ timeframe: string; zone: string }>;
    };
    expect(p.kind).toBe("mtf_rsi.computed");
    expect(p.perTimeframe.length).toBe(2);
  });

  it("emits null weightedAverage when no data", () => {
    const p = mtfRsiToPayload(computeMtfRsi({ closes: {} })) as {
      weightedAverage: number | null;
    };
    expect(p.weightedAverage).toBeNull();
  });
});
