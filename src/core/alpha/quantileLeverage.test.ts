import { describe, expect, test } from "bun:test";
import { quantileOptimalLeverage } from "./quantileLeverage.ts";

/** Deterministic seeded return series with a positive expected edge. */
function positiveEdgeReturns(n: number, seed: number): number[] {
  // Simple LCG so the fixture itself is reproducible.
  let s = (seed >>> 0) || 1;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // ~60% up days of +1%, ~40% down days of -0.8% → clear positive edge.
    out.push(rand() < 0.6 ? 0.01 : -0.008);
  }
  return out;
}

/**
 * Moderate-magnitude positive-edge series whose Kelly optimum sits INSIDE the
 * default 0..5 grid (so the conservative quantile lands strictly below the
 * median rather than both saturating at the grid ceiling).
 */
function moderateEdgeReturns(n: number, seed: number): number[] {
  let s = (seed >>> 0) || 1;
  const rand = () => {
    s = (Math.imul(1664525, s) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    // ~55% up days of +6%, ~45% down days of -5% → positive edge, larger moves.
    out.push(rand() < 0.55 ? 0.06 : -0.05);
  }
  return out;
}

describe("quantileOptimalLeverage", () => {
  test("positive-edge series → positive optimal leverage", () => {
    const returns = positiveEdgeReturns(250, 7);
    const res = quantileOptimalLeverage(returns, { quantile: 0.5, seed: 42, nPaths: 1500 });
    expect(res.leverage).toBeGreaterThan(0);
    expect(res.geoMeanAtQuantile).toBeGreaterThan(0);
  });

  test("CORE: optimal leverage at q=0.1 is lower than at q=0.5 (conservative ⇒ less leverage)", () => {
    const returns = moderateEdgeReturns(250, 11);
    const median = quantileOptimalLeverage(returns, { quantile: 0.5, seed: 42, nPaths: 2000 });
    const conservative = quantileOptimalLeverage(returns, { quantile: 0.1, seed: 42, nPaths: 2000 });
    expect(conservative.leverage).toBeLessThan(median.leverage);
    expect(conservative.leverage).toBeGreaterThan(0);
  });

  test("zero/negative-edge series → ~0 leverage", () => {
    // Symmetric-but-negative: down moves slightly larger than up moves.
    let s = 99;
    const rand = () => {
      s = (Math.imul(1664525, s) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
    const returns: number[] = [];
    for (let i = 0; i < 250; i++) returns.push(rand() < 0.5 ? 0.008 : -0.01);
    const res = quantileOptimalLeverage(returns, { quantile: 0.5, seed: 42, nPaths: 2000 });
    expect(res.leverage).toBe(0);
    expect(res.geoMeanAtQuantile).toBe(0);
  });

  test("ruinProb rises monotonically with leverage along the curve", () => {
    const returns = positiveEdgeReturns(200, 5);
    const res = quantileOptimalLeverage(returns, { quantile: 0.5, seed: 42, nPaths: 1500 });
    for (let i = 1; i < res.curve.length; i++) {
      expect(res.curve[i]!.ruinProb).toBeGreaterThanOrEqual(res.curve[i - 1]!.ruinProb);
    }
    // Sanity: leverage 0 can never ruin.
    expect(res.curve[0]!.ruinProb).toBe(0);
  });

  test("deterministic: same seed → identical result", () => {
    const returns = positiveEdgeReturns(150, 3);
    const a = quantileOptimalLeverage(returns, { quantile: 0.25, seed: 123, nPaths: 800 });
    const b = quantileOptimalLeverage(returns, { quantile: 0.25, seed: 123, nPaths: 800 });
    expect(a).toEqual(b);
  });

  test("degenerate: fewer than 2 finite returns → leverage 0", () => {
    expect(quantileOptimalLeverage([]).leverage).toBe(0);
    expect(quantileOptimalLeverage([0.01]).leverage).toBe(0);
    expect(quantileOptimalLeverage([NaN, Infinity, 0.02]).leverage).toBe(0);
  });
});
