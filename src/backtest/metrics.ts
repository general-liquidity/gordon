/**
 * Backtest Metrics Calculator
 *
 * Provides comprehensive performance metrics for backtesting results including
 * return metrics, risk metrics, and trade statistics.
 */

import type { EquityPoint, ClosedTrade, BacktestMetrics, DrawdownPeriod } from "./types.ts";
import {
  volatility as statsVolatility,
  sharpe as statsSharpe,
  sortino as statsSortino,
  maxDrawdown as statsMaxDrawdown,
  cagr as statsCagr,
  quantileSorted as statsQuantileSorted,
  profitFactor as statsProfitFactor,
  sampleCovariance as statsSampleCovariance,
  variance as statsVariance,
} from "../core/stats/index.ts";

// ============================================================================
// Constants
// ============================================================================

/** Default risk-free rate for Sharpe/Sortino calculations (2% annual) */
const DEFAULT_RISK_FREE_RATE = 0.02;

/**
 * Default periods-per-year for annualizing per-bar return statistics
 * (volatility, Sharpe, Sortino). 365 assumes 24/7 daily crypto bars.
 *
 * This is asset- AND bar-frequency-dependent — it must equal the number of
 * BARS per year for the series being scored. Override via the `periodsPerYear`
 * argument on the risk functions:
 *   - crypto daily (24/7):     365
 *   - equity/FX daily:         252
 *   - hourly crypto:           365 × 24 = 8760
 *   - 4h crypto:               365 × 6  = 2190
 * Annualizing on the wrong calendar (e.g. 365 for an FX daily series, or a
 * daily figure for intraday bars) distorts Sharpe — the headline judged metric.
 */
const TRADING_DAYS_PER_YEAR = 365;

// ============================================================================
// Return Metrics
// ============================================================================

/**
 * Calculate total return as a percentage.
 *
 * Formula: ((finalCapital - initialCapital) / initialCapital) * 100
 *
 * @param initialCapital - Starting portfolio value
 * @param finalCapital - Ending portfolio value
 * @returns Total return percentage (e.g., 25.5 for 25.5% return)
 */
export function calculateTotalReturn(
  initialCapital: number,
  finalCapital: number
): number {
  if (initialCapital <= 0) {
    return 0;
  }
  return ((finalCapital - initialCapital) / initialCapital) * 100;
}

/**
 * Calculate annualized return from total return and number of days.
 *
 * Formula: ((1 + totalReturn/100) ^ (365/days) - 1) * 100
 *
 * This converts a cumulative return over any period to an equivalent
 * annual return, assuming compound growth.
 *
 * @param totalReturn - Total return percentage
 * @param days - Number of days in the backtest period
 * @returns Annualized return percentage
 */
export function calculateAnnualizedReturn(
  totalReturn: number,
  days: number
): number {
  if (days <= 0) {
    return 0;
  }
  const totalReturnDecimal = totalReturn / 100;
  const yearsElapsed = days / TRADING_DAYS_PER_YEAR;

  if (yearsElapsed === 0) {
    return 0;
  }

  // Handle negative returns (can't use fractional exponent with negative base)
  if (totalReturnDecimal <= -1) {
    return -100; // Total loss
  }

  const annualized = Math.pow(1 + totalReturnDecimal, 1 / yearsElapsed) - 1;
  return annualized * 100;
}

/**
 * Calculate Compound Annual Growth Rate (CAGR).
 *
 * Formula: ((finalCapital / initialCapital) ^ (1/years) - 1) * 100
 *
 * CAGR represents the mean annual growth rate assuming profits are
 * reinvested at the end of each period.
 *
 * @param initialCapital - Starting portfolio value
 * @param finalCapital - Ending portfolio value
 * @param years - Number of years in the backtest period
 * @returns CAGR percentage
 */
export function calculateCAGR(
  initialCapital: number,
  finalCapital: number,
  years: number
): number {
  return statsCagr(initialCapital, finalCapital, years);
}

// ============================================================================
// Risk Metrics
// ============================================================================

/**
 * Calculate maximum drawdown from an equity curve.
 *
 * Maximum drawdown is the largest peak-to-trough decline in portfolio value,
 * expressed as a percentage. It measures the worst-case loss an investor
 * would have experienced.
 *
 * @param equityCurve - Array of equity points over time
 * @returns Maximum drawdown as a positive percentage (e.g., 15.5 for 15.5% drawdown)
 */
export function calculateMaxDrawdown(equityCurve: EquityPoint[]): number {
  return statsMaxDrawdown(equityCurve.map((p) => p.equity));
}

/**
 * Calculate volatility (annualized standard deviation of returns).
 *
 * Volatility measures the dispersion of returns and is a key input
 * for risk-adjusted metrics like the Sharpe ratio.
 *
 * @param returns - Array of periodic returns (as decimals, e.g., 0.05 for 5%)
 * @param periodsPerYear - Bars per year for this series (default 365, crypto-daily)
 * @returns Annualized volatility as a decimal (e.g., 0.15 for 15% volatility)
 */
export function calculateVolatility(
  returns: number[],
  periodsPerYear: number = TRADING_DAYS_PER_YEAR,
): number {
  return statsVolatility(returns, periodsPerYear);
}

/**
 * Calculate Sharpe Ratio.
 *
 * Formula: (Mean Return - Risk Free Rate) / Standard Deviation
 *
 * The Sharpe ratio measures risk-adjusted return. A higher Sharpe ratio
 * indicates better risk-adjusted performance. Generally:
 * - < 1: Sub-optimal
 * - 1-2: Good
 * - 2-3: Very good
 * - > 3: Excellent
 *
 * @param returns - Array of periodic returns (as decimals)
 * @param riskFreeRate - Annual risk-free rate (default: 0.02 for 2%)
 * @param periodsPerYear - Bars per year for this series (default 365, crypto-daily)
 * @returns Sharpe ratio (can be negative)
 */
export function calculateSharpeRatio(
  returns: number[],
  riskFreeRate: number = DEFAULT_RISK_FREE_RATE,
  periodsPerYear: number = TRADING_DAYS_PER_YEAR,
): number {
  return statsSharpe(returns, riskFreeRate, periodsPerYear);
}

/**
 * Calculate Sortino Ratio.
 *
 * Formula: (Mean Return - Risk Free Rate) / Downside Deviation
 *
 * The Sortino ratio is similar to the Sharpe ratio but only considers
 * downside volatility (negative returns). This is often more relevant
 * for traders who are more concerned with downside risk.
 *
 * @param returns - Array of periodic returns (as decimals)
 * @param riskFreeRate - Annual risk-free rate (default: 0.02 for 2%)
 * @param periodsPerYear - Bars per year for this series (default 365, crypto-daily)
 * @returns Sortino ratio (can be negative)
 */
export function calculateSortinoRatio(
  returns: number[],
  riskFreeRate: number = DEFAULT_RISK_FREE_RATE,
  periodsPerYear: number = TRADING_DAYS_PER_YEAR,
): number {
  return statsSortino(returns, riskFreeRate, periodsPerYear);
}

/**
 * Calculate Calmar Ratio.
 *
 * Formula: Annualized Return / Maximum Drawdown
 *
 * The Calmar ratio measures return relative to drawdown risk.
 * A higher ratio indicates better risk-adjusted performance.
 * Generally, a Calmar ratio above 1 is considered good.
 *
 * @param annualizedReturn - Annualized return as a percentage
 * @param maxDrawdown - Maximum drawdown as a positive percentage
 * @returns Calmar ratio
 */
export function calculateCalmarRatio(
  annualizedReturn: number,
  maxDrawdown: number
): number {
  if (maxDrawdown === 0) {
    return annualizedReturn > 0 ? Infinity : 0;
  }

  return annualizedReturn / maxDrawdown;
}

// ============================================================================
// Trade Metrics
// ============================================================================

/**
 * Calculate win rate (percentage of winning trades).
 *
 * @param trades - Array of closed trades
 * @returns Win rate as a percentage (e.g., 55 for 55% win rate)
 */
export function calculateWinRate(trades: ClosedTrade[]): number {
  if (trades.length === 0) {
    return 0;
  }

  const winningTrades = trades.filter((t) => t.pnl > 0).length;
  return (winningTrades / trades.length) * 100;
}

/**
 * Calculate profit factor (gross profit / gross loss).
 *
 * A profit factor > 1 indicates a profitable system.
 * Generally:
 * - < 1: Losing system
 * - 1-1.5: Marginal
 * - 1.5-2: Good
 * - > 2: Excellent
 *
 * @param trades - Array of closed trades
 * @returns Profit factor (0 if no losing trades)
 */
export function calculateProfitFactor(trades: ClosedTrade[]): number {
  return statsProfitFactor(trades.map((t) => t.pnl));
}

/**
 * Calculate average trade P&L.
 *
 * @param trades - Array of closed trades
 * @returns Average P&L per trade
 */
export function calculateAverageTrade(trades: ClosedTrade[]): number {
  if (trades.length === 0) {
    return 0;
  }

  const totalPnl = trades.reduce((sum, t) => sum + t.pnl, 0);
  return totalPnl / trades.length;
}

/**
 * Calculate average winning trade P&L.
 *
 * @param trades - Array of closed trades
 * @returns Average P&L of winning trades (0 if no winning trades)
 */
export function calculateAverageWin(trades: ClosedTrade[]): number {
  const winningTrades = trades.filter((t) => t.pnl > 0);

  if (winningTrades.length === 0) {
    return 0;
  }

  const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
  return totalWins / winningTrades.length;
}

/**
 * Calculate average losing trade P&L.
 *
 * @param trades - Array of closed trades
 * @returns Average P&L of losing trades as a positive number (0 if no losing trades)
 */
export function calculateAverageLoss(trades: ClosedTrade[]): number {
  const losingTrades = trades.filter((t) => t.pnl < 0);

  if (losingTrades.length === 0) {
    return 0;
  }

  const totalLosses = losingTrades.reduce((sum, t) => sum + t.pnl, 0);
  return Math.abs(totalLosses / losingTrades.length);
}

/**
 * Calculate expectancy (expected value per trade).
 *
 * Formula: (Win Rate * Average Win) - ((1 - Win Rate) * Average Loss)
 *
 * Expectancy represents the average amount you can expect to win (or lose)
 * per trade. A positive expectancy is required for a profitable system.
 *
 * @param winRate - Win rate as a decimal (e.g., 0.55 for 55%)
 * @param avgWin - Average winning trade value
 * @param avgLoss - Average losing trade value (as a positive number)
 * @returns Expected value per trade
 */
export function calculateExpectancy(
  winRate: number,
  avgWin: number,
  avgLoss: number
): number {
  return winRate * avgWin - (1 - winRate) * avgLoss;
}

/**
 * Calculate maximum consecutive wins.
 *
 * @param trades - Array of closed trades (should be sorted by exit time)
 * @returns Longest winning streak
 */
export function calculateMaxConsecutiveWins(trades: ClosedTrade[]): number {
  if (trades.length === 0) {
    return 0;
  }

  let maxStreak = 0;
  let currentStreak = 0;

  for (const trade of trades) {
    if (trade.pnl > 0) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak;
}

/**
 * Calculate maximum consecutive losses.
 *
 * @param trades - Array of closed trades (should be sorted by exit time)
 * @returns Longest losing streak
 */
export function calculateMaxConsecutiveLosses(trades: ClosedTrade[]): number {
  if (trades.length === 0) {
    return 0;
  }

  let maxStreak = 0;
  let currentStreak = 0;

  for (const trade of trades) {
    if (trade.pnl < 0) {
      currentStreak++;
      maxStreak = Math.max(maxStreak, currentStreak);
    } else {
      currentStreak = 0;
    }
  }

  return maxStreak;
}

// ============================================================================
// Extended Reporting Metrics
// ============================================================================

/** Minimum return observations required for a meaningful tail ratio. */
const MIN_TAIL_RATIO_OBS = 20;

/** Default rolling-window length (periods) for rolling Sharpe/beta. */
const DEFAULT_ROLLING_WINDOW = 63;

/**
 * Linear-interpolated percentile of a numeric array.
 *
 * @param sorted - array sorted ascending
 * @param p - percentile in [0, 1]
 * @returns interpolated value, or null when the array is empty
 */
function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  return statsQuantileSorted(sorted, p);
}

/**
 * Tail ratio = 95th-percentile return / |5th-percentile return|.
 *
 * A value > 1 means the upside tail is fatter than the downside tail.
 * Returns null when there are too few observations or the 5th percentile is
 * zero (undefined ratio) — never fabricates a value.
 *
 * @param returns - periodic returns (decimals)
 * @param minObs - minimum observations required (default 20)
 * @returns tail ratio, or null when insufficient/undefined
 */
export function calculateTailRatio(
  returns: number[],
  minObs: number = MIN_TAIL_RATIO_OBS,
): number | null {
  if (returns.length < minObs) return null;
  const sorted = [...returns].sort((a, b) => a - b);
  const p95 = percentile(sorted, 0.95);
  const p05 = percentile(sorted, 0.05);
  if (p95 === null || p05 === null) return null;
  const denom = Math.abs(p05);
  if (denom === 0) return null;
  return parseFloat((p95 / denom).toFixed(4));
}

/**
 * Rolling annualized Sharpe over a fixed window.
 *
 * For each window of `window` consecutive returns, computes
 * mean/std × √TRADING_DAYS_PER_YEAR. Length = returns.length - window + 1.
 * Returns an empty array when the series is shorter than the window.
 *
 * @param returns - periodic returns (decimals)
 * @param window - window length in periods (default 63)
 * @param periodsPerYear - Bars per year for this series (default 365, crypto-daily)
 * @returns array of rolling annualized Sharpe values
 */
export function calculateRollingSharpe(
  returns: number[],
  window: number = DEFAULT_ROLLING_WINDOW,
  periodsPerYear: number = TRADING_DAYS_PER_YEAR,
): number[] {
  if (window < 2 || returns.length < window) return [];
  const out: number[] = [];
  for (let end = window; end <= returns.length; end++) {
    const slice = returns.slice(end - window, end);
    const sharpe = calculateSharpeRatio(slice, DEFAULT_RISK_FREE_RATE, periodsPerYear);
    out.push(parseFloat((Number.isFinite(sharpe) ? sharpe : 0).toFixed(4)));
  }
  return out;
}

/**
 * Rolling beta of strategy returns against a benchmark return series.
 *
 * beta = cov(strategy, benchmark) / var(benchmark) over each window.
 * Returns null when no benchmark is provided. Returns an empty array when the
 * series is too short or the lengths don't align.
 *
 * @param returns - strategy periodic returns (decimals)
 * @param benchmark - benchmark periodic returns, same indexing as `returns`
 * @param window - window length in periods (default 63)
 * @returns array of rolling betas, or null when no benchmark
 */
export function calculateRollingBeta(
  returns: number[],
  benchmark: number[] | null | undefined,
  window: number = DEFAULT_ROLLING_WINDOW,
): number[] | null {
  if (!benchmark) return null;
  if (benchmark.length !== returns.length) return [];
  if (window < 2 || returns.length < window) return [];

  const out: number[] = [];
  for (let end = window; end <= returns.length; end++) {
    const r = returns.slice(end - window, end);
    const b = benchmark.slice(end - window, end);
    // beta = cov(r, b) / var(b). Both estimators share the n−1 factor, so it
    // cancels in the ratio — identical to the prior raw-sum implementation.
    const varB = statsVariance(b);
    const beta = varB === 0 ? 0 : statsSampleCovariance(r, b) / varB;
    out.push(parseFloat(beta.toFixed(4)));
  }
  return out;
}

/**
 * Extract the top-N discrete drawdown episodes from an equity curve.
 *
 * An episode runs from a peak, through the trough, to the point where equity
 * recovers to (or exceeds) the prior peak. An unrecovered final episode ends
 * at the last index. Episodes are ranked by depth (deepest first).
 *
 * @param equityCurve - array of equity points (chronological)
 * @param topN - maximum number of episodes to return (default 5)
 * @returns drawdown periods sorted deepest-first (empty when no drawdown)
 */
export function extractDrawdownPeriods(
  equityCurve: EquityPoint[],
  topN: number = 5,
): DrawdownPeriod[] {
  if (equityCurve.length < 2) return [];

  const episodes: DrawdownPeriod[] = [];
  const first = equityCurve[0];
  if (!first) return [];

  let peak = first.equity;
  let peakIdx = 0;
  let troughEquity = first.equity;
  let troughIdx = 0;
  let inDrawdown = false;

  for (let i = 1; i < equityCurve.length; i++) {
    const point = equityCurve[i];
    if (!point) continue;
    const eq = point.equity;

    if (eq >= peak) {
      // Recovery (or new peak). Close any open episode here.
      if (inDrawdown && peak > 0) {
        const depth = ((peak - troughEquity) / peak) * 100;
        episodes.push({
          startIdx: peakIdx,
          troughIdx,
          endIdx: i,
          depth: parseFloat(depth.toFixed(4)),
          lengthBars: i - peakIdx,
        });
        inDrawdown = false;
      }
      peak = eq;
      peakIdx = i;
      troughEquity = eq;
      troughIdx = i;
    } else {
      // Below peak — in a drawdown.
      inDrawdown = true;
      if (eq < troughEquity) {
        troughEquity = eq;
        troughIdx = i;
      }
    }
  }

  // Close an unrecovered final episode at the last index.
  if (inDrawdown && peak > 0) {
    const lastIdx = equityCurve.length - 1;
    const depth = ((peak - troughEquity) / peak) * 100;
    episodes.push({
      startIdx: peakIdx,
      troughIdx,
      endIdx: lastIdx,
      depth: parseFloat(depth.toFixed(4)),
      lengthBars: lastIdx - peakIdx,
    });
  }

  episodes.sort((a, b) => b.depth - a.depth);
  return episodes.slice(0, topN);
}

// ============================================================================
// Aggregate Function
// ============================================================================

/**
 * Calculate all backtest metrics in one call.
 *
 * This function computes all return, risk, and trade metrics and returns
 * them in a comprehensive BacktestMetrics object.
 *
 * @param initialCapital - Starting portfolio value
 * @param finalCapital - Ending portfolio value
 * @param equityCurve - Array of equity points over time
 * @param trades - Array of closed trades
 * @param days - Number of days in the backtest period
 * @param periodsPerYear - Bars per year for the equity curve (default 365,
 *   crypto-daily). Set to 252 for equity/FX daily, or bars-per-year for
 *   intraday, so Sharpe/Sortino/volatility annualize on the right calendar.
 * @returns Complete BacktestMetrics object
 */
export function calculateAllMetrics(
  initialCapital: number,
  finalCapital: number,
  equityCurve: EquityPoint[],
  trades: ClosedTrade[],
  days: number,
  periodsPerYear: number = TRADING_DAYS_PER_YEAR,
): BacktestMetrics {
  // Calculate return metrics
  const totalReturn = calculateTotalReturn(initialCapital, finalCapital);
  const annualizedReturn = calculateAnnualizedReturn(totalReturn, days);
  const years = days / TRADING_DAYS_PER_YEAR;
  const cagr = calculateCAGR(initialCapital, finalCapital, years);

  // Calculate risk metrics
  const maxDrawdown = calculateMaxDrawdown(equityCurve);

  // Calculate daily returns from equity curve for Sharpe/Sortino
  const dailyReturns = calculateDailyReturns(equityCurve);
  const volatility = calculateVolatility(dailyReturns, periodsPerYear);
  const sharpeRatio = calculateSharpeRatio(dailyReturns, DEFAULT_RISK_FREE_RATE, periodsPerYear);
  const sortinoRatio = calculateSortinoRatio(dailyReturns, DEFAULT_RISK_FREE_RATE, periodsPerYear);
  const calmarRatio = calculateCalmarRatio(annualizedReturn, maxDrawdown);

  // Calculate trade metrics
  const winningTrades = trades.filter((t) => t.pnl > 0);
  const losingTrades = trades.filter((t) => t.pnl < 0);
  const winRate = calculateWinRate(trades);
  const profitFactor = calculateProfitFactor(trades);
  const averageTrade = calculateAverageTrade(trades);
  const averageWin = calculateAverageWin(trades);
  const averageLoss = calculateAverageLoss(trades);

  // Expectancy uses win rate as decimal
  const expectancy = calculateExpectancy(winRate / 100, averageWin, averageLoss);
  const maxConsecutiveWins = calculateMaxConsecutiveWins(trades);
  const maxConsecutiveLosses = calculateMaxConsecutiveLosses(trades);

  // Calculate additional metrics
  const totalPnl = finalCapital - initialCapital;
  const totalFees = trades.reduce((sum, t) => sum + t.fees, 0);
  const netProfit = totalPnl - totalFees;
  const avgTradeDuration = calculateAverageTradeDuration(trades);
  const maxDrawdownDuration = calculateMaxDrawdownDuration(equityCurve);

  return {
    // Return Metrics
    totalReturn,
    annualizedReturn,
    cagr,

    // Risk Metrics
    maxDrawdown,
    sharpeRatio: Number.isFinite(sharpeRatio) ? sharpeRatio : 0,
    sortinoRatio: Number.isFinite(sortinoRatio) ? sortinoRatio : 0,
    volatility: volatility * 100, // Convert to percentage
    calmarRatio: Number.isFinite(calmarRatio) ? calmarRatio : 0,

    // Trade Metrics
    totalTrades: trades.length,
    winningTrades: winningTrades.length,
    losingTrades: losingTrades.length,
    winRate,
    profitFactor: Number.isFinite(profitFactor) ? profitFactor : 0,
    averageTrade,
    averageWin,
    averageLoss,
    expectancy,
    maxConsecutiveWins,
    maxConsecutiveLosses,

    // Additional Metrics
    initialValue: initialCapital,
    finalValue: finalCapital,
    totalPnl,
    netProfit,
    totalFees,
    avgTradeDuration,
    maxDrawdownDuration,
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate daily returns from an equity curve.
 *
 * @param equityCurve - Array of equity points
 * @returns Array of daily returns as decimals
 */
function calculateDailyReturns(equityCurve: EquityPoint[]): number[] {
  if (equityCurve.length < 2) {
    return [];
  }

  const returns: number[] = [];

  for (let i = 1; i < equityCurve.length; i++) {
    const prevPoint = equityCurve[i - 1];
    const currPoint = equityCurve[i];
    if (!prevPoint || !currPoint) continue;
    const prevEquity = prevPoint.equity;
    const currEquity = currPoint.equity;

    if (prevEquity > 0) {
      returns.push((currEquity - prevEquity) / prevEquity);
    }
  }

  return returns;
}

/**
 * Calculate average trade duration in hours.
 *
 * @param trades - Array of closed trades
 * @returns Average duration in hours
 */
function calculateAverageTradeDuration(trades: ClosedTrade[]): number {
  if (trades.length === 0) {
    return 0;
  }

  const totalDurationMs = trades.reduce((sum, t) => {
    return sum + (t.exitTime - t.entryTime);
  }, 0);

  const avgDurationMs = totalDurationMs / trades.length;
  const msPerHour = 1000 * 60 * 60;

  return avgDurationMs / msPerHour;
}

/**
 * Calculate maximum drawdown duration in days.
 *
 * This is the longest time spent in a drawdown (from peak to recovery).
 *
 * @param equityCurve - Array of equity points
 * @returns Maximum drawdown duration in days
 */
function calculateMaxDrawdownDuration(equityCurve: EquityPoint[]): number {
  if (equityCurve.length < 2) {
    return 0;
  }

  let maxDuration = 0;
  const firstPoint = equityCurve[0];
  if (!firstPoint) return 0;
  let peak = firstPoint.equity;
  let peakTimestamp = firstPoint.timestamp;

  for (const point of equityCurve) {
    if (point.equity >= peak) {
      // New peak reached, record duration if we were in a drawdown
      const duration = point.timestamp - peakTimestamp;
      if (duration > maxDuration && point.equity > peak) {
        // Only count if we recovered from a previous peak
      }
      peak = point.equity;
      peakTimestamp = point.timestamp;
    } else {
      // Still in drawdown, check current duration
      const currentDuration = point.timestamp - peakTimestamp;
      if (currentDuration > maxDuration) {
        maxDuration = currentDuration;
      }
    }
  }

  // Check if we ended in a drawdown
  const lastPoint = equityCurve[equityCurve.length - 1];
  if (lastPoint && lastPoint.equity < peak) {
    const finalDuration = lastPoint.timestamp - peakTimestamp;
    if (finalDuration > maxDuration) {
      maxDuration = finalDuration;
    }
  }

  // Convert milliseconds to days
  const msPerDay = 1000 * 60 * 60 * 24;
  return maxDuration / msPerDay;
}

// ============================================================================
// Engine-Compatible Metrics
// ============================================================================

import type { Trade, EquityPointExtended, BacktestParams } from "./types.ts";

/**
 * Calculate metrics from engine Trade format.
 * Adapts the Trade type used by the engine to the metrics functions.
 *
 * @param trades - Array of Trade objects from the engine
 * @param equityCurve - Equity curve with extended drawdown info
 * @param params - Backtest parameters
 * @returns Complete BacktestMetrics object
 */
export function calculateMetricsFromTrades(
  trades: Trade[],
  equityCurve: EquityPointExtended[],
  params: BacktestParams,
  periodsPerYear: number = TRADING_DAYS_PER_YEAR,
): BacktestMetrics {
  const initialCapital = params.initialCapital;
  const lastEquityPoint = equityCurve[equityCurve.length - 1];
  const firstEquityPoint = equityCurve[0];
  const finalCapital = lastEquityPoint?.equity ?? initialCapital;

  // Convert extended equity curve to basic format for existing functions
  const basicEquityCurve: EquityPoint[] = equityCurve.map(e => ({
    timestamp: e.timestamp,
    equity: e.equity,
  }));

  // Calculate days from equity curve
  const days = equityCurve.length > 1 && lastEquityPoint && firstEquityPoint
    ? (lastEquityPoint.timestamp - firstEquityPoint.timestamp) / (1000 * 60 * 60 * 24)
    : 1;

  // Convert engine Trade to ClosedTrade format
  const closedTrades: ClosedTrade[] = trades.map(t => ({
    id: t.id,
    symbol: "", // Not tracked by engine
    side: t.side.toLowerCase() as "long" | "short",
    entryPrice: t.entryPrice,
    exitPrice: t.exitPrice,
    quantity: t.quantity,
    entryTime: t.entryTime,
    exitTime: t.exitTime,
    pnl: t.netPnL,
    pnlPercent: t.returnPct,
    fees: t.commission,
  }));

  // Use existing calculateAllMetrics
  const baseMetrics = calculateAllMetrics(
    initialCapital,
    finalCapital,
    basicEquityCurve,
    closedTrades,
    days,
    periodsPerYear,
  );

  // Add engine-specific metrics
  const winningTrades = trades.filter(t => t.netPnL > 0);
  const losingTrades = trades.filter(t => t.netPnL < 0);

  // Extended reporting metrics — computed from the equity-curve return series
  // and the trade record. All null/empty when inputs are insufficient.
  const periodReturns = calculateDailyReturns(basicEquityCurve);
  const tailRatio = calculateTailRatio(periodReturns) ?? undefined;
  const rollingSharpe = calculateRollingSharpe(periodReturns, DEFAULT_ROLLING_WINDOW, periodsPerYear);
  // Engine has no benchmark series — beta is null unless a caller wires one in.
  const rollingBeta = calculateRollingBeta(periodReturns, null);
  const drawdownPeriods = extractDrawdownPeriods(basicEquityCurve);
  // Engine tracks positions only at trade boundaries, not per bar, so realized
  // turnover is derived from traded notional. Each round-trip trades entry +
  // exit notional ≈ 2 × entry value; normalize by initial capital, per trade.
  const realizedTurnover = trades.length > 0
    ? parseFloat(
        (
          trades.reduce(
            (sum, t) => sum + (Math.abs(t.entryPrice * t.quantity) * 2) / initialCapital,
            0,
          ) / trades.length
        ).toFixed(6),
      )
    : undefined;

  return {
    ...baseMetrics,
    tailRatio,
    realizedTurnover,
    rollingSharpe,
    rollingBeta,
    drawdownPeriods,
    // Override with more precise calculations from Trade type
    grossProfit: winningTrades.reduce((sum, t) => sum + t.grossPnL, 0),
    grossLoss: Math.abs(losingTrades.reduce((sum, t) => sum + t.grossPnL, 0)),
    largestWin: winningTrades.length > 0
      ? Math.max(...winningTrades.map(t => t.netPnL))
      : 0,
    largestLoss: losingTrades.length > 0
      ? Math.abs(Math.min(...losingTrades.map(t => t.netPnL)))
      : 0,
    avgHoldingPeriod: trades.length > 0
      ? trades.reduce((sum, t) => sum + t.holdingPeriod, 0) / trades.length
      : 0,
    avgWinHoldingPeriod: winningTrades.length > 0
      ? winningTrades.reduce((sum, t) => sum + t.holdingPeriod, 0) / winningTrades.length
      : 0,
    avgLossHoldingPeriod: losingTrades.length > 0
      ? losingTrades.reduce((sum, t) => sum + t.holdingPeriod, 0) / losingTrades.length
      : 0,
    totalCommission: trades.reduce((sum, t) => sum + t.commission, 0),
    commissionPct: (trades.reduce((sum, t) => sum + t.commission, 0) / initialCapital) * 100,
    // Ensure maxDrawdownDuration is in bars for engine compatibility
    maxDrawdownDuration: calculateMaxDrawdownDurationBars(equityCurve),
  };
}

/**
 * Calculate maximum drawdown duration in bars (for engine).
 */
function calculateMaxDrawdownDurationBars(equityCurve: EquityPointExtended[]): number {
  if (equityCurve.length < 2) {
    return 0;
  }

  let maxDuration = 0;
  let currentDuration = 0;
  const firstPoint = equityCurve[0];
  if (!firstPoint) return 0;
  let peak = firstPoint.equity;

  for (const point of equityCurve) {
    if (point.equity >= peak) {
      peak = point.equity;
      currentDuration = 0;
    } else {
      currentDuration++;
      maxDuration = Math.max(maxDuration, currentDuration);
    }
  }

  return maxDuration;
}
