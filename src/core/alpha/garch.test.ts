import { describe, expect, test } from "bun:test";
import { fitGarch } from "./garch.ts";

/**
 * Deterministic GARCH(1,1) data generator. Uses a seeded linear-congruential
 * RNG (NO Math.random) + Box-Muller for standard-normal shocks, then runs the
 * true recursion σ²_t = ω + α·ε²_{t-1} + β·σ²_{t-1}. The series therefore has
 * KNOWN injected volatility clustering with a known long-run variance.
 */
function makeGarchSeries(
  n: number,
  omega: number,
  alpha: number,
  beta: number,
  seed: number,
): number[] {
  let state = seed >>> 0;
  const next = (): number => {
    // Numerical Recipes LCG.
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0xffffffff;
  };
  const normal = (): number => {
    const u1 = Math.max(1e-12, next());
    const u2 = next();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };

  const lrv = omega / (1 - alpha - beta);
  let variance = lrv;
  let prevEps2 = lrv;
  const returns: number[] = new Array(n);
  for (let t = 0; t < n; t++) {
    variance = omega + alpha * prevEps2 + beta * variance;
    const eps = Math.sqrt(variance) * normal();
    returns[t] = eps;
    prevEps2 = eps * eps;
  }
  return returns;
}

describe("fitGarch", () => {
  const TRUE_OMEGA = 0.00002;
  const TRUE_ALPHA = 0.08;
  const TRUE_BETA = 0.9; // persistence 0.98 → highly persistent
  const TRUE_LRV = TRUE_OMEGA / (1 - TRUE_ALPHA - TRUE_BETA); // = 0.001

  test("recovers a persistent process from synthetic clustered data", () => {
    const series = makeGarchSeries(3000, TRUE_OMEGA, TRUE_ALPHA, TRUE_BETA, 12345);
    const r = fitGarch(series);
    expect(r).not.toBeNull();

    // Constraint: covariance-stationary.
    expect(r!.persistence).toBeLessThan(1);
    expect(r!.params.alpha).toBeGreaterThanOrEqual(0);
    expect(r!.params.beta).toBeGreaterThanOrEqual(0);
    expect(r!.params.omega).toBeGreaterThan(0);

    // Persistence should be recovered as HIGH (true 0.98). Allow a wide band
    // since MLE on 3000 samples won't be exact, but it must read "persistent".
    expect(r!.persistence).toBeGreaterThan(0.9);

    // Long-run variance in a sane range around the true 0.001 (within 3x).
    expect(r!.longRunVariance).toBeGreaterThan(TRUE_LRV / 3);
    expect(r!.longRunVariance).toBeLessThan(TRUE_LRV * 3);

    expect(r!.interpretation).toContain("persistent");
    expect(r!.conditionalVariance.length).toBe(3000);
  });

  test("forecast mean-reverts monotonically toward the long-run variance", () => {
    const series = makeGarchSeries(2000, TRUE_OMEGA, TRUE_ALPHA, TRUE_BETA, 999);
    const r = fitGarch(series)!;
    const lrv = r.longRunVariance;
    const H = 2000; // many half-lives at persistence ~0.98
    const fc = r.forecast(H);
    expect(fc.length).toBe(H);

    // Each step strictly closer to (or at) the long-run variance than the last.
    let prevGap = Math.abs(r.currentVariance - lrv);
    for (const v of fc) {
      const gap = Math.abs(v - lrv);
      expect(gap).toBeLessThanOrEqual(prevGap + 1e-15);
      prevGap = gap;
    }
    // Far horizon converges to the long-run variance (gap shrinks geometrically).
    expect(Math.abs(fc[H - 1]! - lrv)).toBeLessThan(Math.abs(r.currentVariance - lrv) * 0.01);
    expect(fc[H - 1]!).toBeCloseTo(lrv, 6);
  });

  test("forecast direction: from a low-vol state, variance rises toward LRV", () => {
    const series = makeGarchSeries(1500, TRUE_OMEGA, TRUE_ALPHA, TRUE_BETA, 7);
    const r = fitGarch(series)!;
    const fc = r.forecast(10);
    if (r.currentVariance < r.longRunVariance) {
      expect(fc[0]!).toBeGreaterThanOrEqual(r.currentVariance - 1e-15);
      expect(fc[9]!).toBeGreaterThanOrEqual(fc[0]!);
    } else {
      expect(fc[0]!).toBeLessThanOrEqual(r.currentVariance + 1e-15);
      expect(fc[9]!).toBeLessThanOrEqual(fc[0]!);
    }
  });

  test("deterministic — same input yields identical fit", () => {
    const series = makeGarchSeries(1000, TRUE_OMEGA, TRUE_ALPHA, TRUE_BETA, 42);
    const a = fitGarch(series)!;
    const b = fitGarch(series)!;
    expect(a.params).toEqual(b.params);
    expect(a.logLikelihood).toBe(b.logLikelihood);
  });

  test("NULL on too-short series", () => {
    expect(fitGarch([0.01, -0.02, 0.015])).toBeNull();
    expect(fitGarch(new Array(49).fill(0.01))).toBeNull();
  });

  test("NULL on non-finite values", () => {
    const bad = new Array(60).fill(0.01);
    bad[10] = NaN;
    expect(fitGarch(bad)).toBeNull();
  });

  test("zero-variance series returns null", () => {
    expect(fitGarch(new Array(60).fill(0.0))).toBeNull();
  });
});
