import { test, expect, describe } from "bun:test";
import {
  calculateTailRatio,
  calculateRollingSharpe,
  calculateRollingBeta,
  extractDrawdownPeriods,
} from "./metrics.ts";
import type { EquityPoint } from "./types.ts";

describe("calculateTailRatio", () => {
  test("null when fewer than 20 observations", () => {
    expect(calculateTailRatio([0.01, -0.02, 0.03])).toBeNull();
  });

  test("MATH ANCHOR: symmetric ladder -10..+10 → ratio ~1", () => {
    // 21 evenly spaced returns from -0.10 to +0.10 (step 0.01).
    const returns: number[] = [];
    for (let i = -10; i <= 10; i++) returns.push(i / 100);
    // sorted length 21. p95 rank = 0.95*20 = 19 → value index19 = 0.09
    // p05 rank = 0.05*20 = 1 → value index1 = -0.09
    // ratio = 0.09 / |-0.09| = 1.0
    expect(calculateTailRatio(returns)).toBeCloseTo(1.0, 4);
  });

  test("MATH ANCHOR: fat right tail → ratio > 1", () => {
    // 20 small negatives + huge positives skew the 95th up.
    const returns = [
      -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, -0.01, 0.2, 0.18, 0.16, 0.14,
      0.12, 0.1, 0.08, 0.06, 0.04, 0.02,
    ];
    const ratio = calculateTailRatio(returns);
    expect(ratio).not.toBeNull();
    expect(ratio!).toBeGreaterThan(1);
  });

  test("null when 5th percentile is zero", () => {
    const returns = new Array(20).fill(0).map((_, i) => (i < 19 ? 0 : 0.5));
    expect(calculateTailRatio(returns)).toBeNull();
  });
});

describe("calculateRollingSharpe", () => {
  test("empty when series shorter than window", () => {
    expect(calculateRollingSharpe([0.01, 0.02], 5)).toEqual([]);
  });

  test("MATH ANCHOR: length = N - window + 1", () => {
    const returns = Array.from({ length: 100 }, (_, i) => Math.sin(i) * 0.01);
    const window = 63;
    const result = calculateRollingSharpe(returns, window);
    expect(result.length).toBe(100 - 63 + 1); // 38
  });

  test("default window 63", () => {
    const returns = Array.from({ length: 70 }, () => 0.001);
    const result = calculateRollingSharpe(returns);
    expect(result.length).toBe(70 - 63 + 1); // 8
  });
});

describe("calculateRollingBeta", () => {
  test("null when no benchmark", () => {
    expect(calculateRollingBeta([0.01, 0.02], null)).toBeNull();
    expect(calculateRollingBeta([0.01, 0.02], undefined)).toBeNull();
  });

  test("empty when lengths mismatch", () => {
    expect(calculateRollingBeta([0.01, 0.02, 0.03], [0.01], 2)).toEqual([]);
  });

  test("MATH ANCHOR: strategy = 2× benchmark → beta = 2", () => {
    const bench = Array.from({ length: 10 }, (_, i) => ((i % 3) - 1) * 0.01);
    const strat = bench.map((b) => 2 * b);
    const result = calculateRollingBeta(strat, bench, 5);
    expect(result).not.toBeNull();
    for (const beta of result!) {
      expect(beta).toBeCloseTo(2, 4);
    }
  });

  test("length = N - window + 1", () => {
    const bench = Array.from({ length: 80 }, (_, i) => Math.cos(i) * 0.01);
    const strat = bench.map((b) => b * 1.5);
    const result = calculateRollingBeta(strat, bench, 63);
    expect(result).not.toBeNull();
    expect(result!.length).toBe(80 - 63 + 1); // 18
  });
});

describe("extractDrawdownPeriods", () => {
  const mk = (values: number[]): EquityPoint[] =>
    values.map((equity, i) => ({ timestamp: i, equity }));

  test("empty for flat/short curve", () => {
    expect(extractDrawdownPeriods(mk([100]))).toEqual([]);
    expect(extractDrawdownPeriods(mk([100, 101, 102, 103]))).toEqual([]);
  });

  test("MATH ANCHOR: two distinct drawdowns extracted and ranked by depth", () => {
    // idx:    0    1   2   3    4    5   6    7    8
    // equity:100  90  80 100  120  108 96  120  120
    //
    // Episode A: peak at idx0 (100), trough idx2 (80), recovers at idx3 (100).
    //   depth = (100-80)/100 = 20% ; start0 trough2 end3 length3
    // Episode B: peak at idx4 (120), trough idx6 (96), recovers at idx7 (120).
    //   depth = (120-96)/120 = 20% ... make B shallower to test ordering:
    const curve = mk([100, 90, 80, 100, 120, 110, 108, 120, 120]);
    // Recompute episode B: peak idx4=120, trough idx6=108 → (120-108)/120 = 10%
    const periods = extractDrawdownPeriods(curve);
    expect(periods.length).toBe(2);

    // Deepest first.
    const deepest = periods[0]!;
    expect(deepest.depth).toBeCloseTo(20, 4);
    expect(deepest.startIdx).toBe(0);
    expect(deepest.troughIdx).toBe(2);
    expect(deepest.endIdx).toBe(3);
    expect(deepest.lengthBars).toBe(3);

    const shallow = periods[1]!;
    expect(shallow.depth).toBeCloseTo(10, 4);
    expect(shallow.startIdx).toBe(4);
    expect(shallow.troughIdx).toBe(6);
    expect(shallow.endIdx).toBe(7);
    expect(shallow.lengthBars).toBe(3);
  });

  test("unrecovered final drawdown ends at last index", () => {
    // peak idx0=100, falls and never recovers.
    const curve = mk([100, 95, 90, 85]);
    const periods = extractDrawdownPeriods(curve);
    expect(periods.length).toBe(1);
    expect(periods[0]!.startIdx).toBe(0);
    expect(periods[0]!.troughIdx).toBe(3);
    expect(periods[0]!.endIdx).toBe(3);
    expect(periods[0]!.depth).toBeCloseTo(15, 4);
  });

  test("topN caps the result", () => {
    // three drawdowns of decreasing depth
    const curve = mk([100, 70, 100, 90, 100, 95, 100]);
    const periods = extractDrawdownPeriods(curve, 2);
    expect(periods.length).toBe(2);
    expect(periods[0]!.depth).toBeGreaterThan(periods[1]!.depth);
  });
});
