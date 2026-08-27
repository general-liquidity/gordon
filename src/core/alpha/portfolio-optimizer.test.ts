import { describe, it, expect } from "bun:test";
import { optimizePortfolio } from "./portfolio-optimizer.ts";

function rng(seed: number): () => number {
  let state = (seed | 0) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) | 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function returns(n: number, mean: number, vol: number, seed: number): number[] {
  const r = rng(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    out.push(mean + (r() - 0.5) * 2 * vol);
  }
  return out;
}

describe("optimizePortfolio — edge cases", () => {
  it("empty input returns empty weights", () => {
    const result = optimizePortfolio({ strategyReturns: {} });
    expect(Object.keys(result.weights)).toEqual([]);
    expect(result.diagnostics.nStrategies).toBe(0);
    expect(result.diagnostics.converged).toBe(false);
  });

  it("single strategy gets weight 1.0", () => {
    const result = optimizePortfolio({
      strategyReturns: { only: returns(50, 0.001, 0.01, 1) },
    });
    expect(result.weights.only).toBe(1);
    expect(result.diagnostics.converged).toBe(true);
  });

  it("insufficient samples falls back to equal-weight", () => {
    const result = optimizePortfolio({
      strategyReturns: { a: [0.01], b: [0.02] },
    });
    expect(result.diagnostics.converged).toBe(false);
    expect(result.weights.a).toBeCloseTo(0.5, 4);
    expect(result.weights.b).toBeCloseTo(0.5, 4);
  });
});

describe("optimizePortfolio — min_variance", () => {
  it("two equal-variance uncorrelated strategies get ~equal weight", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(200, 0.001, 0.02, 1),
        b: returns(200, 0.001, 0.02, 999),
      },
      objective: "min_variance",
    });
    expect(result.diagnostics.converged).toBe(true);
    // Equal variances + low correlation → ~50/50
    expect(result.weights.a).toBeGreaterThan(0.3);
    expect(result.weights.a).toBeLessThan(0.7);
    expect(result.weights.a! + result.weights.b!).toBeCloseTo(1, 4);
  });

  it("min-variance under-weights the high-vol strategy", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        low_vol: returns(200, 0.001, 0.01, 1),
        high_vol: returns(200, 0.001, 0.05, 999),
      },
      objective: "min_variance",
    });
    expect(result.diagnostics.converged).toBe(true);
    expect(result.weights.low_vol!).toBeGreaterThan(result.weights.high_vol!);
  });

  it("weights sum to 1", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(100, 0.001, 0.02, 1),
        b: returns(100, 0.001, 0.02, 2),
        c: returns(100, 0.001, 0.02, 3),
      },
    });
    const sum = Object.values(result.weights).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe("optimizePortfolio — max_sharpe", () => {
  it("returns weight vector for max_sharpe objective", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        good: returns(200, 0.003, 0.02, 1), // high mean
        bad: returns(200, -0.001, 0.02, 999), // negative mean
      },
      objective: "max_sharpe",
      riskFreeRate: 0,
    });
    expect(result.diagnostics.converged).toBe(true);
    // good strategy should get more weight
    expect(result.weights.good!).toBeGreaterThan(result.weights.bad!);
  });

  it("reports sharpe ratio", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(200, 0.002, 0.02, 1),
        b: returns(200, 0.002, 0.02, 5),
      },
      objective: "max_sharpe",
    });
    expect(typeof result.expectedSharpe).toBe("number");
    expect(Number.isFinite(result.expectedSharpe)).toBe(true);
  });
});

describe("optimizePortfolio — long-only constraint", () => {
  it("longOnly=true projects negative weights to 0", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(200, 0.001, 0.02, 1),
        b: returns(200, 0.001, 0.02, 2),
        c: returns(200, 0.001, 0.02, 3),
      },
      objective: "min_variance",
      longOnly: true,
    });
    for (const w of Object.values(result.weights)) {
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("optimizePortfolio — maxWeight cap", () => {
  it("caps individual weights at maxWeight", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(100, 0.001, 0.005, 1), // very low vol → would get high weight
        b: returns(100, 0.001, 0.05, 2),
        c: returns(100, 0.001, 0.05, 3),
      },
      objective: "min_variance",
      maxWeight: 0.4,
    });
    for (const w of Object.values(result.weights)) {
      expect(w).toBeLessThanOrEqual(0.4 + 0.01); // tiny slack for numerical
    }
  });
});

describe("optimizePortfolio — shrinkage", () => {
  it("applies shrinkage and still produces valid weights", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(100, 0.001, 0.02, 1),
        b: returns(100, 0.001, 0.02, 2),
      },
      shrinkage: 0.5,
    });
    expect(result.diagnostics.shrinkageApplied).toBe(0.5);
    const sum = Object.values(result.weights).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe("optimizePortfolio — target_return", () => {
  it("returns a portfolio satisfying long-only at minimum", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(200, 0.001, 0.02, 1),
        b: returns(200, 0.002, 0.02, 2),
      },
      objective: "target_return",
      targetReturn: 0.0015,
    });
    // long-only ensures weights ≥ 0
    for (const w of Object.values(result.weights)) {
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });
});

describe("optimizePortfolio — diagnostics", () => {
  it("reports nStrategies + sampleSize + converged flag", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(100, 0.001, 0.02, 1),
        b: returns(100, 0.001, 0.02, 2),
      },
    });
    expect(result.diagnostics.nStrategies).toBe(2);
    expect(result.diagnostics.sampleSize).toBe(100);
    expect(typeof result.diagnostics.converged).toBe("boolean");
  });

  it("summary text includes objective + effective N", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(100, 0.001, 0.02, 1),
        b: returns(100, 0.001, 0.02, 2),
      },
    });
    expect(result.summary).toContain("min_variance");
    expect(result.summary).toContain("effective N");
  });
});

describe("optimizePortfolio — collinear strategies", () => {
  it("falls back gracefully when strategies are perfectly correlated", () => {
    const r = returns(100, 0.001, 0.02, 1);
    const result = optimizePortfolio({
      strategyReturns: {
        a: r,
        b: [...r], // identical → singular covariance
      },
      shrinkage: 0, // no shrinkage → singular
    });
    // Should fall back to equal-weight rather than throw
    expect(result.weights.a! + result.weights.b!).toBeCloseTo(1, 4);
  });

  it("shrinkage rescues singular covariance", () => {
    const r = returns(100, 0.001, 0.02, 1);
    const result = optimizePortfolio({
      strategyReturns: {
        a: r,
        b: [...r],
      },
      shrinkage: 0.5,
    });
    // With shrinkage, the matrix becomes invertible
    expect(result.diagnostics.shrinkageApplied).toBe(0.5);
    const sum = Object.values(result.weights).reduce((s, w) => s + w, 0);
    expect(sum).toBeCloseTo(1, 4);
  });
});

describe("optimizePortfolio — market-neutral", () => {
  it("produces a dollar-neutral book: net ≈ 0, gross = 1", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        good: returns(200, 0.003, 0.02, 1), // high mean
        bad: returns(200, -0.001, 0.02, 999), // negative mean
      },
      marketNeutral: true,
    });
    expect(result.diagnostics.converged).toBe(true);
    expect(result.diagnostics.marketNeutral).toBe(true);
    const net = Object.values(result.weights).reduce((s, w) => s + w, 0);
    const gross = Object.values(result.weights).reduce((s, w) => s + Math.abs(w), 0);
    expect(net).toBeCloseTo(0, 6); // net-neutral
    expect(gross).toBeCloseTo(1, 6); // unit gross
    expect(result.diagnostics.netExposure).toBeCloseTo(0, 5);
    expect(result.diagnostics.grossExposure).toBeCloseTo(1, 5);
    // Longs the high-mean leg, shorts the low-mean leg.
    expect(result.weights.good!).toBeGreaterThan(0);
    expect(result.weights.bad!).toBeLessThan(0);
    expect(result.summary).toContain("market-neutral");
  });

  it("holds net = 0 / gross = 1 across three legs", () => {
    const result = optimizePortfolio({
      strategyReturns: {
        a: returns(200, 0.003, 0.02, 1),
        b: returns(200, 0.0, 0.02, 50),
        c: returns(200, -0.002, 0.02, 999),
      },
      marketNeutral: true,
    });
    expect(result.diagnostics.converged).toBe(true);
    const net = Object.values(result.weights).reduce((s, w) => s + w, 0);
    const gross = Object.values(result.weights).reduce((s, w) => s + Math.abs(w), 0);
    expect(net).toBeCloseTo(0, 6);
    expect(gross).toBeCloseTo(1, 6);
  });

  it("requires ≥ 2 strategies — single-leg falls back", () => {
    const result = optimizePortfolio({
      strategyReturns: { only: returns(50, 0.001, 0.01, 1) },
      marketNeutral: true,
    });
    expect(result.diagnostics.converged).toBe(false);
    expect(result.diagnostics.fallbackReason).toContain("market-neutral requires");
  });
});
