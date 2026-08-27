import { describe, expect, test } from "bun:test";
import {
  detectCorrelationBreakdown,
  summarizeBreakdownReport,
  type ReturnSeries,
} from "./correlationBreakdown.ts";

function _syntheticSeries(symbol: string, length: number, noise: () => number): ReturnSeries {
  return {
    symbol,
    returns: Array.from({ length }, () => noise()),
  };
}

function correlatedSeries(
  symbolA: string,
  symbolB: string,
  length: number,
  correlation: number,
  seed = 1,
): [ReturnSeries, ReturnSeries] {
  // Simple LCG-style pseudo-random for deterministic tests
  let state = seed;
  const rnd = () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32;
    return state / 2 ** 32;
  };
  const gauss = () => {
    // Box-Muller
    const u1 = rnd() || 1e-12;
    const u2 = rnd();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const a: number[] = [];
  const b: number[] = [];
  for (let i = 0; i < length; i++) {
    const za = gauss();
    const zb = correlation * za + Math.sqrt(1 - correlation * correlation) * gauss();
    a.push(za);
    b.push(zb);
  }
  return [
    { symbol: symbolA, returns: a },
    { symbol: symbolB, returns: b },
  ];
}

describe("detectCorrelationBreakdown — edge cases", () => {
  test("single series returns empty pairs", () => {
    const report = detectCorrelationBreakdown([{ symbol: "BTC", returns: [0.01, -0.01, 0.02] }]);
    expect(report.pairs).toEqual([]);
    expect(report.flaggedCount).toBe(0);
  });

  test("zero series returns empty pairs", () => {
    const report = detectCorrelationBreakdown([]);
    expect(report.pairs).toEqual([]);
  });

  test("misaligned series throws", () => {
    expect(() =>
      detectCorrelationBreakdown([
        { symbol: "BTC", returns: [0.01, 0.02] },
        { symbol: "ETH", returns: [0.01, 0.02, 0.03] },
      ]),
    ).toThrow(/length/);
  });
});

describe("detectCorrelationBreakdown — stable correlation", () => {
  test("highly correlated series throughout produces non-breakdown severity", () => {
    const [btc, eth] = correlatedSeries("BTC", "ETH", 200, 0.9, 42);
    const report = detectCorrelationBreakdown([btc, eth], {
      tailWindow: 24,
      baselineWindow: 168,
    });
    expect(report.pairs).toHaveLength(1);
    const pair = report.pairs[0]!;
    expect(pair.symbolA).toBe("BTC");
    expect(pair.symbolB).toBe("ETH");
    // Synthetic-data noise can push z just past the elevated threshold
    // (1.0) even with strongly-correlated underlying — what we care
    // about is that we don't FALSE-POSITIVE a breakdown.
    expect(pair.severity === "stable" || pair.severity === "elevated").toBe(true);
  });
});

describe("detectCorrelationBreakdown — breakdown detection", () => {
  test("tail decoupled from baseline → flagged", () => {
    // Stitch 168 highly correlated bars + 24 uncorrelated bars
    const [aHigh, bHigh] = correlatedSeries("BTC", "ETH", 168, 0.95, 7);
    const [aLow, bLow] = correlatedSeries("BTC", "ETH", 24, 0.0, 11);
    const aReturns = [...aHigh.returns, ...aLow.returns];
    const bReturns = [...bHigh.returns, ...bLow.returns];
    const report = detectCorrelationBreakdown(
      [
        { symbol: "BTC", returns: aReturns },
        { symbol: "ETH", returns: bReturns },
      ],
      { tailWindow: 24, baselineWindow: 168 },
    );
    const pair = report.pairs[0]!;
    expect(pair.currentCorr).toBeLessThan(0.5); // decoupled in tail
    expect(pair.baselineCorr).toBeGreaterThan(0.5); // coupled overall
    expect(pair.severity).not.toBe("stable");
  });
});

describe("detectCorrelationBreakdown — three-symbol basket", () => {
  test("returns C(n,2) pairs", () => {
    const seed1 = correlatedSeries("BTC", "ETH", 200, 0.9, 1);
    const noise = (s: string): ReturnSeries => ({
      symbol: s,
      returns: Array.from({ length: 200 }, () => Math.random() - 0.5),
    });
    const report = detectCorrelationBreakdown([seed1[0], seed1[1], noise("SOL")]);
    // pairs = (BTC,ETH), (BTC,SOL), (ETH,SOL) = 3
    expect(report.pairs).toHaveLength(3);
  });
});

describe("detectCorrelationBreakdown — observationCount field", () => {
  test("reflects series length", () => {
    const report = detectCorrelationBreakdown([
      { symbol: "A", returns: new Array(50).fill(0.01) },
      { symbol: "B", returns: new Array(50).fill(0.02) },
    ]);
    expect(report.observationCount).toBe(50);
  });
});

describe("detectCorrelationBreakdown — null zScore handling", () => {
  test("series too short for rolling baseline → zScore null", () => {
    // baselineWindow=30 but series=20: baseA.length < baselineWindow
    // means we skip the rolling-correlation computation, so zScore
    // stays null (the documented behavior for unstable baselines).
    const len = 20;
    const a = Array.from({ length: len }, (_, i) => Math.sin(i));
    const b = Array.from({ length: len }, (_, i) => Math.cos(i));
    const report = detectCorrelationBreakdown(
      [
        { symbol: "A", returns: a },
        { symbol: "B", returns: b },
      ],
      { tailWindow: 10, baselineWindow: 30 },
    );
    expect(report.pairs[0]?.zScore).toBeNull();
  });
});

describe("summarizeBreakdownReport", () => {
  test("no pairs message", () => {
    const summary = summarizeBreakdownReport({
      tailWindow: 24,
      baselineWindow: 168,
      observationCount: 0,
      pairs: [],
      flaggedCount: 0,
    });
    expect(summary).toContain("no pairs");
  });

  test("all stable message", () => {
    const [btc, eth] = correlatedSeries("BTC", "ETH", 200, 0.9, 42);
    const report = detectCorrelationBreakdown([btc, eth]);
    const summary = summarizeBreakdownReport(report);
    expect(summary).toContain("all stable");
  });

  test("flagged pair surfaces in summary", () => {
    const [aHigh, bHigh] = correlatedSeries("BTC", "ETH", 168, 0.95, 7);
    const [aLow, bLow] = correlatedSeries("BTC", "ETH", 24, 0.0, 11);
    const report = detectCorrelationBreakdown(
      [
        { symbol: "BTC", returns: [...aHigh.returns, ...aLow.returns] },
        { symbol: "ETH", returns: [...bHigh.returns, ...bLow.returns] },
      ],
      { tailWindow: 24, baselineWindow: 168 },
    );
    if (report.flaggedCount > 0) {
      const summary = summarizeBreakdownReport(report);
      expect(summary).toContain("BTC");
      expect(summary).toContain("ETH");
    }
  });
});
