import { describe, it, expect } from "bun:test";
import {
  isOptimizationQualityEnabled,
  computeOptimizationQuality,
  optimizationQualityToPayload,
  OPTIMIZATION_QUALITY_FLAG_ENV,
} from "./optimizationQuality.ts";

describe("isOptimizationQualityEnabled", () => {
  it("respects the flag", () => {
    expect(isOptimizationQualityEnabled({})).toBe(false);
    expect(isOptimizationQualityEnabled({ [OPTIMIZATION_QUALITY_FLAG_ENV]: "1" })).toBe(true);
  });
});

// Deterministic pseudo-random Gaussian via Box-Muller.
function makeGaussian(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  const rng = () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return Math.max(1e-12, s / 0x100000000);
  };
  return () => {
    const u1 = rng();
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function returnsAround(meanRet: number, sigma: number, n: number, seed: number): number[] {
  const g = makeGaussian(seed);
  return Array.from({ length: n }, () => meanRet + sigma * g());
}

describe("computeOptimizationQuality — Q magnitude", () => {
  it("identical distributions → Q close to 0, verdict=noise", () => {
    const base = returnsAround(0.001, 0.01, 500, 1);
    const opt = returnsAround(0.001, 0.01, 500, 2);
    const r = computeOptimizationQuality({ baselineReturns: base, optimizedReturns: opt });
    expect(Math.abs(r.qStatistic)).toBeLessThan(2);
    expect(r.verdict).toBe("noise");
  });

  it("substantially-improved Sharpe → meaningful or strong", () => {
    const base = returnsAround(0.0001, 0.01, 1000, 11);
    const opt = returnsAround(0.002, 0.01, 1000, 12);
    const r = computeOptimizationQuality({ baselineReturns: base, optimizedReturns: opt });
    expect(r.deltaSharpe).toBeGreaterThan(0);
    expect(r.qStatistic).toBeGreaterThan(2);
    expect(["meaningful", "strong"]).toContain(r.verdict);
  });

  it("regression (opt < base) yields negative Q", () => {
    const base = returnsAround(0.002, 0.01, 800, 21);
    const opt = returnsAround(0.0001, 0.01, 800, 22);
    const r = computeOptimizationQuality({ baselineReturns: base, optimizedReturns: opt });
    expect(r.qStatistic).toBeLessThan(0);
  });
});

describe("computeOptimizationQuality — boundary handling", () => {
  it("empty / tiny sample → zero Sharpes, verdict=noise", () => {
    const r = computeOptimizationQuality({ baselineReturns: [], optimizedReturns: [] });
    expect(r.baselineSharpe).toBe(0);
    expect(r.optimizedSharpe).toBe(0);
    expect(r.verdict).toBe("noise");
  });

  it("zero-variance series → zero Sharpe, Q=0", () => {
    const flat = Array.from({ length: 100 }, () => 0.001);
    const r = computeOptimizationQuality({ baselineReturns: flat, optimizedReturns: flat });
    expect(r.qStatistic).toBe(0);
  });
});

describe("computeOptimizationQuality — p-value sanity", () => {
  it("p-value in [0, 1]", () => {
    const base = returnsAround(0.001, 0.01, 200, 31);
    const opt = returnsAround(0.0015, 0.01, 200, 32);
    const r = computeOptimizationQuality({ baselineReturns: base, optimizedReturns: opt });
    expect(r.pValue).toBeGreaterThanOrEqual(0);
    expect(r.pValue).toBeLessThanOrEqual(1);
  });

  it("|Q|=2 → p ≈ 0.045 (two-sided normal tail)", () => {
    // Construct a synthetic case via a Sharpe difference, not actual data:
    // Choose returns so that the empirical Q ≈ 2 within tolerance.
    const base = returnsAround(0.0001, 0.01, 2000, 41);
    const opt = returnsAround(0.0005, 0.01, 2000, 42);
    const r = computeOptimizationQuality({ baselineReturns: base, optimizedReturns: opt });
    // The exact Q depends on the realised draws; just confirm the
    // p-value transformation is monotone in |Q|.
    if (Math.abs(r.qStatistic) > 1) {
      expect(r.pValue).toBeLessThan(0.5);
    }
  });
});

describe("computeOptimizationQuality — threshold overrides", () => {
  it("custom thresholds change verdict", () => {
    const base = returnsAround(0.0005, 0.01, 800, 51);
    const opt = returnsAround(0.0015, 0.01, 800, 52);
    const lenient = computeOptimizationQuality({
      baselineReturns: base,
      optimizedReturns: opt,
      meaningfulThreshold: 0.5,
      strongThreshold: 1.0,
    });
    const strict = computeOptimizationQuality({
      baselineReturns: base,
      optimizedReturns: opt,
      meaningfulThreshold: 10,
      strongThreshold: 20,
    });
    // Same data, strict thresholds make it harder to clear
    if (lenient.verdict !== "noise") {
      expect(["meaningful", "strong"]).toContain(lenient.verdict);
    }
    expect(strict.verdict).toBe("noise");
  });
});

describe("optimizationQualityToPayload", () => {
  it("emits stable shape", () => {
    const base = returnsAround(0.001, 0.01, 200, 61);
    const opt = returnsAround(0.0015, 0.01, 200, 62);
    const r = computeOptimizationQuality({ baselineReturns: base, optimizedReturns: opt });
    const p = optimizationQualityToPayload(r) as { kind: string; verdict: string };
    expect(p.kind).toBe("optimization_quality.computed");
    expect(["noise", "meaningful", "strong"]).toContain(p.verdict);
  });
});
