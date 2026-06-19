/**
 * Market Efficiency Tests — Pre-Trade Filters
 *
 * Answer "is this market tradeable or just noise?" before running any strategy.
 * Three complementary statistical tests:
 *
 *   1. Ljung-Box: detects autocorrelation in returns (patterns exist?)
 *   2. Variance Ratio: tests random walk hypothesis (predictable?)
 *   3. Runs Test: checks if up/down sequence is random (momentum/reversion?)
 *
 * Complements the Hurst exponent — Hurst says WHAT type of regime,
 * these tests say IF a regime exists at all.
 *
 * From: algo_py_genai (Dr. Yves Hilpisch, The Python Quants)
 */

import { normalCdf } from "../../../core/numerics/index.ts";

// ============================================================================
// Types
// ============================================================================

export interface EfficiencyTestResult {
  /** Test name. */
  test: string;
  /** Test statistic. */
  statistic: number;
  /** P-value (probability result is due to chance). */
  pValue: number;
  /** Whether to reject the null hypothesis at 5% significance. */
  rejectNull: boolean;
  /** What rejection means in plain English. */
  interpretation: string;
}

export interface MarketEfficiencyProfile {
  /** Symbol tested. */
  symbol: string;
  /** Number of observations used. */
  observations: number;
  /** Individual test results. */
  tests: {
    ljungBox: EfficiencyTestResult;
    varianceRatio: EfficiencyTestResult;
    runsTest: EfficiencyTestResult;
  };
  /** Overall verdict. */
  tradeable: boolean;
  /** Confidence that the market is tradeable (0-100). */
  tradeabilityScore: number;
  /** Summary for the agent. */
  summary: string;
}

// ============================================================================
// Statistical Helpers
// ============================================================================

function mean(arr: number[]): number {
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function variance(arr: number[]): number {
  const m = mean(arr);
  return arr.reduce((s, v) => s + (v - m) ** 2, 0) / (arr.length - 1);
}

/** Standard-normal CDF — shared `@stdlib`-backed implementation. */
function normalCDF(x: number): number {
  return normalCdf(x);
}

/**
 * Chi-squared CDF approximation for df degrees of freedom.
 * Uses Wilson-Hilferty normal approximation (good for df > 10).
 */
function chiSquaredPValue(statistic: number, df: number): number {
  if (df <= 0) return 1;
  // Wilson-Hilferty approximation
  const z = Math.pow(statistic / df, 1 / 3) - (1 - 2 / (9 * df));
  const denom = Math.sqrt(2 / (9 * df));
  if (denom === 0) return 1;
  const normalZ = z / denom;
  return 1 - normalCDF(normalZ);
}

// ============================================================================
// 1. Ljung-Box Test (Autocorrelation Detection)
// ============================================================================

/**
 * Ljung-Box Q test: tests if autocorrelations of a time series are
 * significantly different from zero.
 *
 * H0: Returns are independently distributed (no autocorrelation)
 * H1: Returns exhibit serial correlation (tradeable patterns)
 *
 * @param returns Daily returns series.
 * @param maxLag Number of lags to test (default 10).
 */
export function ljungBoxTest(returns: number[], maxLag: number = 10): EfficiencyTestResult {
  const n = returns.length;
  if (n < maxLag + 10) {
    return {
      test: "Ljung-Box",
      statistic: 0,
      pValue: 1,
      rejectNull: false,
      interpretation: "Insufficient data for Ljung-Box test.",
    };
  }

  const m = mean(returns);
  const gamma0 = returns.reduce((s, r) => s + (r - m) ** 2, 0) / n;
  if (gamma0 === 0) {
    return { test: "Ljung-Box", statistic: 0, pValue: 1, rejectNull: false, interpretation: "Zero variance — no signal." };
  }

  let Q = 0;
  for (let k = 1; k <= maxLag; k++) {
    let gammaK = 0;
    for (let t = k; t < n; t++) {
      gammaK += (returns[t]! - m) * (returns[t - k]! - m);
    }
    gammaK /= n;
    const rhoK = gammaK / gamma0;
    Q += (rhoK * rhoK) / (n - k);
  }
  Q *= n * (n + 2);

  const pValue = chiSquaredPValue(Q, maxLag);
  const rejectNull = pValue < 0.05;

  return {
    test: "Ljung-Box",
    statistic: Q,
    pValue,
    rejectNull,
    interpretation: rejectNull
      ? `Significant autocorrelation detected (p=${pValue.toFixed(4)}). Returns have exploitable patterns.`
      : `No significant autocorrelation (p=${pValue.toFixed(4)}). Returns appear random.`,
  };
}

// ============================================================================
// 2. Variance Ratio Test (Random Walk Hypothesis)
// ============================================================================

/**
 * Lo-MacKinlay Variance Ratio test: compares variance of k-period returns
 * to k × variance of 1-period returns.
 *
 * H0: VR(k) = 1 (random walk — unpredictable)
 * H1: VR(k) ≠ 1 (mean-reverting if <1, trending if >1)
 *
 * @param prices Price series (not returns).
 * @param period Holding period for comparison (default 5 days).
 */
export function varianceRatioTest(prices: number[], period: number = 5): EfficiencyTestResult {
  const n = prices.length;
  if (n < period * 5) {
    return {
      test: "Variance Ratio",
      statistic: 1,
      pValue: 1,
      rejectNull: false,
      interpretation: "Insufficient data for Variance Ratio test.",
    };
  }

  // Log returns
  const logReturns: number[] = [];
  for (let i = 1; i < n; i++) {
    if (prices[i]! > 0 && prices[i - 1]! > 0) {
      logReturns.push(Math.log(prices[i]! / prices[i - 1]!));
    }
  }

  // 1-period variance
  const var1 = variance(logReturns);
  if (var1 === 0) {
    return { test: "Variance Ratio", statistic: 1, pValue: 1, rejectNull: false, interpretation: "Zero variance." };
  }

  // k-period returns
  const kReturns: number[] = [];
  for (let i = period; i < logReturns.length; i++) {
    let cumReturn = 0;
    for (let j = 0; j < period; j++) cumReturn += logReturns[i - j]!;
    kReturns.push(cumReturn);
  }

  const varK = variance(kReturns);
  const VR = varK / (period * var1);

  // Z-statistic under heteroscedasticity (Lo-MacKinlay)
  const nq = logReturns.length;
  const phi = (2 * (2 * period - 1) * (period - 1)) / (3 * period * nq);
  const z = (VR - 1) / Math.sqrt(phi);
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  const rejectNull = pValue < 0.05;

  let interpretation: string;
  if (!rejectNull) {
    interpretation = `Variance ratio ${VR.toFixed(3)} ≈ 1 (p=${pValue.toFixed(4)}). Cannot reject random walk.`;
  } else if (VR < 1) {
    interpretation = `Variance ratio ${VR.toFixed(3)} < 1 (p=${pValue.toFixed(4)}). Mean-reverting — fade moves.`;
  } else {
    interpretation = `Variance ratio ${VR.toFixed(3)} > 1 (p=${pValue.toFixed(4)}). Trending — follow momentum.`;
  }

  return {
    test: "Variance Ratio",
    statistic: VR,
    pValue,
    rejectNull,
    interpretation,
  };
}

// ============================================================================
// 3. Runs Test (Sequence Randomness)
// ============================================================================

/**
 * Wald-Wolfowitz Runs Test: checks if the sequence of positive/negative
 * returns is random.
 *
 * H0: Sequence is random
 * H1: Too few runs (trending) or too many runs (mean-reverting)
 *
 * @param returns Daily returns series.
 */
export function runsTest(returns: number[]): EfficiencyTestResult {
  const n = returns.length;
  if (n < 20) {
    return {
      test: "Runs Test",
      statistic: 0,
      pValue: 1,
      rejectNull: false,
      interpretation: "Insufficient data for Runs test.",
    };
  }

  // Count positive and negative returns
  const signs = returns.map((r) => (r >= 0 ? 1 : -1));
  const nPos = signs.filter((s) => s === 1).length;
  const nNeg = signs.filter((s) => s === -1).length;

  if (nPos === 0 || nNeg === 0) {
    return { test: "Runs Test", statistic: 0, pValue: 1, rejectNull: false, interpretation: "All returns same sign." };
  }

  // Count runs (consecutive sequences of same sign)
  let runs = 1;
  for (let i = 1; i < signs.length; i++) {
    if (signs[i] !== signs[i - 1]) runs++;
  }

  // Expected runs and standard deviation under H0
  const expectedRuns = 1 + (2 * nPos * nNeg) / (nPos + nNeg);
  const stdRuns = Math.sqrt(
    (2 * nPos * nNeg * (2 * nPos * nNeg - nPos - nNeg)) /
    ((nPos + nNeg) ** 2 * (nPos + nNeg - 1))
  );

  if (stdRuns === 0) {
    return { test: "Runs Test", statistic: 0, pValue: 1, rejectNull: false, interpretation: "Cannot compute." };
  }

  const z = (runs - expectedRuns) / stdRuns;
  const pValue = 2 * (1 - normalCDF(Math.abs(z)));
  const rejectNull = pValue < 0.05;

  let interpretation: string;
  if (!rejectNull) {
    interpretation = `${runs} runs observed vs ${expectedRuns.toFixed(0)} expected (p=${pValue.toFixed(4)}). Sequence appears random.`;
  } else if (runs < expectedRuns) {
    interpretation = `Too few runs: ${runs} vs ${expectedRuns.toFixed(0)} expected (p=${pValue.toFixed(4)}). Trending behavior detected.`;
  } else {
    interpretation = `Too many runs: ${runs} vs ${expectedRuns.toFixed(0)} expected (p=${pValue.toFixed(4)}). Mean-reverting behavior detected.`;
  }

  return {
    test: "Runs Test",
    statistic: z,
    pValue,
    rejectNull,
    interpretation,
  };
}

// ============================================================================
// Combined: Market Efficiency Profile
// ============================================================================

/**
 * Run all 3 efficiency tests and produce a combined tradeability assessment.
 *
 * @param symbol Symbol name (for reporting).
 * @param prices Historical prices (oldest first).
 * @returns Full efficiency profile with tradeability score.
 */
export function assessMarketEfficiency(
  symbol: string,
  prices: number[],
): MarketEfficiencyProfile {
  // Compute returns
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1]! > 0) returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
  }

  const lb = ljungBoxTest(returns);
  const vr = varianceRatioTest(prices);
  const rt = runsTest(returns);

  // Tradeability score: how many tests reject the null (efficiency)?
  const rejections = [lb.rejectNull, vr.rejectNull, rt.rejectNull].filter(Boolean).length;
  const tradeabilityScore = Math.round((rejections / 3) * 100);
  const tradeable = rejections >= 2; // At least 2 of 3 tests say "not random"

  let summary: string;
  if (rejections === 3) {
    summary = `${symbol}: HIGHLY TRADEABLE — all 3 efficiency tests reject randomness. Strong statistical evidence of exploitable patterns.`;
  } else if (rejections === 2) {
    summary = `${symbol}: TRADEABLE — 2 of 3 tests reject randomness. Moderate evidence of patterns.`;
  } else if (rejections === 1) {
    summary = `${symbol}: MARGINAL — only 1 test rejects randomness. Weak evidence. Proceed with caution.`;
  } else {
    summary = `${symbol}: NOT TRADEABLE — all tests consistent with random walk. No statistical edge detected.`;
  }

  return {
    symbol,
    observations: prices.length,
    tests: { ljungBox: lb, varianceRatio: vr, runsTest: rt },
    tradeable,
    tradeabilityScore,
    summary,
  };
}
