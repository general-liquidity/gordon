/**
 * Parity tests for src/core/stats — SPEC Win #3 (`simple-statistics` adoption).
 *
 * Each primitive is asserted to match the CURRENT hand-rolled implementation in
 * src/backtest/metrics.ts within tolerance:
 *   - 1e-9 for pure arithmetic (mean / variance / std / drawdown / CAGR / profit factor /
 *     Sharpe / Sortino / volatility — `simple-statistics` uses the same textbook formulae)
 *   - 1e-6 where simple-statistics MAY differ algorithmically (skew / kurtosis / quantile)
 *
 * PERCENTILE: the two hand-rolled Gordon impls diverge —
 *   metrics.ts percentile() = linear-interpolated, idx = p·(n−1)  [numpy type=7]
 *   monte-carlo.ts          = floor-index,         idx = floor(p·n)
 * We adopt the INTERPOLATED definition (the standard) and test against THAT here, both
 * via a local replica of the metrics.ts formula and via the public calculateTailRatio
 * which is built on it.
 */

import { describe, expect, test } from "bun:test";

import {
  calculateVolatility,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateMaxDrawdown,
  calculateCAGR,
  calculateProfitFactor,
  calculateTailRatio,
} from "../../backtest/metrics.ts";
import type { EquityPoint, ClosedTrade } from "../../backtest/types.ts";

import {
  mean,
  variance,
  sampleStd,
  median,
  skewness,
  kurtosis,
  quantile,
  quantileSorted,
  linearRegression,
  populationVariance,
  populationStd,
  sampleCorrelation,
  sampleCovariance,
  zScore,
  rSquared,
  volatility,
  sharpe,
  sortino,
  maxDrawdown,
  cagr,
  profitFactor,
} from "./index.ts";

const TOL_ARITH = 1e-9;
const TOL_LIB = 1e-6;

// --- shared fixtures -------------------------------------------------------

// Mixed positive/negative per-bar returns (decimals).
const RETURNS = [
  0.012, -0.008, 0.021, -0.015, 0.004, 0.018, -0.022, 0.009, -0.003, 0.031, -0.011, 0.006, 0.014,
  -0.019, 0.027, -0.005, 0.002, 0.016, -0.013, 0.008,
];

// Reference implementations mirroring the hand-rolled metrics.ts internals.
function refMean(x: number[]): number {
  return x.reduce((s, v) => s + v, 0) / x.length;
}
function refSampleVariance(x: number[]): number {
  const m = refMean(x);
  return x.reduce((s, v) => s + (v - m) ** 2, 0) / (x.length - 1);
}
function refSampleStd(x: number[]): number {
  return Math.sqrt(refSampleVariance(x));
}
function refMedian(x: number[]): number {
  const s = [...x].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 === 0 ? (s[n / 2 - 1]! + s[n / 2]!) / 2 : s[Math.floor(n / 2)]!;
}
// metrics.ts percentile(): the interpolated (type=7) definition we adopt.
function refInterpPercentile(sorted: number[], p: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const rank = p * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo]!;
  const frac = rank - lo;
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * frac;
}

// --- base primitives -------------------------------------------------------

describe("base primitives — parity with hand-rolled internals", () => {
  test("mean", () => {
    expect(mean(RETURNS)).toBeCloseTo(refMean(RETURNS), 12);
    expect(Math.abs(mean(RETURNS) - refMean(RETURNS))).toBeLessThan(TOL_ARITH);
  });

  test("variance (n−1)", () => {
    expect(Math.abs(variance(RETURNS) - refSampleVariance(RETURNS))).toBeLessThan(TOL_ARITH);
  });

  test("sampleStd (n−1)", () => {
    expect(Math.abs(sampleStd(RETURNS) - refSampleStd(RETURNS))).toBeLessThan(TOL_ARITH);
  });

  test("median (even and odd n)", () => {
    expect(Math.abs(median(RETURNS) - refMedian(RETURNS))).toBeLessThan(TOL_ARITH);
    const odd = RETURNS.slice(0, 19);
    expect(Math.abs(median(odd) - refMedian(odd))).toBeLessThan(TOL_ARITH);
  });

  test("skewness — bias-corrected (adjusted Fisher-Pearson)", () => {
    // Reference: adjusted Fisher-Pearson standardized moment coefficient.
    const n = RETURNS.length;
    const m = refMean(RETURNS);
    let s2 = 0,
      s3 = 0;
    for (const v of RETURNS) {
      const d = v - m;
      s2 += d * d;
      s3 += d * d * d;
    }
    const std = Math.sqrt(s2 / (n - 1));
    const ref = (n * s3) / ((n - 1) * (n - 2) * std ** 3);
    expect(Math.abs(skewness(RETURNS) - ref)).toBeLessThan(TOL_LIB);
  });

  test("kurtosis — bias-corrected (Fisher excess)", () => {
    const n = RETURNS.length;
    const m = refMean(RETURNS);
    let s2 = 0,
      s4 = 0;
    for (const v of RETURNS) {
      const d = v - m;
      s2 += d * d;
      s4 += d * d * d * d;
    }
    const ref = ((n - 1) / ((n - 2) * (n - 3))) * ((n * (n + 1) * s4) / (s2 * s2) - 3 * (n - 1));
    expect(Math.abs(kurtosis(RETURNS) - ref)).toBeLessThan(TOL_LIB);
  });

  test("linearRegression (OLS) — slope/intercept against normal equations", () => {
    const xs = RETURNS.map((_, i) => i);
    const ys = RETURNS.map((r, i) => 2 * i + 1 + r); // near-linear
    const n = xs.length;
    const mx = refMean(xs),
      my = refMean(ys);
    let cov = 0,
      varx = 0;
    for (let i = 0; i < n; i++) {
      cov += (xs[i]! - mx) * (ys[i]! - my);
      varx += (xs[i]! - mx) ** 2;
    }
    const slope = cov / varx;
    const intercept = my - slope * mx;
    const got = linearRegression(xs, ys);
    expect(Math.abs(got.slope - slope)).toBeLessThan(TOL_LIB);
    expect(Math.abs(got.intercept - intercept)).toBeLessThan(TOL_LIB);
  });
});

// --- dedup primitives (Wave 4 consolidation targets) -----------------------

describe("dedup primitives — parity with inline hand-rolled copies", () => {
  // Bollinger uses POPULATION std (÷N) — the load-bearing ddof note in 10-indicators.md.
  function refPopVariance(x: number[]): number {
    const m = refMean(x);
    return x.reduce((s, v) => s + (v - m) ** 2, 0) / x.length;
  }

  test("populationVariance / populationStd (÷N, NOT n−1)", () => {
    const refVar = refPopVariance(RETURNS);
    expect(Math.abs(populationVariance(RETURNS) - refVar)).toBeLessThan(TOL_ARITH);
    expect(Math.abs(populationStd(RETURNS) - Math.sqrt(refVar))).toBeLessThan(TOL_ARITH);
    // population std must be SMALLER than sample std (divides by N not N−1).
    expect(populationStd(RETURNS)).toBeLessThan(refSampleStd(RETURNS));
  });

  test("sampleCorrelation (Pearson) against manual cov/var", () => {
    const xs = RETURNS.map((_, i) => i);
    const ys = RETURNS.map((r, i) => 0.5 * i - r * 3);
    const n = xs.length;
    const mx = refMean(xs),
      my = refMean(ys);
    let cov = 0,
      vx = 0,
      vy = 0;
    for (let i = 0; i < n; i++) {
      cov += (xs[i]! - mx) * (ys[i]! - my);
      vx += (xs[i]! - mx) ** 2;
      vy += (ys[i]! - my) ** 2;
    }
    const ref = cov / Math.sqrt(vx * vy);
    expect(Math.abs(sampleCorrelation(xs, ys) - ref)).toBeLessThan(TOL_LIB);
  });

  test("sampleCorrelation — guards: <2 points and zero-variance → 0", () => {
    expect(sampleCorrelation([1], [2])).toBe(0);
    expect(sampleCorrelation([5, 5, 5], [1, 2, 3])).toBe(0); // flat x → 0, not NaN
  });

  test("sampleCovariance (n−1) against manual", () => {
    const xs = RETURNS.map((_, i) => i);
    const ys = RETURNS.map((r) => r * 10);
    const n = xs.length;
    const mx = refMean(xs),
      my = refMean(ys);
    let cov = 0;
    for (let i = 0; i < n; i++) cov += (xs[i]! - mx) * (ys[i]! - my);
    cov /= n - 1;
    expect(Math.abs(sampleCovariance(xs, ys) - cov)).toBeLessThan(TOL_LIB);
  });

  test("zScore — standardization + degenerate guard", () => {
    expect(zScore(10, 4, 2)).toBeCloseTo(3, 12);
    expect(zScore(10, 10, 0)).toBe(0); // σ=0 → 0, not NaN/Infinity
  });

  test("rSquared = Pearson² for simple OLS", () => {
    const xs = RETURNS.map((_, i) => i);
    const ys = RETURNS.map((r, i) => 2 * i + 1 + r);
    const r = sampleCorrelation(xs, ys);
    expect(Math.abs(rSquared(xs, ys) - r * r)).toBeLessThan(TOL_ARITH);
    expect(rSquared(xs, ys)).toBeGreaterThan(0.99); // near-perfect linear
  });
});

// --- percentile (divergence resolved to interpolated) ----------------------

describe("quantile — interpolated (type=7) definition adopted", () => {
  const sorted = [...RETURNS].sort((a, b) => a - b);

  for (const p of [0.05, 0.1, 0.25, 0.5, 0.75, 0.9, 0.95]) {
    test(`quantile p=${p} matches metrics.ts interpolated percentile`, () => {
      const ref = refInterpPercentile(sorted, p);
      expect(Math.abs(quantile(RETURNS, p) - ref)).toBeLessThan(TOL_LIB);
      expect(Math.abs(quantileSorted(sorted, p) - ref)).toBeLessThan(TOL_LIB);
    });
  }

  test("endpoints p=0 / p=1", () => {
    expect(quantile(RETURNS, 0)).toBeCloseTo(sorted[0]!, 12);
    expect(quantile(RETURNS, 1)).toBeCloseTo(sorted[sorted.length - 1]!, 12);
  });

  test("quantile does not mutate the input array", () => {
    const input = [3, 1, 2];
    quantile(input, 0.5);
    expect(input).toEqual([3, 1, 2]);
  });

  test("tail ratio (built on the interpolated percentile) matches metrics.ts", () => {
    // 20 obs (min for calculateTailRatio). p95 / |p05|.
    const sortedR = [...RETURNS].sort((a, b) => a - b);
    const p95 = quantile(RETURNS, 0.95);
    const p05 = quantile(RETURNS, 0.05);
    const ours = parseFloat((p95 / Math.abs(p05)).toFixed(4));
    expect(calculateTailRatio(RETURNS)).toBeCloseTo(ours, 4);
    // sanity: the interpolated reference agrees with our quantile on this fixture
    expect(refInterpPercentile(sortedR, 0.95)).toBeCloseTo(p95, 9);
  });
});

// --- composite metrics — parity with metrics.ts ----------------------------

describe("composite metrics — parity with metrics.ts", () => {
  test("volatility", () => {
    for (const ppy of [365, 252, 8760]) {
      expect(Math.abs(volatility(RETURNS, ppy) - calculateVolatility(RETURNS, ppy))).toBeLessThan(
        TOL_ARITH,
      );
    }
  });

  test("sharpe (judged metric)", () => {
    for (const ppy of [365, 252]) {
      for (const rf of [0.02, 0, 0.05]) {
        expect(
          Math.abs(sharpe(RETURNS, rf, ppy) - calculateSharpeRatio(RETURNS, rf, ppy)),
        ).toBeLessThan(TOL_ARITH);
      }
    }
  });

  test("sortino (downside variance ÷ returns.length preserved)", () => {
    for (const ppy of [365, 252]) {
      for (const rf of [0.02, 0]) {
        const ours = sortino(RETURNS, rf, ppy);
        const ref = calculateSortinoRatio(RETURNS, rf, ppy);
        expect(Math.abs(ours - ref)).toBeLessThan(TOL_ARITH);
      }
    }
  });

  test("sortino — Infinity when no negative returns", () => {
    const allPos = [0.01, 0.02, 0.015, 0.03];
    expect(sortino(allPos)).toBe(calculateSortinoRatio(allPos));
    expect(sortino(allPos)).toBe(Infinity);
  });

  test("maxDrawdown — equity series parity", () => {
    const equity = [100, 110, 105, 120, 90, 130, 125, 140, 100];
    const points: EquityPoint[] = equity.map((e, i) => ({ timestamp: i, equity: e }));
    expect(Math.abs(maxDrawdown(equity) - calculateMaxDrawdown(points))).toBeLessThan(TOL_ARITH);
  });

  test("maxDrawdown — monotonic up has zero drawdown", () => {
    const equity = [100, 101, 102, 103];
    const points: EquityPoint[] = equity.map((e, i) => ({ timestamp: i, equity: e }));
    expect(maxDrawdown(equity)).toBe(calculateMaxDrawdown(points));
    expect(maxDrawdown(equity)).toBe(0);
  });

  test("cagr", () => {
    const cases: Array<[number, number, number]> = [
      [10000, 15000, 2.5],
      [10000, 8000, 1.5],
      [10000, 12000, 0.5],
    ];
    for (const [init, fin, yrs] of cases) {
      expect(Math.abs(cagr(init, fin, yrs) - calculateCAGR(init, fin, yrs))).toBeLessThan(
        TOL_ARITH,
      );
    }
  });

  test("profitFactor — parity with trade-record version", () => {
    const pnls = [120, -50, 80, -30, 200, -90, 45, -10];
    const trades: ClosedTrade[] = pnls.map((p, i) => ({
      id: String(i),
      symbol: "BTC",
      side: "long",
      entryPrice: 1,
      exitPrice: 1,
      quantity: 1,
      entryTime: i,
      exitTime: i + 1,
      pnl: p,
      pnlPercent: 0,
      fees: 0,
    }));
    expect(Math.abs(profitFactor(pnls) - calculateProfitFactor(trades))).toBeLessThan(TOL_ARITH);
  });

  test("profitFactor — Infinity when no losses, 0 when empty", () => {
    expect(profitFactor([10, 20, 30])).toBe(Infinity);
    expect(profitFactor([])).toBe(0);
  });
});
