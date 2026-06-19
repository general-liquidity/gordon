/**
 * Shared statistics primitives (SPEC Win #3 — `simple-statistics` adoption).
 *
 * Single tested source for the mean / std / variance / quantile / skew / kurtosis /
 * OLS primitives + the composite trading metrics (Sharpe / Sortino / maxDrawdown /
 * CAGR / profitFactor) that `src/backtest/metrics.ts` (and several siblings) currently
 * re-implement 2–4× each. Signatures intentionally mirror `metrics.ts` so callers can
 * swap later with minimal change.
 *
 * Parity discipline (docs/library-adoption/SPEC.md §"parity discipline"): every primitive
 * is golden-tested against the CURRENT hand-rolled output in `stats.test.ts`. Where the
 * hand-rolled versions DIVERGED (the percentile — floor-index in monte-carlo.ts vs
 * interpolated in metrics.ts), we adopt the correct (interpolated / type=7) definition as
 * the new reference rather than preserving a bug for parity. See `quantile` below.
 */

import {
  mean as ssMean,
  median as ssMedian,
  variance as ssPopVariance,
  sampleVariance as ssSampleVariance,
  standardDeviation as ssPopStd,
  sampleStandardDeviation as ssSampleStd,
  sampleSkewness as ssSampleSkewness,
  sampleKurtosis as ssSampleKurtosis,
  sampleCorrelation as ssSampleCorrelation,
  sampleCovariance as ssSampleCovariance,
  quantileSorted as ssQuantileSorted,
  linearRegression as ssLinearRegression,
} from "simple-statistics";

// ============================================================================
// Constants (mirror src/backtest/metrics.ts)
// ============================================================================

/** Default risk-free rate for Sharpe/Sortino (2% annual). Matches metrics.ts. */
export const DEFAULT_RISK_FREE_RATE = 0.02;

/**
 * Default periods-per-year for annualizing per-bar return statistics.
 * 365 assumes 24/7 daily crypto bars. Matches `metrics.ts` TRADING_DAYS_PER_YEAR.
 */
export const DEFAULT_PERIODS_PER_YEAR = 365;

// ============================================================================
// Base primitives
// ============================================================================

/**
 * Arithmetic mean. Returns 0 for an empty array (callers in metrics.ts guard
 * length before computing; `ss.mean` throws on empty, so we guard here to keep
 * the primitive total).
 */
export function mean(x: number[]): number {
  if (x.length === 0) return 0;
  return ssMean(x);
}

/** Sample variance (n−1, Bessel-corrected). Matches metrics.ts inline variance. */
export function variance(x: number[]): number {
  if (x.length < 2) return 0;
  return ssSampleVariance(x);
}

/** Sample standard deviation (n−1, Bessel-corrected). */
export function sampleStd(x: number[]): number {
  if (x.length < 2) return 0;
  return ssSampleStd(x);
}

/** Median (linear-interpolated for even n — same as monte-carlo.ts impl). */
export function median(x: number[]): number {
  if (x.length === 0) return 0;
  return ssMedian(x);
}

/**
 * Bias-corrected (sample) skewness — adjusted Fisher-Pearson standardized moment
 * coefficient (the Excel/SAS/SPSS/Minitab convention). Requires ≥3 points;
 * returns 0 below that to keep the primitive total.
 */
export function skewness(x: number[]): number {
  if (x.length < 3) return 0;
  return ssSampleSkewness(x);
}

/**
 * Bias-corrected (sample) excess kurtosis — Fisher's definition with unbiased
 * moment estimators (the Excel/SAS/SciPy convention). Requires ≥4 points;
 * returns 0 below that to keep the primitive total.
 */
export function kurtosis(x: number[]): number {
  if (x.length < 4) return 0;
  return ssSampleKurtosis(x);
}

/**
 * Quantile of an array, p ∈ [0, 1].
 *
 * PERCENTILE DEFINITION (the divergence resolved): Gordon had two impls —
 *   - `metrics.ts` percentile(): linear-interpolated, idx = p·(n−1) (numpy type=7)
 *   - `monte-carlo.ts` calculateDistribution(): floor-index, idx = floor(p·n)
 * These disagree (latent correctness bug, flagged in SPEC.md Win #3). We adopt the
 * INTERPOLATED / type=7 definition — the standard used by numpy.percentile and R's
 * quantile, and what `metrics.ts` (which feeds the judged Sharpe-adjacent tail ratio)
 * already uses. `simple-statistics` `quantileSorted` implements exactly this.
 *
 * Input is sorted internally (does not mutate the caller's array).
 */
export function quantile(x: number[], p: number): number {
  if (x.length === 0) return 0;
  const sorted = [...x].sort((a, b) => a - b);
  return ssQuantileSorted(sorted, p);
}

/**
 * Quantile of an ALREADY-sorted (ascending) array — avoids the re-sort when the
 * caller maintains sorted order. Same type=7 interpolation as `quantile`.
 */
export function quantileSorted(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  return ssQuantileSorted(sorted, p);
}

/**
 * Ordinary-least-squares simple linear regression over (x, y) pairs.
 * Returns slope `m` and intercept `b` (y = m·x + b), matching `ss.linearRegression`.
 */
export function linearRegression(
  x: number[],
  y: number[],
): { slope: number; intercept: number } {
  const n = Math.min(x.length, y.length);
  const pairs: number[][] = [];
  for (let i = 0; i < n; i++) pairs.push([x[i] as number, y[i] as number]);
  const { m, b } = ssLinearRegression(pairs);
  return { slope: m, intercept: b };
}

/** Alias for callers preferring the OLS name. */
export const ols = linearRegression;

/**
 * Population variance (÷N, NOT Bessel-corrected). For the callers (Bollinger
 * band-width, Knuteson leg-signature) that intentionally use the population
 * estimator over a fixed window. Returns 0 for an empty array.
 */
export function populationVariance(x: number[]): number {
  if (x.length === 0) return 0;
  return ssPopVariance(x);
}

/**
 * Population standard deviation (÷N). **Watch the ddof:** Bollinger bands use
 * population std — routing them through `sampleStd` (÷N−1) would widen the bands.
 * Returns 0 for an empty array.
 */
export function populationStd(x: number[]): number {
  if (x.length === 0) return 0;
  return ssPopStd(x);
}

/**
 * Pearson product-moment correlation between two equal-length series.
 * Returns 0 when either series has < 2 points or zero variance (matches the
 * defensive guards in the inline `pearson()` copies being consolidated).
 */
export function sampleCorrelation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const a = x.slice(0, n);
  const b = y.slice(0, n);
  const r = ssSampleCorrelation(a, b);
  return Number.isFinite(r) ? r : 0;
}

/** Pearson correlation alias. */
export const pearson = sampleCorrelation;

/**
 * Sample covariance (n−1) between two equal-length series. Returns 0 below 2
 * points.
 */
export function sampleCovariance(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  return ssSampleCovariance(x.slice(0, n), y.slice(0, n));
}

/**
 * Standardized z-score (value − μ) / σ. Returns 0 when σ is 0 or non-finite, so
 * a degenerate (flat) window yields 0 rather than NaN/Infinity — matching the
 * inline rolling-z-score copies (order-blocks, crypto-factor-model).
 */
export function zScore(value: number, mu: number, sigma: number): number {
  if (!Number.isFinite(sigma) || sigma === 0) return 0;
  return (value - mu) / sigma;
}

/**
 * Coefficient of determination R² for a SIMPLE (one-variable) OLS fit. For
 * simple linear regression R² = Pearson(x, y)², which is exact and avoids
 * re-deriving residual sums. Returns 0 below 2 points / zero variance.
 */
export function rSquared(x: number[], y: number[]): number {
  const r = sampleCorrelation(x, y);
  return r * r;
}

// ============================================================================
// Composite trading metrics (mirror src/backtest/metrics.ts signatures)
// ============================================================================

/**
 * Annualized volatility = sample-std(returns) × √periodsPerYear.
 * Mirrors `metrics.ts` calculateVolatility — returns 0 below 2 observations.
 */
export function volatility(
  returns: number[],
  periodsPerYear: number = DEFAULT_PERIODS_PER_YEAR,
): number {
  if (returns.length < 2) return 0;
  return sampleStd(returns) * Math.sqrt(periodsPerYear);
}

/**
 * Annualized Sharpe ratio — the judged competition metric.
 * (annualizedMeanReturn − riskFreeRate) / annualizedVolatility.
 * Mirrors `metrics.ts` calculateSharpeRatio exactly: mean × periodsPerYear for the
 * numerator, sample-std × √periodsPerYear for the denominator.
 */
export function sharpe(
  returns: number[],
  riskFreeRate: number = DEFAULT_RISK_FREE_RATE,
  periodsPerYear: number = DEFAULT_PERIODS_PER_YEAR,
): number {
  if (returns.length < 2) return 0;
  const annualizedMeanReturn = mean(returns) * periodsPerYear;
  const vol = volatility(returns, periodsPerYear);
  if (vol === 0) return 0;
  return (annualizedMeanReturn - riskFreeRate) / vol;
}

/**
 * Annualized Sortino ratio — downside-deviation-adjusted return.
 * Mirrors `metrics.ts` calculateSortinoRatio EXACTLY, including the load-bearing
 * detail that downside variance divides by `returns.length` (NOT the count of
 * negative returns, and NOT n−1). Infinity when there are no negative returns and
 * the mean clears the risk-free rate.
 */
export function sortino(
  returns: number[],
  riskFreeRate: number = DEFAULT_RISK_FREE_RATE,
  periodsPerYear: number = DEFAULT_PERIODS_PER_YEAR,
): number {
  if (returns.length < 2) return 0;
  const annualizedMeanReturn = mean(returns) * periodsPerYear;

  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) {
    return annualizedMeanReturn > riskFreeRate ? Infinity : 0;
  }

  const downsideVariance =
    negativeReturns.reduce((sum, r) => sum + r * r, 0) / returns.length;
  const annualizedDownsideDeviation =
    Math.sqrt(downsideVariance) * Math.sqrt(periodsPerYear);
  if (annualizedDownsideDeviation === 0) return 0;

  return (annualizedMeanReturn - riskFreeRate) / annualizedDownsideDeviation;
}

/**
 * Maximum drawdown of an equity series, as a positive percentage (e.g. 15.5 for
 * 15.5%). Largest peak-to-trough decline. Mirrors `metrics.ts` calculateMaxDrawdown
 * but takes a plain `number[]` equity series (the de-duplicated shape: metrics.ts /
 * monte-carlo.ts / simulator.ts each track peak over a different point shape — the
 * peak-track loop is identical). Returns 0 for series shorter than 2.
 */
export function maxDrawdown(equity: number[]): number {
  if (equity.length < 2) return 0;

  let maxDd = 0;
  let peak = equity[0] as number;

  for (const value of equity) {
    if (value > peak) peak = value;
    if (peak > 0) {
      const dd = ((peak - value) / peak) * 100;
      if (dd > maxDd) maxDd = dd;
    }
  }

  return maxDd;
}

/**
 * Compound Annual Growth Rate (%), from initial/final capital over `years`.
 * Mirrors `metrics.ts` calculateCAGR including the negative/zero-final guard.
 */
export function cagr(
  initialCapital: number,
  finalCapital: number,
  years: number,
): number {
  if (initialCapital <= 0 || years <= 0) return 0;
  const ratio = finalCapital / initialCapital;
  if (ratio <= 0) return -100;
  return (Math.pow(ratio, 1 / years) - 1) * 100;
}

/**
 * Profit factor = gross profit / gross loss over a P&L series.
 * Mirrors `metrics.ts` calculateProfitFactor: 0 for an empty series, Infinity when
 * there are profits but no losses, 0 when neither. Takes the raw per-trade P&L
 * numbers (the de-duplicated shape — metrics.ts filters `.pnl` off trade records).
 */
export function profitFactor(pnl: number[]): number {
  if (pnl.length === 0) return 0;
  const grossProfit = pnl.filter((p) => p > 0).reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(pnl.filter((p) => p < 0).reduce((s, p) => s + p, 0));
  if (grossLoss === 0) return grossProfit > 0 ? Infinity : 0;
  return grossProfit / grossLoss;
}
