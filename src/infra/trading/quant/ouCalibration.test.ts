import { test, expect, describe } from "bun:test";
import {
  calibrateOU,
  minimumEntryZScore,
  effectiveEntryZ,
  recommendedExitZ,
  formatOUParams,
} from "./ouCalibration.ts";

// ============================================================================
// Deterministic OU path generator
// ============================================================================

/**
 * Linear-congruential generator (Numerical Recipes constants) — fixed seed,
 * no Math.random / Date.now, so the ε noise is fully reproducible.
 */
function makeLCG(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000; // uniform in [0, 1)
  };
}

/** Box-Muller standard normal driven by the LCG. */
function makeGaussian(seed: number): () => number {
  const u = makeLCG(seed);
  let spare: number | null = null;
  return () => {
    if (spare !== null) {
      const s = spare;
      spare = null;
      return s;
    }
    // Avoid log(0).
    const u1 = Math.max(u(), 1e-12);
    const u2 = u();
    const mag = Math.sqrt(-2 * Math.log(u1));
    spare = mag * Math.sin(2 * Math.PI * u2);
    return mag * Math.cos(2 * Math.PI * u2);
  };
}

/**
 * Simulate dX_t = θ(μ − X_t)dt + σ·ε_t·√dt with a fixed seed.
 * Returns an array of `steps` spread values starting at μ.
 */
function simulateOU(
  theta: number,
  mu: number,
  sigma: number,
  dt: number,
  steps: number,
  seed: number,
): number[] {
  const gauss = makeGaussian(seed);
  const path: number[] = [mu];
  let x = mu;
  for (let i = 1; i < steps; i++) {
    const eps = gauss();
    x = x + theta * (mu - x) * dt + sigma * eps * Math.sqrt(dt);
    path.push(x);
  }
  return path;
}

// ============================================================================
// Recovery on a constructed-truth OU path
// ============================================================================

describe("calibrateOU — parameter recovery", () => {
  const THETA = 0.1;
  const MU = 5;
  const SIGMA = 0.5;
  const DT = 1;
  const STEPS = 3000;
  const SEED = 123456789;

  const path = simulateOU(THETA, MU, SIGMA, DT, STEPS, SEED);
  const params = calibrateOU(path, DT);

  test("recovers θ ≈ 0.1", () => {
    expect(params.theta).toBeGreaterThan(THETA - 0.03);
    expect(params.theta).toBeLessThan(THETA + 0.03);
  });

  test("recovers μ ≈ 5", () => {
    expect(params.mu).toBeGreaterThan(MU - 0.5);
    expect(params.mu).toBeLessThan(MU + 0.5);
  });

  test("recovers halfLife ≈ ln(2)/0.1 ≈ 6.93", () => {
    const trueHalfLife = Math.log(2) / THETA;
    expect(params.halfLife).toBeGreaterThan(trueHalfLife - 2);
    expect(params.halfLife).toBeLessThan(trueHalfLife + 2);
  });

  test("recovers ouStd ≈ σ/√(2θ) ≈ 1.118", () => {
    const trueOuStd = SIGMA / Math.sqrt(2 * THETA);
    expect(params.ouStd).toBeGreaterThan(trueOuStd - 0.2);
    expect(params.ouStd).toBeLessThan(trueOuStd + 0.2);
  });

  test("sigma ≈ 0.5", () => {
    expect(params.sigma).toBeGreaterThan(SIGMA - 0.1);
    expect(params.sigma).toBeLessThan(SIGMA + 0.1);
  });

  test("tradeable true (halfLife ≈ 6.9 in [5, 60])", () => {
    expect(params.tradeable).toBe(true);
  });
});

// ============================================================================
// tradeable flag flips on fast reversion
// ============================================================================

describe("calibrateOU — tradeable band", () => {
  test("fast reversion (θ large → halfLife < 5) → tradeable false", () => {
    // θ = 0.5 → halfLife = ln(2)/0.5 ≈ 1.39 < 5.
    const path = simulateOU(0.5, 5, 0.5, 1, 3000, 987654321);
    const params = calibrateOU(path);
    expect(params.halfLife).toBeLessThan(5);
    expect(params.tradeable).toBe(false);
  });

  test("custom band widens tradeable region", () => {
    const path = simulateOU(0.5, 5, 0.5, 1, 3000, 987654321);
    const params = calibrateOU(path, 1, { minHalfLife: 1, maxHalfLife: 60 });
    expect(params.tradeable).toBe(true);
  });
});

// ============================================================================
// Degenerate boundary
// ============================================================================

describe("calibrateOU — boundary guard", () => {
  test("series shorter than 10 → degenerate, non-tradeable", () => {
    const params = calibrateOU([1, 2, 3, 4, 5]);
    expect(params.theta).toBe(1e-10);
    expect(params.halfLife).toBe(Infinity);
    expect(params.ouStd).toBe(Infinity);
    expect(params.tradeable).toBe(false);
  });
});

// ============================================================================
// Cost-calibrated entry z-score
// ============================================================================

describe("minimumEntryZScore", () => {
  test("exact value: ouStd=1.118, costBps=10 → ≈ 0.003578", () => {
    const z = minimumEntryZScore(1.118, 10);
    // 4 · (10/10000) / 1.118 = 0.004 / 1.118
    expect(z).toBeCloseTo(0.004 / 1.118, 10);
    expect(z).toBeCloseTo(0.003578, 5);
  });

  test("monotonicity: smaller ouStd ⇒ larger minEntryZ", () => {
    const zWide = minimumEntryZScore(2.0, 10);
    const zNarrow = minimumEntryZScore(0.5, 10);
    expect(zNarrow).toBeGreaterThan(zWide);
  });

  test("tiny ouStd → large minEntryZ", () => {
    const z = minimumEntryZScore(1e-6, 10);
    expect(z).toBeGreaterThan(1000);
  });

  test("non-finite ouStd → Infinity", () => {
    expect(minimumEntryZScore(Infinity, 10)).toBe(Infinity);
    expect(minimumEntryZScore(NaN, 10)).toBe(Infinity);
  });

  test("non-positive ouStd → Infinity", () => {
    expect(minimumEntryZScore(0, 10)).toBe(Infinity);
    expect(minimumEntryZScore(-1, 10)).toBe(Infinity);
  });
});

// ============================================================================
// effectiveEntryZ / recommendedExitZ
// ============================================================================

describe("effectiveEntryZ", () => {
  test("never enters below the cost floor", () => {
    expect(effectiveEntryZ(2.0, 0.5)).toBe(2.0); // desired above floor
    expect(effectiveEntryZ(2.0, 3.0)).toBe(3.0); // floor above desired
  });

  test("recommendedExitZ is half the effective entry", () => {
    expect(recommendedExitZ(2.0)).toBe(1.0);
    expect(recommendedExitZ(effectiveEntryZ(2.0, 3.0))).toBe(1.5);
  });
});

// ============================================================================
// formatOUParams
// ============================================================================

describe("formatOUParams", () => {
  test("renders a multi-line summary with key fields", () => {
    const path = simulateOU(0.1, 5, 0.5, 1, 3000, 123456789);
    const out = formatOUParams(calibrateOU(path));
    expect(out).toContain("OU Spread Calibration");
    expect(out).toContain("Half-Life");
    expect(out).toContain("OU Std");
    expect(out).toContain("Tradeable: YES");
  });

  test("degenerate params render N/A", () => {
    const out = formatOUParams(calibrateOU([1, 2, 3]));
    expect(out).toContain("N/A");
    expect(out).toContain("Tradeable: NO");
  });
});
