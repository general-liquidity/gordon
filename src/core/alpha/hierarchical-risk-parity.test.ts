import { describe, expect, test } from "bun:test";
import {
  covarianceToCorrelation,
  correlationDistance,
  singleLinkage,
  quasiDiagonalize,
  recursiveBisection,
  hierarchicalRiskParity,
} from "./hierarchical-risk-parity.ts";

const sums1 = (w: number[]) => expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
const allNonNeg = (w: number[]) => expect(w.every((x) => x >= -1e-9)).toBe(true);

describe("covariance → correlation", () => {
  test("normalizes by standard deviations", () => {
    // cov: var0=0.04 (σ0=0.2), var1=0.01 (σ1=0.1), cov01=0.01.
    // ρ01 = 0.01 / (0.2·0.1) = 0.5.
    const cov = [
      [0.04, 0.01],
      [0.01, 0.01],
    ];
    const corr = covarianceToCorrelation(cov);
    expect(corr[0]![0]!).toBe(1);
    expect(corr[1]![1]!).toBe(1);
    expect(corr[0]![1]!).toBeCloseTo(0.5, 10);
    expect(corr[1]![0]!).toBeCloseTo(0.5, 10);
  });
});

describe("correlation → distance d = √((1−ρ)/2)", () => {
  test("hand-computed values at ρ = 1, 0.5, 0, −1", () => {
    const corr = [
      [1, 0.5, 0, -1],
      [0.5, 1, 0, 0],
      [0, 0, 1, 0],
      [-1, 0, 0, 1],
    ];
    const d = correlationDistance(corr);
    expect(d[0]![0]!).toBeCloseTo(0, 10); // ρ=1 → 0
    expect(d[0]![1]!).toBeCloseTo(Math.sqrt(0.25), 10); // ρ=0.5 → √0.25 = 0.5
    expect(d[0]![2]!).toBeCloseTo(Math.sqrt(0.5), 10); // ρ=0 → √0.5
    expect(d[0]![3]!).toBeCloseTo(1, 10); // ρ=−1 → 1
  });
});

describe("single linkage", () => {
  test("merges the two closest assets first on a tiny distance matrix", () => {
    // Assets 0 and 1 are closest (d=0.1); 2 is far from both.
    const dist = [
      [0, 0.1, 0.9],
      [0.1, 0, 0.8],
      [0.9, 0.8, 0],
    ];
    const linkage = singleLinkage(dist);
    expect(linkage.length).toBe(2);
    // First merge: the closest pair (0,1) at distance 0.1. ml-hclust's agnes
    // orders the two children (higher-index first) so left/right may be swapped
    // vs the original hand-rolled order — sort to assert the unordered pair.
    expect(linkage[0]!.distance).toBeCloseTo(0.1, 10);
    expect([linkage[0]!.left, linkage[0]!.right].sort((a, b) => a - b)).toEqual([0, 1]);
    expect(linkage[0]!.size).toBe(2);
    // Second merge joins the {0,1} cluster with leaf 2 at single-linkage
    // distance min(0.9, 0.8) = 0.8.
    expect(linkage[1]!.distance).toBeCloseTo(0.8, 10);
    expect(linkage[1]!.size).toBe(3);
  });
});

describe("quasi-diagonalization", () => {
  test("returns a permutation of all leaves", () => {
    const dist = [
      [0, 0.1, 0.9, 0.95],
      [0.1, 0, 0.85, 0.9],
      [0.9, 0.85, 0, 0.2],
      [0.95, 0.9, 0.2, 0],
    ];
    const linkage = singleLinkage(dist);
    const order = quasiDiagonalize(linkage, 4);
    expect(order.length).toBe(4);
    expect([...order].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    // The two close pairs {0,1} and {2,3} should each be adjacent.
    const pos = new Map(order.map((id, idx) => [id, idx]));
    expect(Math.abs(pos.get(0)! - pos.get(1)!)).toBe(1);
    expect(Math.abs(pos.get(2)! - pos.get(3)!)).toBe(1);
  });

  test("trivial n=1 and degenerate cases", () => {
    expect(quasiDiagonalize([], 1)).toEqual([0]);
    expect(quasiDiagonalize([], 0)).toEqual([]);
  });
});

describe("recursive bisection", () => {
  test("low-variance asset gets more weight (diagonal cov, MATH-ANCHOR)", () => {
    // Two uncorrelated assets, var0=0.01, var1=0.04. Seriated order [0,1].
    // Split: left={0} V=0.01, right={1} V=0.04. denom=0.05.
    // alpha = 1 − 0.01/0.05 = 0.8 → w0=0.8, w1=0.2.
    const cov = [
      [0.01, 0],
      [0, 0.04],
    ];
    const w = recursiveBisection(cov, [0, 1]);
    expect(w[0]!).toBeCloseTo(0.8, 10);
    expect(w[1]!).toBeCloseTo(0.2, 10);
    sums1(w);
    expect(w[0]!).toBeGreaterThan(w[1]!); // lower-variance asset weighted more
  });
});

describe("hierarchicalRiskParity", () => {
  test("end-to-end on a 4-asset block-correlated covariance", () => {
    // Two blocks: {0,1} highly correlated, {2,3} highly correlated, blocks
    // weakly correlated. HRP should seriate the blocks adjacently and split
    // risk sensibly. Variances differ so weights differ.
    const cov = [
      [0.04, 0.035, 0.002, 0.001],
      [0.035, 0.04, 0.002, 0.001],
      [0.002, 0.002, 0.01, 0.008],
      [0.001, 0.001, 0.008, 0.01],
    ];
    const r = hierarchicalRiskParity({ covariance: cov, labels: ["A", "B", "C", "D"] });
    expect(r).not.toBeNull();
    sums1(r!.weights);
    allNonNeg(r!.weights);
    expect(r!.seriatedOrder.length).toBe(4);
    expect([...r!.seriatedOrder].sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
    // Low-variance block {2,3} should collectively outweigh high-variance {0,1}.
    const wHigh = r!.weights[0]! + r!.weights[1]!;
    const wLow = r!.weights[2]! + r!.weights[3]!;
    expect(wLow).toBeGreaterThan(wHigh);
    expect(r!.interpretation).toContain("HRP");
  });

  test("accepts a returns matrix (assets × observations)", () => {
    // Asset 0 low-vol, asset 1 high-vol, near-uncorrelated.
    const returns = [
      [0.01, -0.01, 0.012, -0.011, 0.009, -0.008, 0.01, -0.01],
      [0.05, -0.05, 0.06, -0.055, 0.045, -0.04, 0.05, -0.05],
    ];
    const r = hierarchicalRiskParity({ returns });
    expect(r).not.toBeNull();
    sums1(r!.weights);
    expect(r!.weights[0]!).toBeGreaterThan(r!.weights[1]!); // low-vol asset weighted more
  });

  test("seriation is reflection-stable: ml-hclust leaf order yields the golden HRP weights", () => {
    // Parity lock for the ml-hclust (agnes, single-linkage) migration. agnes
    // emits children higher-index-first, so the seriation is a within-block
    // reflection of the old hand-rolled order — but recursive bisection is
    // invariant to those reflections, so the weights are byte-identical to the
    // pre-migration golden. This 6-asset matrix exercises nested blocks.
    const cov = [
      [0.04, 0.03, 0.002, 0.001, 0.015, 0.005],
      [0.03, 0.05, 0.003, 0.002, 0.012, 0.004],
      [0.002, 0.003, 0.01, 0.008, 0.001, 0.006],
      [0.001, 0.002, 0.008, 0.012, 0.002, 0.007],
      [0.015, 0.012, 0.001, 0.002, 0.03, 0.009],
      [0.005, 0.004, 0.006, 0.007, 0.009, 0.02],
    ];
    const r = hierarchicalRiskParity({ covariance: cov });
    expect(r).not.toBeNull();
    expect(r!.weights).toEqual([0.066619, 0.053295, 0.271432, 0.226194, 0.148042, 0.234419]);
    // Seriation keeps each correlated block contiguous (reflected vs the old order).
    expect(r!.seriatedOrder).toEqual([5, 3, 2, 4, 1, 0]);
  });

  test("NULL on insufficient input", () => {
    expect(hierarchicalRiskParity({ covariance: [[0.04]] })).toBeNull(); // 1 asset
    expect(hierarchicalRiskParity({})).toBeNull(); // nothing
    expect(hierarchicalRiskParity({ returns: [[0.01], [0.02]] })).toBeNull(); // <2 obs
    expect(hierarchicalRiskParity({ covariance: [[0.04, 0.01]] })).toBeNull(); // non-square
  });
});
