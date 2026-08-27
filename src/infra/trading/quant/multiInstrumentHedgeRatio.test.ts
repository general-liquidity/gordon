import { describe, it, expect } from "bun:test";
import {
  computeMultiInstrumentHedgeRatio,
  multiInstrumentHedgeRatioToPayload,
} from "./multiInstrumentHedgeRatio.ts";

// Deterministic PRNG so tests don't flake.
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
}

function randn(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

function gaussianSeries(n: number, vol: number, seed: number): number[] {
  const rng = lcg(seed);
  return Array.from({ length: n }, () => randn(rng) * vol);
}

describe("computeMultiInstrumentHedgeRatio — validation", () => {
  it("rejects fewer than 2 observations", () => {
    expect(() =>
      computeMultiInstrumentHedgeRatio({
        positionReturns: [0.01],
        candidateReturns: [[0.01]],
      }),
    ).toThrow();
  });

  it("rejects empty candidate list", () => {
    expect(() =>
      computeMultiInstrumentHedgeRatio({
        positionReturns: [0.01, 0.02],
        candidateReturns: [],
      }),
    ).toThrow();
  });

  it("rejects length mismatch between position and candidates", () => {
    expect(() =>
      computeMultiInstrumentHedgeRatio({
        positionReturns: [0.01, 0.02, 0.03],
        candidateReturns: [[0.01, 0.02]],
      }),
    ).toThrow();
  });

  it("rejects non-finite values", () => {
    expect(() =>
      computeMultiInstrumentHedgeRatio({
        positionReturns: [0.01, NaN, 0.03],
        candidateReturns: [[0.01, 0.02, 0.03]],
      }),
    ).toThrow();
    expect(() =>
      computeMultiInstrumentHedgeRatio({
        positionReturns: [0.01, 0.02, 0.03],
        candidateReturns: [[0.01, Infinity, 0.03]],
      }),
    ).toThrow();
  });

  it("rejects candidateNames length mismatch", () => {
    expect(() =>
      computeMultiInstrumentHedgeRatio({
        positionReturns: [0.01, 0.02, 0.03],
        candidateReturns: [
          [0.01, 0.02, 0.03],
          [0.02, 0.01, 0.04],
        ],
        candidateNames: ["A"],
      }),
    ).toThrow();
  });

  it("rejects negative ridge", () => {
    expect(() =>
      computeMultiInstrumentHedgeRatio({
        positionReturns: [0.01, 0.02, 0.03],
        candidateReturns: [[0.01, 0.02, 0.03]],
        ridge: -0.1,
      }),
    ).toThrow();
  });
});

describe("computeMultiInstrumentHedgeRatio — single-candidate (K=1) case", () => {
  it("perfect linear relationship X = 2·Y → weight ≈ 2, variance reduction ≈ 1", () => {
    const y = gaussianSeries(500, 0.02, 11);
    const x = y.map((v) => 2 * v);
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: x,
      candidateReturns: [y],
      candidateNames: ["Y"],
    });
    expect(r.hedgeWeights[0]!.name).toBe("Y");
    expect(r.hedgeWeights[0]!.weight).toBeCloseTo(2, 4);
    expect(r.varianceReduction).toBeCloseTo(1, 4);
    expect(r.residualVariance).toBeCloseTo(0, 6);
  });

  it("X uncorrelated with Y → weight ≈ 0, variance reduction ≈ 0", () => {
    const y = gaussianSeries(2000, 0.02, 13);
    const x = gaussianSeries(2000, 0.02, 17); // different seed → ~independent
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: x,
      candidateReturns: [y],
    });
    expect(Math.abs(r.hedgeWeights[0]!.weight)).toBeLessThan(0.1);
    expect(Math.abs(r.varianceReduction)).toBeLessThan(0.05);
  });

  it("matches the simple Cov(X,Y)/Var(Y) ratio in the K=1 case", () => {
    const y = gaussianSeries(500, 0.02, 23);
    const noise = gaussianSeries(500, 0.005, 29);
    const x = y.map((v, i) => 1.5 * v + noise[i]!);
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: x,
      candidateReturns: [y],
    });
    // Hand-compute Cov(X,Y) / Var(Y).
    const xMean = x.reduce((s, v) => s + v, 0) / x.length;
    const yMean = y.reduce((s, v) => s + v, 0) / y.length;
    let cov = 0;
    let vary = 0;
    for (let i = 0; i < x.length; i++) {
      cov += (x[i]! - xMean) * (y[i]! - yMean);
      vary += (y[i]! - yMean) * (y[i]! - yMean);
    }
    const beta = cov / vary;
    expect(r.hedgeWeights[0]!.weight).toBeCloseTo(beta, 6);
  });
});

describe("computeMultiInstrumentHedgeRatio — multi-candidate cases", () => {
  it("X = a·Y1 + b·Y2 with uncorrelated Y1, Y2 → weights ≈ a, b", () => {
    const y1 = gaussianSeries(2000, 0.02, 31);
    const y2 = gaussianSeries(2000, 0.02, 37);
    const a = 0.7;
    const b = -1.3;
    const x = y1.map((v, i) => a * v + b * y2[i]!);
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: x,
      candidateReturns: [y1, y2],
      candidateNames: ["Y1", "Y2"],
    });
    expect(r.hedgeWeights[0]!.weight).toBeCloseTo(a, 3);
    expect(r.hedgeWeights[1]!.weight).toBeCloseTo(b, 3);
    expect(r.varianceReduction).toBeCloseTo(1, 3);
  });

  it("default candidateNames are Y_1, Y_2, ...", () => {
    const y1 = gaussianSeries(100, 0.02, 41);
    const y2 = gaussianSeries(100, 0.02, 43);
    const x = gaussianSeries(100, 0.02, 47);
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: x,
      candidateReturns: [y1, y2],
    });
    expect(r.hedgeWeights[0]!.name).toBe("Y_1");
    expect(r.hedgeWeights[1]!.name).toBe("Y_2");
  });

  it("variance reduction is in [0, 1] for noisy hedges", () => {
    const y = gaussianSeries(500, 0.02, 51);
    const noise = gaussianSeries(500, 0.01, 53);
    const x = y.map((v, i) => 1.0 * v + noise[i]!);
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: x,
      candidateReturns: [y],
    });
    expect(r.varianceReduction).toBeGreaterThan(0);
    expect(r.varianceReduction).toBeLessThanOrEqual(1);
  });
});

describe("computeMultiInstrumentHedgeRatio — collinearity handling", () => {
  it("perfectly collinear candidates → throws with helpful message", () => {
    const y1 = gaussianSeries(200, 0.02, 61);
    const y2 = y1.map((v) => 2 * v); // perfectly collinear
    const x = gaussianSeries(200, 0.02, 67);
    expect(() =>
      computeMultiInstrumentHedgeRatio({
        positionReturns: x,
        candidateReturns: [y1, y2],
      }),
    ).toThrow(/collinear|singular/i);
  });

  it("ridge regularization stabilizes near-collinear candidates", () => {
    const y1 = gaussianSeries(500, 0.02, 71);
    const tiny = gaussianSeries(500, 0.0001, 73);
    const y2 = y1.map((v, i) => 2 * v + tiny[i]!); // near-collinear
    const x = y1.map((v) => 0.5 * v);
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: x,
      candidateReturns: [y1, y2],
      ridge: 1e-4,
    });
    expect(Number.isFinite(r.hedgeWeights[0]!.weight)).toBe(true);
    expect(Number.isFinite(r.hedgeWeights[1]!.weight)).toBe(true);
  });

  it("condition number flagged when high", () => {
    const y1 = gaussianSeries(500, 0.02, 81);
    const tiny = gaussianSeries(500, 0.001, 83);
    const y2 = y1.map((v, i) => v + tiny[i]!); // nearly collinear
    const x = gaussianSeries(500, 0.02, 89);
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: x,
      candidateReturns: [y1, y2],
      ridge: 1e-6,
    });
    expect(r.conditionNumber).toBeGreaterThan(10);
  });
});

describe("computeMultiInstrumentHedgeRatio — output structure", () => {
  it("hedgeWeights has length K", () => {
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: gaussianSeries(100, 0.02, 91),
      candidateReturns: [
        gaussianSeries(100, 0.02, 93),
        gaussianSeries(100, 0.02, 95),
        gaussianSeries(100, 0.02, 97),
      ],
    });
    expect(r.hedgeWeights.length).toBe(3);
    expect(r.nCandidates).toBe(3);
    expect(r.nObservations).toBe(100);
  });

  it("residualVariance ≤ positionVariance always", () => {
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: gaussianSeries(200, 0.02, 101),
      candidateReturns: [gaussianSeries(200, 0.02, 103), gaussianSeries(200, 0.02, 107)],
    });
    expect(r.residualVariance).toBeLessThanOrEqual(r.positionVariance + 1e-9);
  });

  it("residualVariance non-negative", () => {
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: gaussianSeries(200, 0.02, 111),
      candidateReturns: [gaussianSeries(200, 0.02, 113), gaussianSeries(200, 0.02, 117)],
    });
    expect(r.residualVariance).toBeGreaterThanOrEqual(0);
  });
});

describe("multiInstrumentHedgeRatioToPayload", () => {
  it("emits stable shape", () => {
    const r = computeMultiInstrumentHedgeRatio({
      positionReturns: gaussianSeries(100, 0.02, 121),
      candidateReturns: [gaussianSeries(100, 0.02, 123), gaussianSeries(100, 0.02, 125)],
      candidateNames: ["A", "B"],
    });
    const p = multiInstrumentHedgeRatioToPayload(r) as {
      kind: string;
      hedgeWeights: { name: string; weight: number }[];
      nCandidates: number;
    };
    expect(p.kind).toBe("multi_instrument_hedge_ratio.computed");
    expect(p.nCandidates).toBe(2);
    expect(p.hedgeWeights.length).toBe(2);
    expect(p.hedgeWeights[0]!.name).toBe("A");
  });
});
