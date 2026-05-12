/**
 * Tail Risk Scoring (Nassim Taleb-Style)
 *
 * Quantifies tail risk through skewness, kurtosis, max drawdown,
 * downside/upside ratio, and convexity scoring. Identifies asymmetric
 * risk profiles — both dangerous (fat left tail) and favorable
 * (convex: limited downside, unlimited upside).
 *
 * From AI Hedge Fund's Nassim Taleb Agent.
 */

// ============================================================================
// Types
// ============================================================================

export interface TailRiskProfile {
  /** Skewness: negative = fat left tail (dangerous), positive = fat right tail. */
  skewness: number;
  /** Excess kurtosis: >0 = fatter tails than normal distribution. */
  kurtosis: number;
  /** Maximum drawdown from peak (decimal, e.g., 0.35 = 35%). */
  maxDrawdown: number;
  /** Downside deviation / upside deviation. >1 = more downside risk. */
  downsideUpsideRatio: number;
  /** Value at Risk (5th percentile daily loss). */
  var5Pct: number;
  /** Conditional VaR (expected loss given VaR breach). */
  cvar5Pct: number;
  /** Composite tail risk score (0-100, higher = more dangerous). */
  tailRiskScore: number;
  /** Convexity score (-100 to +100). Positive = favorable asymmetry. */
  convexityScore: number;
  /** Classification. */
  classification: "antifragile" | "robust" | "fragile" | "highly_fragile";
  /** Human-readable assessment. */
  assessment: string;
}

// ============================================================================
// Statistical Functions
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
  const sum = arr.reduce((acc, v) => acc + ((v - m) / s) ** 3, 0);
  return (n / ((n - 1) * (n - 2))) * sum;
}

function kurtosis(arr: number[]): number {
  const n = arr.length;
  if (n < 4) return 0;
  const m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 0;
  const sum = arr.reduce((acc, v) => acc + ((v - m) / s) ** 4, 0);
  const rawKurt = ((n * (n + 1)) / ((n - 1) * (n - 2) * (n - 3))) * sum;
  const correction = (3 * (n - 1) ** 2) / ((n - 2) * (n - 3));
  return rawKurt - correction; // Excess kurtosis (normal = 0)
}

function maxDrawdown(prices: number[]): number {
  let peak = prices[0] ?? 0;
  let maxDD = 0;
  for (const price of prices) {
    if (price > peak) peak = price;
    const dd = (peak - price) / peak;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

function downsideDeviation(returns: number[]): number {
  const negativeReturns = returns.filter((r) => r < 0);
  if (negativeReturns.length === 0) return 0;
  return Math.sqrt(negativeReturns.reduce((s, r) => s + r * r, 0) / negativeReturns.length);
}

function upsideDeviation(returns: number[]): number {
  const positiveReturns = returns.filter((r) => r > 0);
  if (positiveReturns.length === 0) return 0;
  return Math.sqrt(positiveReturns.reduce((s, r) => s + r * r, 0) / positiveReturns.length);
}

function valueAtRisk(returns: number[], percentile: number = 0.05): number {
  const sorted = [...returns].sort((a, b) => a - b);
  const idx = Math.floor(sorted.length * percentile);
  return Math.abs(sorted[idx] ?? 0);
}

function conditionalVaR(returns: number[], percentile: number = 0.05): number {
  const sorted = [...returns].sort((a, b) => a - b);
  const cutoffIdx = Math.floor(sorted.length * percentile);
  const tail = sorted.slice(0, cutoffIdx + 1);
  if (tail.length === 0) return 0;
  return Math.abs(mean(tail));
}

// ============================================================================
// Tail Risk Analysis
// ============================================================================

/**
 * Compute a full tail risk profile from price and return data.
 *
 * @param prices Historical prices (oldest first).
 * @param returns Daily returns (decimal). If not provided, computed from prices.
 */
export function computeTailRisk(
  prices: number[],
  returns?: number[],
): TailRiskProfile {
  if (!returns) {
    returns = [];
    for (let i = 1; i < prices.length; i++) {
      if (prices[i - 1]! > 0) returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
    }
  }

  if (returns.length < 20) {
    return {
      skewness: 0, kurtosis: 0, maxDrawdown: 0, downsideUpsideRatio: 1,
      var5Pct: 0, cvar5Pct: 0, tailRiskScore: 50, convexityScore: 0,
      classification: "robust", assessment: "Insufficient data for tail risk analysis.",
    };
  }

  const skew = skewness(returns);
  const kurt = kurtosis(returns);
  const mdd = maxDrawdown(prices);
  const downDev = downsideDeviation(returns);
  const upDev = upsideDeviation(returns);
  const duRatio = upDev > 0 ? downDev / upDev : 2.0;
  const var5 = valueAtRisk(returns, 0.05);
  const cvar5 = conditionalVaR(returns, 0.05);

  // Tail risk score (0-100)
  let tailRiskScore = 50; // Baseline
  tailRiskScore += Math.max(-20, Math.min(20, -skew * 15)); // Negative skew = more risk
  tailRiskScore += Math.max(-15, Math.min(15, (kurt - 3) * 5)); // Fat tails = more risk
  tailRiskScore += Math.max(-15, Math.min(15, (mdd - 0.2) * 50)); // Drawdown
  tailRiskScore += Math.max(-10, Math.min(10, (duRatio - 1) * 10)); // Downside bias
  tailRiskScore = Math.max(0, Math.min(100, tailRiskScore));

  // Convexity score (-100 to +100)
  // Positive = favorable asymmetry (limited downside, unlimited upside)
  let convexityScore = 0;
  convexityScore += skew * 20; // Positive skew = good
  convexityScore += (1 - duRatio) * 30; // More upside than downside = good
  convexityScore += Math.max(-20, (0.2 - mdd) * 50); // Low drawdown = good
  convexityScore = Math.max(-100, Math.min(100, convexityScore));

  // Classification
  let classification: TailRiskProfile["classification"];
  if (convexityScore > 20 && tailRiskScore < 40) classification = "antifragile";
  else if (tailRiskScore < 55) classification = "robust";
  else if (tailRiskScore < 75) classification = "fragile";
  else classification = "highly_fragile";

  // Assessment
  const parts: string[] = [];
  if (skew < -0.5) parts.push("Negative skew (fat left tail — risk of sudden drops)");
  if (kurt > 3) parts.push(`Excess kurtosis ${kurt.toFixed(1)} (fatter tails than normal)`);
  if (mdd > 0.3) parts.push(`Max drawdown ${(mdd * 100).toFixed(0)}% (significant historical loss)`);
  if (duRatio > 1.3) parts.push("Downside dominates upside (asymmetric risk)");
  if (convexityScore > 20) parts.push("Favorable convexity (limited downside, room to run)");
  if (parts.length === 0) parts.push("Normal risk profile, no extreme tail characteristics.");

  return {
    skewness: skew,
    kurtosis: kurt,
    maxDrawdown: mdd,
    downsideUpsideRatio: duRatio,
    var5Pct: var5,
    cvar5Pct: cvar5,
    tailRiskScore,
    convexityScore,
    classification,
    assessment: parts.join(". ") + ".",
  };
}
