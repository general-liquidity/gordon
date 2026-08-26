/**
 * Backtest Credibility Tests — Is This Sharpe Real?
 *
 * Prevents backtesting self-deception. Four statistical tests:
 *
 *   1. Probabilistic Sharpe Ratio (PSR): "Is this Sharpe significantly > benchmark?"
 *   2. Deflated Sharpe Ratio (DSR): "Is this Sharpe real after accounting for
 *      data-mining (trying many strategies)?"
 *   3. Minimum Track Record Length (minTRL): "How many trades/periods needed
 *      before this Sharpe becomes credible?"
 *   4. Combinatorial Purged Cross-Validation (CPCV): "Does performance hold
 *      out-of-sample with no look-ahead bias?"
 *
 * Without these, a Sharpe of 2.0 could just be luck from testing 100 strategies
 * and cherry-picking the best one.
 *
 * Source: FinRL_Crypto (Bailey & López de Prado, 2012-2014)
 */

import { normalCdf } from "../../../core/numerics/index.ts";

// ============================================================================
// Types
// ============================================================================

export interface SharpeCredibilityResult {
  /** Observed Sharpe ratio. */
  observedSharpe: number;
  /** PSR: probability that true Sharpe > benchmark. */
  psr: number;
  /** Whether PSR passes at 95% confidence. */
  psrSignificant: boolean;
  /** DSR: Sharpe adjusted for multiple testing. */
  deflatedSharpe: number;
  /** Whether DSR passes (strategy is genuinely skillful). */
  dsrSignificant: boolean;
  /** Minimum track record needed for this Sharpe to be credible. */
  minTrackRecordLength: number;
  /** Actual track record length (periods). */
  actualLength: number;
  /** Whether track record is long enough. */
  sufficientTrackRecord: boolean;
  /** Overall verdict. */
  credible: boolean;
  /** Human-readable summary. */
  summary: string;
}

export interface CPCVResult {
  /** Number of folds tested. */
  folds: number;
  /** Out-of-sample Sharpe ratios per fold. */
  oosSharpesPerFold: number[];
  /** Mean out-of-sample Sharpe. */
  meanOOSSharpe: number;
  /** Probability of backtest overfitting (PBO). */
  pbo: number;
  /** Whether strategy is likely overfit. */
  likelyOverfit: boolean;
  /** Summary. */
  summary: string;
}

// ============================================================================
// Statistical Helpers
// ============================================================================

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function stddev(arr: number[]): number {
  const m = mean(arr);
  return Math.sqrt(arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1));
}

function skewness(arr: number[]): number {
  const n = arr.length;
  if (n < 3) return 0;
  const m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 0;
  return (n / ((n - 1) * (n - 2))) * arr.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0);
}

function kurtosis(arr: number[]): number {
  const n = arr.length;
  if (n < 4) return 3; // Normal kurtosis
  const m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 3;
  const sum4 = arr.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0);
  return ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum4
    - (3 * (n - 1) ** 2) / ((n - 2) * (n - 3)) + 3;
}

/**
 * Float-precision zero-variance guard. A constant return series (e.g. fifty
 * 0.01s) accumulates rounding noise in mean/stddev, producing s ~1e-18 instead
 * of exactly 0 — which defeats `s === 0` checks and turns a degenerate series
 * into an astronomical Sharpe. Treat s as zero when it is vanishingly small
 * relative to the mean (a real per-period Sharpe above 1e12 is not a strategy,
 * it is float noise). NaN stddev also counts as degenerate — fail closed.
 */
const ZERO_VARIANCE_REL_EPS = 1e-12;

function isEffectivelyZeroStddev(s: number, m: number): boolean {
  if (!Number.isFinite(s) || s === 0) return true;
  return s <= ZERO_VARIANCE_REL_EPS * Math.abs(m);
}

function normalInverseCDF(p: number): number {
  // Rational approximation (Abramowitz & Stegun 26.2.23)
  if (p <= 0) return -Infinity;
  if (p >= 1) return Infinity;
  if (p === 0.5) return 0;

  const t = p < 0.5 ? Math.sqrt(-2 * Math.log(p)) : Math.sqrt(-2 * Math.log(1 - p));
  const c0 = 2.515517, c1 = 0.802853, c2 = 0.010328;
  const d1 = 1.432788, d2 = 0.189269, d3 = 0.001308;
  const result = t - (c0 + c1 * t + c2 * t * t) / (1 + d1 * t + d2 * t * t + d3 * t * t * t);
  return p < 0.5 ? -result : result;
}

// ============================================================================
// 1. Probabilistic Sharpe Ratio (PSR)
// ============================================================================

/**
 * PSR: probability that the true Sharpe ratio exceeds a benchmark.
 *
 * Accounts for non-normality of returns (skewness + kurtosis).
 * Bailey & López de Prado (2012).
 *
 * @param returns Period returns.
 * @param benchmarkSharpe Sharpe to beat (default 0 = "is it positive?").
 * @param periodsPerYear Annualization factor (252 for daily stocks, 365 crypto).
 */
export function probabilisticSharpeRatio(
  returns: number[],
  benchmarkSharpe: number = 0,
  periodsPerYear: number = 365,
): { psr: number; observedSharpe: number; significant: boolean } {
  const n = returns.length;
  if (n < 10) return { psr: 0.5, observedSharpe: 0, significant: false };

  const m = mean(returns);
  const s = stddev(returns);
  if (isEffectivelyZeroStddev(s, m)) return { psr: 0.5, observedSharpe: 0, significant: false };

  const observedSharpe = (m / s) * Math.sqrt(periodsPerYear);
  const skew = skewness(returns);
  const kurt = kurtosis(returns);

  // Standard error of Sharpe (Lo, 2002 + non-normal correction)
  const srStar = observedSharpe / Math.sqrt(periodsPerYear); // Per-period Sharpe
  const benchStar = benchmarkSharpe / Math.sqrt(periodsPerYear);

  const seSharpe = Math.sqrt(
    (1 - skew * srStar + ((kurt - 1) / 4) * srStar * srStar) / n
  );

  // !(x > 0) also catches NaN (negative sqrt argument from extreme skew/kurtosis) — fail closed.
  if (!(seSharpe > 0)) return { psr: 0.5, observedSharpe, significant: false };

  const z = (srStar - benchStar) / seSharpe;
  const psr = normalCdf(z);

  return {
    psr,
    observedSharpe,
    significant: psr > 0.95,
  };
}

// ============================================================================
// 2. Deflated Sharpe Ratio (DSR)
// ============================================================================

/**
 * Expected maximum Sharpe from N independent trials under null (no skill).
 * Approximation from Bailey & López de Prado (2014).
 */
function expectedMaxSharpe(numTrials: number, variance: number, numPeriods: number): number {
  if (numTrials <= 1) return 0;
  const eZ = (1 - 0.5772) * normalInverseCDF(1 - 1 / numTrials) +
    0.5772 * normalInverseCDF(1 - 1 / (numTrials * Math.E));
  return Math.sqrt(variance / numPeriods) * eZ;
}

/**
 * DSR: Sharpe ratio deflated for multiple testing (trying many strategies).
 *
 * If you tested 50 strategies and picked the best Sharpe, DSR tells you
 * if that Sharpe is still significant after accounting for selection bias.
 *
 * @param returns Period returns of the selected strategy.
 * @param numStrategiesTested How many strategies were tried.
 * @param periodsPerYear Annualization factor.
 */
export function deflatedSharpeRatio(
  returns: number[],
  numStrategiesTested: number = 1,
  periodsPerYear: number = 365,
): { dsr: number; observedSharpe: number; expectedMaxSharpeUnderNull: number; significant: boolean } {
  const n = returns.length;
  if (n < 10) return { dsr: 0.5, observedSharpe: 0, expectedMaxSharpeUnderNull: 0, significant: false };

  const m = mean(returns);
  const s = stddev(returns);
  if (isEffectivelyZeroStddev(s, m)) return { dsr: 0.5, observedSharpe: 0, expectedMaxSharpeUnderNull: 0, significant: false };

  const observedSharpe = (m / s) * Math.sqrt(periodsPerYear);
  const skew = skewness(returns);
  const kurt = kurtosis(returns);

  // Expected max Sharpe under the null hypothesis (no skill)
  const srVariance = 1; // Variance of Sharpe ratios under null ≈ 1
  const eSharpeMax = expectedMaxSharpe(numStrategiesTested, srVariance, n);
  const annualizedESharpeMax = eSharpeMax * Math.sqrt(periodsPerYear);

  // PSR with benchmark = expected max Sharpe
  const srStar = observedSharpe / Math.sqrt(periodsPerYear);
  const benchStar = eSharpeMax;

  const seSharpe = Math.sqrt(
    (1 - skew * srStar + ((kurt - 1) / 4) * srStar * srStar) / n
  );

  // !(x > 0) also catches NaN (negative sqrt argument from extreme skew/kurtosis) — fail closed.
  if (!(seSharpe > 0)) return { dsr: 0.5, observedSharpe, expectedMaxSharpeUnderNull: annualizedESharpeMax, significant: false };

  const z = (srStar - benchStar) / seSharpe;
  const dsr = normalCdf(z);

  return {
    dsr,
    observedSharpe,
    expectedMaxSharpeUnderNull: annualizedESharpeMax,
    significant: dsr > 0.95,
  };
}

// ============================================================================
// 3. Minimum Track Record Length (minTRL)
// ============================================================================

/**
 * How many periods are needed before the observed Sharpe is credible?
 *
 * Bailey & López de Prado (2012): minTRL = 1 + (1 - skew*SR + (kurt-1)/4 * SR²) * (z_α / SR)²
 *
 * @param returns Period returns.
 * @param confidenceLevel Confidence level (default 0.95).
 * @param periodsPerYear Annualization factor.
 */
export function minimumTrackRecordLength(
  returns: number[],
  confidenceLevel: number = 0.95,
  periodsPerYear: number = 365,
): { minTRL: number; actualLength: number; sufficient: boolean; observedSharpe: number } {
  const n = returns.length;
  if (n < 5) return { minTRL: Infinity, actualLength: n, sufficient: false, observedSharpe: 0 };

  const m = mean(returns);
  const s = stddev(returns);
  if (isEffectivelyZeroStddev(s, m) || m <= 0) return { minTRL: Infinity, actualLength: n, sufficient: false, observedSharpe: 0 };

  const sr = m / s; // Per-period Sharpe
  const observedSharpe = sr * Math.sqrt(periodsPerYear);
  const skew = skewness(returns);
  const kurt = kurtosis(returns);
  const zAlpha = normalInverseCDF(confidenceLevel);

  const nonNormalCorrection = 1 - skew * sr + ((kurt - 1) / 4) * sr * sr;
  const minTRL = Math.max(1, Math.ceil(1 + nonNormalCorrection * (zAlpha / sr) ** 2));

  return {
    minTRL,
    actualLength: n,
    sufficient: n >= minTRL,
    observedSharpe,
  };
}

// ============================================================================
// 4. Combinatorial Purged Cross-Validation (CPCV)
// ============================================================================

/**
 * Simplified CPCV: split returns into K folds, test each as out-of-sample
 * with purge gap to prevent data leakage.
 *
 * Returns Probability of Backtest Overfitting (PBO) = fraction of OOS folds
 * with Sharpe < 0.
 *
 * @param returns Full return series.
 * @param nFolds Number of folds (default 6).
 * @param purgeGap Periods to skip between train/test (default 5).
 * @param periodsPerYear Annualization factor.
 */
export function combinatorialPurgedCV(
  returns: number[],
  nFolds: number = 6,
  purgeGap: number = 5,
  periodsPerYear: number = 365,
): CPCVResult {
  const n = returns.length;
  const foldSize = Math.floor(n / nFolds);

  if (foldSize < 20) {
    return {
      folds: 0,
      oosSharpesPerFold: [],
      meanOOSSharpe: 0,
      pbo: 1,
      likelyOverfit: true,
      summary: "Insufficient data for CPCV (need at least 120 periods for 6 folds).",
    };
  }

  const oosSharpesPerFold: number[] = [];

  for (let testFold = 0; testFold < nFolds; testFold++) {
    const testStart = testFold * foldSize;
    const testEnd = Math.min(testStart + foldSize, n);

    // Purge: exclude purgeGap periods around test set from training
    const purgeStart = Math.max(0, testStart - purgeGap);
    const purgeEnd = Math.min(n, testEnd + purgeGap);

    // Training returns: everything except test + purge zone
    const trainReturns: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i < purgeStart || i >= purgeEnd) trainReturns.push(returns[i]!);
    }

    // Test returns
    const testReturns = returns.slice(testStart, testEnd);

    if (trainReturns.length < 20 || testReturns.length < 10) continue;

    // Compute "signal" from training: simple sign of mean return
    const trainMean = mean(trainReturns);
    const signal = trainMean >= 0 ? 1 : -1;

    // Apply signal to test period
    const signalReturns = testReturns.map((r) => r * signal);
    const testMean = mean(signalReturns);
    const testStd = stddev(signalReturns);
    const testSharpe = isEffectivelyZeroStddev(testStd, testMean)
      ? 0
      : (testMean / testStd) * Math.sqrt(periodsPerYear);

    oosSharpesPerFold.push(testSharpe);
  }

  if (oosSharpesPerFold.length === 0) {
    return { folds: 0, oosSharpesPerFold: [], meanOOSSharpe: 0, pbo: 1, likelyOverfit: true, summary: "CPCV failed — no valid folds." };
  }

  const meanOOSSharpe = mean(oosSharpesPerFold);
  const negativeFolds = oosSharpesPerFold.filter((s) => s <= 0).length;
  const pbo = negativeFolds / oosSharpesPerFold.length;
  const likelyOverfit = pbo > 0.5;

  const summary = likelyOverfit
    ? `LIKELY OVERFIT: ${(pbo * 100).toFixed(0)}% of OOS folds have negative Sharpe. Mean OOS Sharpe: ${meanOOSSharpe.toFixed(2)}.`
    : `CREDIBLE: ${((1 - pbo) * 100).toFixed(0)}% of OOS folds profitable. Mean OOS Sharpe: ${meanOOSSharpe.toFixed(2)}. PBO: ${(pbo * 100).toFixed(0)}%.`;

  return {
    folds: oosSharpesPerFold.length,
    oosSharpesPerFold,
    meanOOSSharpe,
    pbo,
    likelyOverfit,
    summary,
  };
}

// ============================================================================
// Combined: Full Credibility Assessment
// ============================================================================

/**
 * Run all credibility tests on a backtest result.
 *
 * @param returns Period returns from the backtest.
 * @param numStrategiesTested How many strategies were tried to find this one.
 * @param periodsPerYear Annualization factor.
 */
export function assessBacktestCredibility(
  returns: number[],
  numStrategiesTested: number = 1,
  periodsPerYear: number = 365,
): SharpeCredibilityResult {
  const psr = probabilisticSharpeRatio(returns, 0, periodsPerYear);
  const dsr = deflatedSharpeRatio(returns, numStrategiesTested, periodsPerYear);
  const mtrl = minimumTrackRecordLength(returns, 0.95, periodsPerYear);

  const credible = psr.significant && dsr.significant && mtrl.sufficient;

  const parts: string[] = [];
  parts.push(`Sharpe: ${psr.observedSharpe.toFixed(2)}`);
  parts.push(`PSR: ${(psr.psr * 100).toFixed(0)}% ${psr.significant ? "✓" : "✗"}`);
  parts.push(`DSR: ${(dsr.dsr * 100).toFixed(0)}% ${dsr.significant ? "✓" : "✗"} (tested ${numStrategiesTested} strategies)`);
  parts.push(`MinTRL: ${mtrl.minTRL} periods needed, have ${mtrl.actualLength} ${mtrl.sufficient ? "✓" : "✗"}`);
  parts.push(credible ? "VERDICT: Statistically credible" : "VERDICT: NOT credible — may be noise or data-mining artifact");

  return {
    observedSharpe: psr.observedSharpe,
    psr: psr.psr,
    psrSignificant: psr.significant,
    deflatedSharpe: dsr.dsr,
    dsrSignificant: dsr.significant,
    minTrackRecordLength: mtrl.minTRL,
    actualLength: mtrl.actualLength,
    sufficientTrackRecord: mtrl.sufficient,
    credible,
    summary: parts.join(" | "),
  };
}
