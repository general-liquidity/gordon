/**
 * Hurst Exponent — Gold Standard Regime Detection
 *
 * Measures whether a market is trending (H > 0.5) or mean-reverting (H < 0.5).
 * H ≈ 0.5 = random walk (no edge). The further from 0.5, the stronger the regime.
 *
 * From AI Hedge Fund's Technical Analyst (Statistical Arbitrage sub-strategy).
 * Uses the rescaled range (R/S) method.
 */

// ============================================================================
// Core Computation
// ============================================================================

/**
 * Compute the Hurst exponent using the rescaled range (R/S) method.
 *
 * @param prices Price series (at least 100 data points recommended).
 * @returns Hurst exponent (0-1). H < 0.5 = mean reverting, H > 0.5 = trending.
 */
export function computeHurstExponent(prices: number[]): number {
  if (prices.length < 20) return 0.5; // Not enough data

  const returns = pricesToLogReturns(prices);
  if (returns.length < 20) return 0.5;

  // Compute R/S for multiple sub-period lengths
  const minLength = 10;
  const maxLength = Math.floor(returns.length / 2);
  const logNs: number[] = [];
  const logRS: number[] = [];

  for (let n = minLength; n <= maxLength; n = Math.floor(n * 1.5)) {
    const rsValues: number[] = [];
    const numPeriods = Math.floor(returns.length / n);

    for (let i = 0; i < numPeriods; i++) {
      const segment = returns.slice(i * n, (i + 1) * n);
      const rs = rescaledRange(segment);
      if (rs > 0) rsValues.push(rs);
    }

    if (rsValues.length > 0) {
      const avgRS = rsValues.reduce((s, v) => s + v, 0) / rsValues.length;
      logNs.push(Math.log(n));
      logRS.push(Math.log(avgRS));
    }
  }

  if (logNs.length < 3) return 0.5;

  // Linear regression: log(R/S) = H * log(n) + c
  const hurst = linearRegressionSlope(logNs, logRS);

  // Clamp to valid range
  return Math.max(0, Math.min(1, hurst));
}

/**
 * Compute the rescaled range for a series.
 */
function rescaledRange(series: number[]): number {
  const n = series.length;
  if (n < 2) return 0;

  const mean = series.reduce((s, v) => s + v, 0) / n;

  // Cumulative deviations from mean
  const cumDevs: number[] = [];
  let cumDev = 0;
  for (const val of series) {
    cumDev += val - mean;
    cumDevs.push(cumDev);
  }

  const range = Math.max(...cumDevs) - Math.min(...cumDevs);

  // Standard deviation
  const variance = series.reduce((s, v) => s + (v - mean) ** 2, 0) / n;
  const std = Math.sqrt(variance);

  return std > 0 ? range / std : 0;
}

function pricesToLogReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i]! > 0 && prices[i - 1]! > 0) {
      returns.push(Math.log(prices[i]! / prices[i - 1]!));
    }
  }
  return returns;
}

function linearRegressionSlope(x: number[], y: number[]): number {
  const n = x.length;
  const sumX = x.reduce((s, v) => s + v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const sumXY = x.reduce((s, v, i) => s + v * y[i]!, 0);
  const sumX2 = x.reduce((s, v) => s + v * v, 0);

  const denom = n * sumX2 - sumX * sumX;
  return denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
}

// ============================================================================
// Interpretation
// ============================================================================

export type HurstRegime = "strongly_mean_reverting" | "mean_reverting" | "random_walk" | "trending" | "strongly_trending";

export interface HurstAnalysis {
  exponent: number;
  regime: HurstRegime;
  /** Confidence that the regime is real (not noise). Distance from 0.5. */
  confidence: number;
  /** Trading implication. */
  implication: string;
}

/**
 * Interpret a Hurst exponent into a regime classification.
 */
export function interpretHurst(h: number): HurstAnalysis {
  let regime: HurstRegime;
  let implication: string;

  if (h < 0.35) {
    regime = "strongly_mean_reverting";
    implication = "Strong mean reversion. Fade breakouts, buy dips, sell rips. Mean-reversion strategies optimal.";
  } else if (h < 0.45) {
    regime = "mean_reverting";
    implication = "Mild mean reversion. Range-bound strategies preferred. Avoid trend-following.";
  } else if (h < 0.55) {
    regime = "random_walk";
    implication = "Random walk — no detectable edge from persistence. Reduce position sizes.";
  } else if (h < 0.65) {
    regime = "trending";
    implication = "Mild trending. Momentum and trend-following strategies preferred.";
  } else {
    regime = "strongly_trending";
    implication = "Strong trends persist. Trail stops, let winners run. Avoid fading moves.";
  }

  const confidence = Math.min(95, Math.abs(h - 0.5) * 200);

  return { exponent: h, regime, confidence, implication };
}
