import { describe, expect, test } from "bun:test";
import {
  chiSquareSf,
  ksPValue,
  conditionalDistributionTest,
} from "./conditional-distribution-test.ts";

describe("chiSquareSf", () => {
  test("matches known χ²₉ critical values", () => {
    // 0.95 quantile of χ²₉ ≈ 16.919 → upper tail 0.05.
    expect(chiSquareSf(16.919, 9)).toBeCloseTo(0.05, 2);
    // 0.99 quantile ≈ 21.666 → upper tail 0.01.
    expect(chiSquareSf(21.666, 9)).toBeCloseTo(0.01, 2);
    // Median of χ²₉ ≈ 8.343 → upper tail 0.5.
    expect(chiSquareSf(8.343, 9)).toBeCloseTo(0.5, 1);
  });
  test("Q=0 → p=1, large Q → p→0", () => {
    expect(chiSquareSf(0, 9)).toBe(1);
    expect(chiSquareSf(100, 9)).toBeLessThan(1e-6);
  });
});

describe("ksPValue", () => {
  test("matches known Kolmogorov critical values", () => {
    expect(ksPValue(1.358)).toBeCloseTo(0.05, 2);
    expect(ksPValue(1.628)).toBeCloseTo(0.01, 2);
  });
  test("γ=0 → 1, large γ → 0", () => {
    expect(ksPValue(0)).toBe(1);
    expect(ksPValue(5)).toBeLessThan(1e-6);
  });
});

describe("conditionalDistributionTest", () => {
  // Deterministic uniform-on-[-3,3] ramp (no Math.random — reproducible).
  const ramp = (n: number, lo: number, hi: number): number[] =>
    Array.from({ length: n }, (_, i) => lo + ((hi - lo) * i) / (n - 1));

  test("flags a strongly shifted conditional sample as informative", () => {
    const uncond = ramp(200, -3, 3);
    const cond = ramp(100, 2, 8); // clearly higher returns after the signal
    const r = conditionalDistributionTest({
      conditionalReturns: cond,
      unconditionalReturns: uncond,
      normalize: false,
    });
    expect(r.informative).toBe(true);
    expect(r.ks.pValue).toBeLessThan(0.05);
    expect(r.chiSquare.pValue).toBeLessThan(0.05);
  });

  test("does not flag a same-distribution conditional sample", () => {
    const uncond = ramp(200, -3, 3);
    const cond = ramp(100, -3, 3); // same distribution shape
    const r = conditionalDistributionTest({
      conditionalReturns: cond,
      unconditionalReturns: uncond,
    });
    expect(r.informative).toBe(false);
    expect(r.ks.pValue).toBeGreaterThan(0.05);
  });

  test("decile bookkeeping is consistent", () => {
    const uncond = ramp(200, -3, 3);
    const cond = ramp(100, -1, 4);
    const r = conditionalDistributionTest({ conditionalReturns: cond, unconditionalReturns: uncond });
    const totalCounts = r.chiSquare.decileCounts.reduce((s, c) => s + c, 0);
    expect(totalCounts).toBe(100);
    const totalFrac = r.chiSquare.decileFractions.reduce((s, f) => s + f, 0);
    expect(totalFrac).toBeCloseTo(1, 5);
    expect(r.chiSquare.df).toBe(9);
  });

  test("guards against tiny samples", () => {
    const r = conditionalDistributionTest({
      conditionalReturns: [1, 2, 3],
      unconditionalReturns: [1, 2, 3, 4, 5],
    });
    expect(r.informative).toBe(false);
    expect(r.summary).toContain("Insufficient");
  });
});
