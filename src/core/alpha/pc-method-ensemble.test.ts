import { describe, expect, test } from "bun:test";
import {
  equalWeightPortfolio,
  inverseVolatilityPortfolio,
  inverseVariancePortfolio,
  riskParityPortfolio,
  maxDiversificationPortfolio,
  runRiskStructuredBench,
  bordaCount,
  adversarialDiversifier,
  combineEnsemble,
} from "./pc-method-ensemble.ts";

const sums1 = (w: number[]) => expect(w.reduce((s, x) => s + x, 0)).toBeCloseTo(1, 6);
const allNonNeg = (w: number[]) => expect(w.every((x) => x >= -1e-9)).toBe(true);

// Uncorrelated 2-asset covariance: σ = [0.2, 0.1].
const diagCov = [
  [0.04, 0],
  [0, 0.01],
];

describe("risk-structured PC methods", () => {
  test("equal weight", () => {
    expect(equalWeightPortfolio(4)).toEqual([0.25, 0.25, 0.25, 0.25]);
  });

  test("inverse volatility ∝ 1/σ", () => {
    const w = inverseVolatilityPortfolio(diagCov); // 1/0.2 : 1/0.1 = 5 : 10
    expect(w[0]!).toBeCloseTo(1 / 3, 4);
    expect(w[1]!).toBeCloseTo(2 / 3, 4);
    sums1(w);
  });

  test("inverse variance ∝ 1/σ²", () => {
    const w = inverseVariancePortfolio(diagCov); // 1/0.04 : 1/0.01 = 25 : 100
    expect(w[0]!).toBeCloseTo(0.2, 4);
    expect(w[1]!).toBeCloseTo(0.8, 4);
  });

  test("risk parity equalizes risk contributions (= inverse-vol when uncorrelated)", () => {
    const { weights, converged } = riskParityPortfolio(diagCov);
    expect(converged).toBe(true);
    expect(weights[0]!).toBeCloseTo(1 / 3, 2);
    expect(weights[1]!).toBeCloseTo(2 / 3, 2);
    // Risk contributions w_i·(Σw)_i should be equal.
    const sw = [diagCov[0]![0]! * weights[0]!, diagCov[1]![1]! * weights[1]!];
    const rc = [weights[0]! * sw[0]!, weights[1]! * sw[1]!];
    expect(rc[0]!).toBeCloseTo(rc[1]!, 5);
  });

  test("max diversification (= inverse-vol when uncorrelated)", () => {
    const w = maxDiversificationPortfolio(diagCov);
    expect(w[0]!).toBeCloseTo(1 / 3, 2);
    expect(w[1]!).toBeCloseTo(2 / 3, 2);
  });

  test("the full bench returns 5 valid long-only proposals", () => {
    const cov = [
      [0.04, 0.01, 0.0],
      [0.01, 0.02, 0.005],
      [0.0, 0.005, 0.03],
    ];
    const bench = runRiskStructuredBench(cov);
    expect(bench.length).toBe(5);
    for (const p of bench) {
      expect(p.weights.length).toBe(3);
      sums1(p.weights);
      allNonNeg(p.weights);
    }
  });
});

describe("bordaCount", () => {
  test("aggregates top-N rankings and bottom flags", () => {
    const r = bordaCount(
      [
        { voter: "v1", ranking: ["A", "B", "C"] },
        { voter: "v2", ranking: ["A", "B", "C"], bottomFlags: ["C"] },
      ],
      { topN: 5, bottomPenalty: -2 },
    );
    // A: 5+5=10, B: 4+4=8, C: 3+3-2=4
    expect(r.scores.A).toBe(10);
    expect(r.scores.B).toBe(8);
    expect(r.scores.C).toBe(4);
    expect(r.ranking[0]).toBe("A");
    expect(r.ranking[r.ranking.length - 1]).toBe("C");
  });
});

describe("adversarialDiversifier", () => {
  const cov = [
    [0.04, 0.0, 0.0],
    [0.0, 0.04, 0.0],
    [0.0, 0.0, 0.04],
  ];
  const candidates = [
    [1 / 3, 1 / 3, 1 / 3],
    [0.6, 0.2, 0.2],
  ];

  test("produces a valid, non-trivial portfolio orthogonal to consensus", () => {
    const r = adversarialDiversifier({
      candidateWeights: candidates,
      cov,
      sharpeFloorFraction: 0, // means default to zero → floor 0, always feasible
    });
    sums1(r.weights);
    allNonNeg(r.weights);
    expect(r.trackingVariance).toBeGreaterThan(0); // not the centroid
    expect(r.feasible).toBe(true);
  });

  test("respects the Sharpe floor when feasible", () => {
    const means = [0.02, 0.01, 0.005];
    const r = adversarialDiversifier({
      candidateWeights: candidates,
      cov,
      means,
      sharpeFloorFraction: 0.75,
    });
    if (r.feasible) {
      expect(r.sharpe).toBeGreaterThanOrEqual(r.sharpeFloor - 1e-6);
    }
    sums1(r.weights);
  });
});

describe("combineEnsemble", () => {
  const candidates = [
    [0.5, 0.5],
    [0.1, 0.9],
  ];
  const cov = [
    [0.04, 0.0],
    [0.0, 0.04],
  ];

  test("average is the plain mean", () => {
    const r = combineEnsemble({ candidateWeights: candidates, cov, scheme: "average" });
    expect(r.weights[0]!).toBeCloseTo(0.3, 6);
    expect(r.weights[1]!).toBeCloseTo(0.7, 6);
  });

  test("inverse-tracking-error and trimmed-mean stay on the simplex", () => {
    for (const scheme of ["inverse_tracking_error", "trimmed_mean"] as const) {
      const r = combineEnsemble({ candidateWeights: candidates, cov, scheme });
      sums1(r.weights);
      allNonNeg(r.weights);
    }
  });

  test("empty candidate set falls back to equal weight", () => {
    const r = combineEnsemble({ candidateWeights: [], cov });
    expect(r.weights).toEqual([0.5, 0.5]);
  });
});
