import { describe, expect, test } from "bun:test";
import { pairedTTest, mannWhitneyU, twoSamplePnlTest } from "./twoSampleTest.ts";

describe("pairedTTest", () => {
  test("null on unequal lengths", () => {
    expect(pairedTTest([1, 2, 3], [1, 2])).toBeNull();
  });

  test("null on zero-variance differences (identical samples)", () => {
    expect(pairedTTest([1, 2, 3, 4], [1, 2, 3, 4])).toBeNull();
  });

  test("constant positive shift → large t, tiny p, meanDiff = shift", () => {
    // a is b + 5 with a little variation so the diff has variance.
    const b = [1, 2, 3, 4, 5, 6];
    const a = b.map((x, i) => x + 5 + (i % 2 === 0 ? 0.1 : -0.1));
    const r = pairedTTest(a, b)!;
    expect(r).not.toBeNull();
    expect(r.df).toBe(5);
    expect(r.meanDiff).toBeCloseTo(5, 4);
    expect(r.pValue).toBeLessThan(0.01);
  });
});

describe("mannWhitneyU", () => {
  test("hand-verified: a=[1,2,3], b=[4,5,6] → U=0", () => {
    const r = mannWhitneyU([1, 2, 3], [4, 5, 6])!;
    expect(r).not.toBeNull();
    expect(r.u).toBe(0);
  });

  test("hand-verified reverse: a=[4,5,6], b=[1,2,3] → U=0", () => {
    const r = mannWhitneyU([4, 5, 6], [1, 2, 3])!;
    expect(r.u).toBe(0);
  });

  test("identical distributions → U near n1*n2/2, large p", () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 2, 3, 4, 5];
    const r = mannWhitneyU(a, b)!;
    // Perfectly tied → z ≈ 0, p ≈ 1.
    expect(Math.abs(r.z)).toBeLessThan(1e-6);
    expect(r.pValue).toBeGreaterThan(0.99);
  });

  test("null on empty sample", () => {
    expect(mannWhitneyU([], [1, 2, 3])).toBeNull();
  });
});

describe("twoSamplePnlTest", () => {
  test("identical samples → not significant, p≈1", () => {
    const s = [0.1, -0.2, 0.3, -0.1, 0.05, 0.2, -0.15];
    const r = twoSamplePnlTest({ baseline: s, scenario: s.slice() })!;
    expect(r).not.toBeNull();
    expect(r.significantlyDifferent).toBe(false);
    expect(r.mannWhitney.pValue).toBeGreaterThan(0.9);
    // paired-t present (equal length) but null-collapsed to undefined on zero variance.
    expect(r.paired).toBeUndefined();
  });

  test("large location shift → significant, p<0.05", () => {
    const baseline = [0, 1, -1, 0.5, -0.5, 0.2, -0.3, 0.1, -0.1, 0];
    // Shift by a large amount with slight per-element jitter so the paired
    // differences have non-zero variance (a constant shift collapses paired-t).
    const scenario = baseline.map((x, i) => x + 10 + (i % 2 === 0 ? 0.2 : -0.2));
    const r = twoSamplePnlTest({ baseline, scenario })!;
    expect(r.significantlyDifferent).toBe(true);
    expect(r.mannWhitney.pValue).toBeLessThan(0.05);
    expect(r.paired).toBeDefined();
    expect(r.paired!.pValue).toBeLessThan(0.05);
    expect(r.interpretation).toContain("DIFFERS");
  });

  test("unequal lengths → Mann-Whitney only, paired skipped", () => {
    const baseline = [1, 2, 3, 4, 5, 6, 7];
    const scenario = [10, 11, 12, 13, 14];
    const r = twoSamplePnlTest({ baseline, scenario })!;
    expect(r.paired).toBeUndefined();
    expect(r.mannWhitney).toBeDefined();
    expect(r.significantlyDifferent).toBe(true);
  });

  test("null when a sample is below MIN_SAMPLE", () => {
    expect(twoSamplePnlTest({ baseline: [1, 2, 3], scenario: [1, 2, 3, 4, 5] })).toBeNull();
  });

  test("null on non-finite inputs", () => {
    expect(twoSamplePnlTest({ baseline: [1, 2, 3, 4, NaN], scenario: [1, 2, 3, 4, 5] })).toBeNull();
  });

  test("custom alpha respected", () => {
    // A modest shift that is significant at 0.10 but possibly not at 0.01.
    const baseline = [0, 1, 2, 3, 4, 5, 6, 7];
    const scenario = baseline.map((x) => x + 3);
    const loose = twoSamplePnlTest({ baseline, scenario, alpha: 0.1 })!;
    expect(loose.interpretation).toContain("α=0.1");
  });
});
