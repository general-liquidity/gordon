/**
 * Cointegration Test — Missing piece for pairs trading
 *
 * Tests whether two price series are statistically bound together
 * (cointegrated). If cointegrated, the spread is mean-reverting and
 * pairs trading is viable.
 *
 * Implements:
 *   1. Engle-Granger two-step cointegration test
 *   2. Augmented Dickey-Fuller (ADF) test on residuals
 *   3. Half-life of mean reversion
 *   4. Z-score entry/exit signal generation
 *
 * Gordon already has: pearsonCorrelation, Hurst exponent,
 * analyze_pair_spread (z-score, Bollinger). This adds the statistical
 * foundation that makes pairs trading rigorous.
 */

// ============================================================================
// Types
// ============================================================================

export interface CointegrationResult {
  /** Whether the pair is cointegrated at the given significance level. */
  cointegrated: boolean;
  /** ADF test statistic on the residuals. */
  adfStatistic: number;
  /** Critical values at 1%, 5%, 10% significance. */
  criticalValues: { pct1: number; pct5: number; pct10: number };
  /** Significance level at which cointegration holds (null if not cointegrated). */
  significanceLevel: "1%" | "5%" | "10%" | null;
  /** Hedge ratio (beta) — how many units of Y to hold per unit of X. */
  hedgeRatio: number;
  /** Intercept of the cointegrating regression. */
  intercept: number;
  /** Half-life of mean reversion in periods (days if daily data). */
  halfLife: number;
  /** Current spread z-score. */
  currentZScore: number;
  /** Trading signal based on z-score thresholds. */
  signal: "enter_long" | "enter_short" | "exit" | "hold";
  /** Spread series (residuals). */
  spread: number[];
}

export interface PairsTradeSignal {
  /** Z-score threshold to enter (default 2.0). */
  entryThreshold: number;
  /** Z-score threshold to exit (default 0.5). */
  exitThreshold: number;
  /** Z-score threshold for stop loss (default 3.5). */
  stopThreshold: number;
}

export const DEFAULT_SIGNAL_CONFIG: PairsTradeSignal = {
  entryThreshold: 2.0,
  exitThreshold: 0.5,
  stopThreshold: 3.5,
};

// ============================================================================
// Linear Regression (OLS)
// ============================================================================

function linearRegression(
  x: number[],
  y: number[],
): { slope: number; intercept: number; residuals: number[] } {
  const n = x.length;
  const sumX = x.reduce((s, v) => s + v, 0);
  const sumY = y.reduce((s, v) => s + v, 0);
  const sumXY = x.reduce((s, v, i) => s + v * y[i]!, 0);
  const sumX2 = x.reduce((s, v) => s + v * v, 0);

  const denom = n * sumX2 - sumX * sumX;
  const slope = denom !== 0 ? (n * sumXY - sumX * sumY) / denom : 0;
  const intercept = (sumY - slope * sumX) / n;

  const residuals = y.map((yi, i) => yi - (slope * x[i]! + intercept));
  return { slope, intercept, residuals };
}

// ============================================================================
// Augmented Dickey-Fuller Test
// ============================================================================

/**
 * Simplified ADF test — tests if a series has a unit root (non-stationary).
 * If the test statistic is more negative than the critical value,
 * we reject the null hypothesis of a unit root → series is stationary.
 *
 * Uses the ADF regression: Δy_t = α + β*y_{t-1} + Σ(γ_i * Δy_{t-i}) + ε_t
 * We test if β < 0 (mean-reverting).
 */
function adfTest(
  series: number[],
  maxLags: number = 1,
): {
  statistic: number;
  criticalValues: { pct1: number; pct5: number; pct10: number };
} {
  const n = series.length;
  if (n < 20) return { statistic: 0, criticalValues: { pct1: -3.43, pct5: -2.86, pct10: -2.57 } };

  // Compute first differences
  const dy: number[] = [];
  for (let i = 1; i < n; i++) dy.push(series[i]! - series[i - 1]!);

  // Build regression: Δy_t = α + β*y_{t-1} + ε_t (simplified, lag=1)
  const offset = maxLags;
  const yLag: number[] = [];
  const dyDep: number[] = [];

  for (let i = offset; i < dy.length; i++) {
    yLag.push(series[i]!);
    dyDep.push(dy[i]!);
  }

  if (yLag.length < 10)
    return { statistic: 0, criticalValues: { pct1: -3.43, pct5: -2.86, pct10: -2.57 } };

  // OLS: dyDep = α + β * yLag
  const reg = linearRegression(yLag, dyDep);

  // Standard error of β
  const nReg = yLag.length;
  const rss = reg.residuals.reduce((s, r) => s + r * r, 0);
  const mse = rss / (nReg - 2);
  const xMean = yLag.reduce((s, v) => s + v, 0) / nReg;
  const sxx = yLag.reduce((s, v) => s + (v - xMean) ** 2, 0);
  const seBeta = sxx > 0 ? Math.sqrt(mse / sxx) : 1;

  const tStatistic = seBeta > 0 ? reg.slope / seBeta : 0;

  // MacKinnon critical values (approximate, for n > 100 with constant)
  return {
    statistic: tStatistic,
    criticalValues: { pct1: -3.43, pct5: -2.86, pct10: -2.57 },
  };
}

// ============================================================================
// Half-Life of Mean Reversion
// ============================================================================

/**
 * Estimate the half-life from an AR(1) model on the spread:
 *   spread_t = φ * spread_{t-1} + ε_t
 *   half-life = -ln(2) / ln(φ)
 */
function computeHalfLife(spread: number[]): number {
  if (spread.length < 10) return Infinity;

  const y = spread.slice(1);
  const x = spread.slice(0, -1);
  const reg = linearRegression(x, y);
  const phi = reg.slope;

  if (phi <= 0 || phi >= 1) return Infinity;
  return -Math.log(2) / Math.log(phi);
}

// ============================================================================
// Z-Score
// ============================================================================

function zScore(series: number[]): number {
  if (series.length < 2) return 0;
  const mean = series.reduce((s, v) => s + v, 0) / series.length;
  const std = Math.sqrt(series.reduce((s, v) => s + (v - mean) ** 2, 0) / (series.length - 1));
  if (std === 0) return 0;
  return (series[series.length - 1]! - mean) / std;
}

// ============================================================================
// Main: Cointegration Test
// ============================================================================

/**
 * Test cointegration between two price series using Engle-Granger method.
 *
 * @param pricesX Price series for asset X (e.g., BTC).
 * @param pricesY Price series for asset Y (e.g., ETH).
 * @param signalConfig Z-score thresholds for trade signals.
 * @returns Cointegration result with hedge ratio, half-life, and signal.
 */
export function testCointegration(
  pricesX: number[],
  pricesY: number[],
  signalConfig: PairsTradeSignal = DEFAULT_SIGNAL_CONFIG,
): CointegrationResult {
  const n = Math.min(pricesX.length, pricesY.length);
  const x = pricesX.slice(-n);
  const y = pricesY.slice(-n);

  // Step 1: Regress Y on X → get hedge ratio and residuals (spread)
  const reg = linearRegression(x, y);
  const spread = reg.residuals;

  // Step 2: ADF test on residuals
  const adf = adfTest(spread);

  // Determine significance level
  let significanceLevel: CointegrationResult["significanceLevel"] = null;
  if (adf.statistic < adf.criticalValues.pct1) significanceLevel = "1%";
  else if (adf.statistic < adf.criticalValues.pct5) significanceLevel = "5%";
  else if (adf.statistic < adf.criticalValues.pct10) significanceLevel = "10%";

  const cointegrated = significanceLevel !== null;

  // Step 3: Half-life
  const halfLife = computeHalfLife(spread);

  // Step 4: Current z-score and signal
  const currentZ = zScore(spread);
  let signal: CointegrationResult["signal"] = "hold";

  if (cointegrated) {
    if (currentZ < -signalConfig.entryThreshold)
      signal = "enter_long"; // Spread below mean → buy spread
    else if (currentZ > signalConfig.entryThreshold)
      signal = "enter_short"; // Spread above mean → sell spread
    else if (Math.abs(currentZ) < signalConfig.exitThreshold) signal = "exit"; // Near mean → close
  }

  return {
    cointegrated,
    adfStatistic: adf.statistic,
    criticalValues: adf.criticalValues,
    significanceLevel,
    hedgeRatio: reg.slope,
    intercept: reg.intercept,
    halfLife,
    currentZScore: currentZ,
    signal,
    spread,
  };
}

/**
 * Format cointegration result for display.
 */
export function formatCointegrationResult(
  r: CointegrationResult,
  symbolX: string,
  symbolY: string,
): string {
  const lines: string[] = [];
  lines.push(`Pairs Trading: ${symbolX} / ${symbolY}`);
  lines.push(
    `  Cointegrated: ${r.cointegrated ? `YES (${r.significanceLevel} significance)` : "NO"}`,
  );
  lines.push(
    `  ADF Statistic: ${r.adfStatistic.toFixed(3)} (1%: ${r.criticalValues.pct1}, 5%: ${r.criticalValues.pct5})`,
  );
  lines.push(
    `  Hedge Ratio: ${r.hedgeRatio.toFixed(4)} (${r.hedgeRatio.toFixed(2)} ${symbolY} per 1 ${symbolX})`,
  );
  lines.push(
    `  Half-Life: ${r.halfLife === Infinity ? "N/A (no mean reversion)" : `${r.halfLife.toFixed(1)} periods`}`,
  );
  lines.push(`  Current Z-Score: ${r.currentZScore.toFixed(2)}`);
  lines.push(`  Signal: ${r.signal.replace("_", " ").toUpperCase()}`);
  return lines.join("\n");
}
