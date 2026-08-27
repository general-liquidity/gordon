/**
 * Volatility-Percentile Position Sizing
 *
 * Sizes positions by where current volatility sits in the historical
 * distribution — not just absolute vol level. Auto-shrinks in high-vol
 * regimes, expands in low-vol regimes.
 *
 * From AI Hedge Fund: annualized vol → percentile rank → position limit.
 * Gordon adaptation: works with any asset class (crypto, stocks, DeFi).
 */

import { sampleStd } from "../../../core/stats/index.ts";

// ============================================================================
// Types
// ============================================================================

export interface VolatilityProfile {
  /** Current annualized volatility (decimal, e.g., 0.45 = 45%). */
  currentVol: number;
  /** Percentile rank of current vol in historical distribution (0-100). */
  percentileRank: number;
  /** Volatility regime classification. */
  regime: "low" | "moderate" | "high" | "extreme";
  /** Maximum portfolio allocation as fraction (0-1). */
  maxAllocationPct: number;
  /** Recommended position size as fraction of portfolio. */
  recommendedSizePct: number;
}

export interface PositionSizeResult {
  /** Recommended allocation as percentage of portfolio. */
  allocationPct: number;
  /** Maximum dollar amount to allocate. */
  maxNotionalUsd: number;
  /** Maximum quantity at current price. */
  maxQuantity: number;
  /** Volatility profile used for the calculation. */
  profile: VolatilityProfile;
}

// ============================================================================
// Core Computation
// ============================================================================

/**
 * Compute annualized volatility from daily returns.
 * @param dailyReturns Array of daily percentage returns (decimal).
 * @param tradingDaysPerYear 252 for stocks, 365 for crypto.
 */
export function computeAnnualizedVol(
  dailyReturns: number[],
  tradingDaysPerYear: number = 365,
): number {
  if (dailyReturns.length < 2) return 0;
  return sampleStd(dailyReturns) * Math.sqrt(tradingDaysPerYear);
}

/**
 * Compute daily returns from price series.
 */
export function pricesToReturns(prices: number[]): number[] {
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    if (prices[i - 1]! > 0) {
      returns.push((prices[i]! - prices[i - 1]!) / prices[i - 1]!);
    }
  }
  return returns;
}

/**
 * Compute percentile rank of a value in a distribution.
 */
export function percentileRank(value: number, distribution: number[]): number {
  if (distribution.length === 0) return 50;
  const below = distribution.filter((v) => v < value).length;
  return (below / distribution.length) * 100;
}

/**
 * Build a rolling volatility distribution for percentile ranking.
 * Uses 60-day windows rolled across the full price history.
 */
export function buildVolDistribution(
  prices: number[],
  windowSize: number = 60,
  tradingDaysPerYear: number = 365,
): number[] {
  const vols: number[] = [];
  for (let i = windowSize; i <= prices.length; i++) {
    const window = prices.slice(i - windowSize, i);
    const returns = pricesToReturns(window);
    const vol = computeAnnualizedVol(returns, tradingDaysPerYear);
    if (vol > 0) vols.push(vol);
  }
  return vols;
}

/**
 * Classify volatility regime and compute position limits.
 *
 * AI Hedge Fund thresholds (adapted for crypto + stocks):
 *   Low (<15%):       up to 25% allocation
 *   Moderate (15-40%): 10-20% allocation
 *   High (40-70%):     5-12% allocation
 *   Extreme (>70%):    2-8% allocation
 */
export function computeVolatilityProfile(
  currentVol: number,
  volDistribution: number[],
  baseAllocationPct: number = 10,
): VolatilityProfile {
  const pctRank = percentileRank(currentVol, volDistribution);

  let regime: VolatilityProfile["regime"];
  let maxAllocationPct: number;

  if (currentVol < 0.15) {
    regime = "low";
    maxAllocationPct = 25;
  } else if (currentVol < 0.4) {
    regime = "moderate";
    maxAllocationPct = 20 - (currentVol - 0.15) * 40; // Linear interpolation 20→10
  } else if (currentVol < 0.7) {
    regime = "high";
    maxAllocationPct = 12 - (currentVol - 0.4) * 23.3; // 12→5
  } else {
    regime = "extreme";
    maxAllocationPct = Math.max(2, 8 - (currentVol - 0.7) * 20); // 8→2
  }

  // Percentile adjustment: if vol is unusually high for this asset, shrink further
  const percentileMultiplier =
    pctRank > 90 ? 0.6 : pctRank > 75 ? 0.8 : pctRank > 50 ? 1.0 : pctRank > 25 ? 1.1 : 1.2; // Unusually low vol → can take slightly more

  const recommendedSizePct = Math.min(maxAllocationPct, baseAllocationPct * percentileMultiplier);

  return {
    currentVol,
    percentileRank: pctRank,
    regime,
    maxAllocationPct,
    recommendedSizePct,
  };
}

/**
 * Full position sizing calculation.
 *
 * @param prices Historical prices (oldest first, at least 60 data points).
 * @param currentPrice Current asset price.
 * @param portfolioValueUsd Total portfolio value.
 * @param baseAllocationPct Default allocation % (before vol adjustment).
 * @param isCrypto If true, uses 365 trading days; else 252.
 */
export function computePositionSize(
  prices: number[],
  currentPrice: number,
  portfolioValueUsd: number,
  baseAllocationPct: number = 10,
  isCrypto: boolean = true,
): PositionSizeResult {
  const tradingDays = isCrypto ? 365 : 252;
  const returns = pricesToReturns(prices);
  const currentVol = computeAnnualizedVol(returns.slice(-60), tradingDays);
  const volDistribution = buildVolDistribution(prices, 60, tradingDays);
  const profile = computeVolatilityProfile(currentVol, volDistribution, baseAllocationPct);

  const maxNotionalUsd = portfolioValueUsd * (profile.recommendedSizePct / 100);
  const maxQuantity = currentPrice > 0 ? maxNotionalUsd / currentPrice : 0;

  return {
    allocationPct: profile.recommendedSizePct,
    maxNotionalUsd,
    maxQuantity,
    profile,
  };
}
