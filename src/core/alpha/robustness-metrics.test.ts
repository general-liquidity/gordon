import { describe, expect, test } from "bun:test";
import { computeRobustnessMetrics } from "./robustness-metrics.ts";

describe("computeRobustnessMetrics — percentile math anchor", () => {
  test("11-element 0..10 array: integer ranks (type-7 linear interp)", () => {
    // sorted = [0,1,2,3,4,5,6,7,8,9,10], n=11
    // q=0.5 → rank 5.0 → 5; q=0.1 → rank 1.0 → 1; q=0.9 → rank 9.0 → 9
    const r = computeRobustnessMetrics([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])!;
    expect(r).not.toBeNull();
    expect(r.count).toBe(11);
    expect(r.median).toBe(5);
    expect(r.p10).toBe(1);
    expect(r.p90).toBe(9);
    expect(r.min).toBe(0);
    expect(r.max).toBe(10);
    expect(r.mean).toBe(5);
  });

  test("5-element array: fractional ranks interpolate between order stats", () => {
    // sorted = [10,20,30,40,50], n=5
    // p10 rank 0.4 → 10+10*0.4 = 14; p90 rank 3.6 → 40+10*0.6 = 46; median rank 2.0 → 30
    const r = computeRobustnessMetrics([50, 10, 40, 20, 30])!;
    expect(r.median).toBe(30);
    expect(r.p10).toBe(14);
    expect(r.p90).toBe(46);
    // spread = (46-14)/(30+eps) ≈ 1.0667
    expect(r.normalizedPercentileSpread).toBeCloseTo(32 / 30.0001, 3);
    // downside loss = (30-14)/30 ≈ 0.5333 ; survival = 14/30 ≈ 0.4667
    expect(r.downsideRobustnessLoss).toBeCloseTo(16 / 30.0001, 3);
    expect(r.survivalRatio).toBeCloseTo(14 / 30.0001, 3);
  });
});

describe("computeRobustnessMetrics — verdicts", () => {
  test("tight distribution ~1.0 ± 0.05 → small spread, survival ~1, robust", () => {
    const outcomes = [0.96, 0.98, 1.0, 1.0, 1.01, 1.02, 1.03, 0.99, 1.04, 0.97];
    const r = computeRobustnessMetrics(outcomes)!;
    expect(r.verdict).toBe("robust");
    expect(r.normalizedPercentileSpread).toBeLessThan(0.5);
    expect(r.survivalRatio).toBeGreaterThan(0.5);
    expect(r.survivalRatio).toBeCloseTo(1, 1);
    expect(r.interpretation).toContain("ROBUST");
  });

  test("fat-tailed: median ~1 but p10 negative → survival < 0, fragile", () => {
    // most runs near 1 but a cluster of bad runs drags p10 below zero
    const outcomes = [-2.0, -1.5, -0.8, 0.9, 1.0, 1.0, 1.1, 1.05, 0.95, 1.0, 1.0, 1.0];
    const r = computeRobustnessMetrics(outcomes)!;
    expect(r.median).toBeGreaterThan(0.5);
    expect(r.p10).toBeLessThan(0);
    expect(r.survivalRatio).toBeLessThan(0);
    expect(r.verdict).toBe("fragile");
    expect(r.interpretation).toContain("FRAGILE");
  });

  test("wide-but-positive distribution → moderate", () => {
    // spread between 0.5 and 1.5, survival positive but below 0.5
    const outcomes = [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.4, 1.6, 0.5, 0.9];
    const r = computeRobustnessMetrics(outcomes)!;
    expect(r.survivalRatio).toBeGreaterThan(0);
    expect(r.normalizedPercentileSpread).toBeGreaterThanOrEqual(0.5);
    expect(r.normalizedPercentileSpread).toBeLessThanOrEqual(1.5);
    expect(r.verdict).toBe("moderate");
  });
});

describe("computeRobustnessMetrics — lower-is-better (drawdown)", () => {
  test("flips bad tail to the high end; tight low drawdowns read as robust", () => {
    // max drawdown values, lower is better. Tight cluster of small drawdowns.
    const outcomes = [0.04, 0.05, 0.05, 0.06, 0.05, 0.04, 0.06, 0.05, 0.05, 0.05];
    const r = computeRobustnessMetrics(outcomes, { higherIsBetter: false })!;
    expect(r.higherIsBetter).toBe(false);
    // downside loss uses (p90 - median); survival is -p90/(|median|+eps), negative here
    expect(r.downsideRobustnessLoss).toBeGreaterThanOrEqual(0);
    expect(r.survivalRatio).toBeLessThan(0);
    expect(r.interpretation).toContain("lower-is-better");
  });

  test("a fat upper tail (one catastrophic drawdown) widens the spread", () => {
    const tight = computeRobustnessMetrics(
      [0.04, 0.05, 0.05, 0.06, 0.05, 0.04, 0.06, 0.05, 0.05, 0.05],
      { higherIsBetter: false },
    )!;
    const fat = computeRobustnessMetrics(
      [0.04, 0.05, 0.05, 0.06, 0.05, 0.04, 0.06, 0.05, 0.05, 0.8],
      { higherIsBetter: false },
    )!;
    expect(fat.normalizedPercentileSpread).toBeGreaterThan(tight.normalizedPercentileSpread);
  });
});

describe("computeRobustnessMetrics — null guards", () => {
  test("returns null on fewer than 5 finite outcomes", () => {
    expect(computeRobustnessMetrics([1, 2, 3, 4])).toBeNull();
    expect(computeRobustnessMetrics([])).toBeNull();
  });

  test("non-finite values are dropped before the count check", () => {
    expect(computeRobustnessMetrics([1, NaN, 2, Infinity, 3, 4])).toBeNull(); // only 4 finite
    const r = computeRobustnessMetrics([1, NaN, 2, 3, 4, 5]);
    expect(r).not.toBeNull();
    expect(r!.count).toBe(5);
  });

  test("eps keeps ratios finite when median is ~0", () => {
    const r = computeRobustnessMetrics([-0.1, -0.05, 0, 0.05, 0.1, 0, 0, 0, 0, 0])!;
    expect(Number.isFinite(r.normalizedPercentileSpread)).toBe(true);
    expect(Number.isFinite(r.survivalRatio)).toBe(true);
  });
});
