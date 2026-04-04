/**
 * Performance Metrics
 * Advanced metrics tracking for trade performance analysis
 *
 * This module provides:
 * - Win rate tracking by strategy type
 * - Risk-reward (R:R) tracking and analysis
 * - Market condition correlation analysis
 * - Historical performance data storage
 * - Time-based performance trends
 */

import { z } from "zod";
import { getDatabase } from "../storage/database.ts";
import { createModuleLogger } from "../logger/index.ts";
import {
  getTradeOutcomes,
  getStrategyPerformance,
  type TradeOutcome,
  type StrategyPerformance,
} from "./tradeEvaluator.ts";

const logger = createModuleLogger("performance-metrics");

// ============================================================================
// Types
// ============================================================================

/**
 * Time period for analysis
 */
export type TimePeriod = "day" | "week" | "month" | "quarter" | "year" | "all";

/**
 * Market condition types
 */
export type MarketCondition = "trending" | "ranging" | "volatile" | "unknown";

/**
 * Performance by market condition
 */
export interface MarketConditionPerformance {
  condition: MarketCondition;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProfitPercent: number;
  avgLossPercent: number;
  bestStrategy: string | null;
  worstStrategy: string | null;
}

/**
 * Risk-Reward analysis
 */
export interface RiskRewardAnalysis {
  avgPlannedRR: number;
  avgActualRR: number;
  rrEfficiency: number; // Actual vs Planned (1.0 = perfect)
  rrByOutcome: {
    wins: { avgPlanned: number; avgActual: number };
    losses: { avgPlanned: number; avgActual: number };
  };
  optimalRRRange: { min: number; max: number } | null;
}

/**
 * Time-based performance
 */
export interface TimeBasedPerformance {
  period: TimePeriod;
  startDate: string;
  endDate: string;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnlPercent: number;
  bestDay: { date: string; pnlPercent: number } | null;
  worstDay: { date: string; pnlPercent: number } | null;
  streak: {
    currentWins: number;
    currentLosses: number;
    maxWins: number;
    maxLosses: number;
  };
}

/**
 * Symbol performance
 */
export interface SymbolPerformance {
  symbol: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgProfitPercent: number;
  avgLossPercent: number;
  profitFactor: number;
  bestStrategy: string | null;
  avgHoldingHours: number;
}

/**
 * Comprehensive performance report
 */
export interface PerformanceReport {
  generatedAt: string;
  period: TimePeriod;
  overview: {
    totalTrades: number;
    winRate: number;
    profitFactor: number;
    totalPnlPercent: number;
    avgTradePercent: number;
    avgWinPercent: number;
    avgLossPercent: number;
    avgHoldingHours: number;
  };
  riskReward: RiskRewardAnalysis;
  byStrategy: StrategyPerformance[];
  byMarketCondition: MarketConditionPerformance[];
  bySymbol: SymbolPerformance[];
  timeTrends: {
    daily: number[]; // Last 7 days PnL%
    weekly: number[]; // Last 4 weeks PnL%
    monthly: number[]; // Last 3 months PnL%
  };
  insights: string[];
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Get date range for a time period
 */
function getDateRangeForPeriod(period: TimePeriod): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date();

  switch (period) {
    case "day":
      start.setDate(start.getDate() - 1);
      break;
    case "week":
      start.setDate(start.getDate() - 7);
      break;
    case "month":
      start.setMonth(start.getMonth() - 1);
      break;
    case "quarter":
      start.setMonth(start.getMonth() - 3);
      break;
    case "year":
      start.setFullYear(start.getFullYear() - 1);
      break;
    case "all":
      start.setFullYear(2020); // Far enough back
      break;
  }

  return { start, end };
}

// ============================================================================
// Win Rate Analysis
// ============================================================================

/**
 * Calculate win rate by strategy
 */
export function getWinRateByStrategy(): Map<string, { winRate: number; trades: number; trend: string }> {
  const outcomes = getTradeOutcomes({});
  const strategyStats = new Map<string, { wins: number; total: number; recent: boolean[] }>();

  for (const outcome of outcomes) {
    const stats = strategyStats.get(outcome.strategy) || { wins: 0, total: 0, recent: [] };
    stats.total++;
    const isWin = outcome.outcome === "win";
    if (isWin) stats.wins++;
    stats.recent.unshift(isWin);
    if (stats.recent.length > 10) stats.recent.pop();
    strategyStats.set(outcome.strategy, stats);
  }

  const result = new Map<string, { winRate: number; trades: number; trend: string }>();

  for (const [strategy, stats] of strategyStats.entries()) {
    const winRate = stats.total > 0 ? stats.wins / stats.total : 0;

    // Calculate trend from recent trades
    let trend = "stable";
    if (stats.recent.length >= 5) {
      const recentWinRate = stats.recent.slice(0, 5).filter((w) => w).length / 5;
      const olderWinRate =
        stats.recent.length >= 10
          ? stats.recent.slice(5, 10).filter((w) => w).length / 5
          : winRate;

      if (recentWinRate > olderWinRate + 0.15) trend = "improving";
      else if (recentWinRate < olderWinRate - 0.15) trend = "declining";
    }

    result.set(strategy, { winRate, trades: stats.total, trend });
  }

  return result;
}

/**
 * Calculate win rate by timeframe
 */
export function getWinRateByTimeframe(): Map<string, { winRate: number; trades: number }> {
  const outcomes = getTradeOutcomes({});
  const timeframeStats = new Map<string, { wins: number; total: number }>();

  for (const outcome of outcomes) {
    const tf = outcome.timeframe || "unknown";
    const stats = timeframeStats.get(tf) || { wins: 0, total: 0 };
    stats.total++;
    if (outcome.outcome === "win") stats.wins++;
    timeframeStats.set(tf, stats);
  }

  const result = new Map<string, { winRate: number; trades: number }>();
  for (const [tf, stats] of timeframeStats.entries()) {
    result.set(tf, {
      winRate: stats.total > 0 ? stats.wins / stats.total : 0,
      trades: stats.total,
    });
  }

  return result;
}

// ============================================================================
// Risk-Reward Analysis
// ============================================================================

/**
 * Calculate comprehensive risk-reward analysis
 */
export function getRiskRewardAnalysis(): RiskRewardAnalysis {
  const outcomes = getTradeOutcomes({});

  if (outcomes.length === 0) {
    return {
      avgPlannedRR: 0,
      avgActualRR: 0,
      rrEfficiency: 0,
      rrByOutcome: {
        wins: { avgPlanned: 0, avgActual: 0 },
        losses: { avgPlanned: 0, avgActual: 0 },
      },
      optimalRRRange: null,
    };
  }

  const wins = outcomes.filter((o) => o.outcome === "win");
  const losses = outcomes.filter((o) => o.outcome === "loss");

  const avgPlannedRR =
    outcomes.reduce((sum, o) => sum + o.riskRewardPlanned, 0) / outcomes.length;
  const avgActualRR =
    outcomes.reduce((sum, o) => sum + o.riskRewardActual, 0) / outcomes.length;

  const rrEfficiency = avgPlannedRR > 0 ? avgActualRR / avgPlannedRR : 0;

  const rrByOutcome = {
    wins: {
      avgPlanned:
        wins.length > 0 ? wins.reduce((sum, o) => sum + o.riskRewardPlanned, 0) / wins.length : 0,
      avgActual:
        wins.length > 0 ? wins.reduce((sum, o) => sum + o.riskRewardActual, 0) / wins.length : 0,
    },
    losses: {
      avgPlanned:
        losses.length > 0
          ? losses.reduce((sum, o) => sum + o.riskRewardPlanned, 0) / losses.length
          : 0,
      avgActual:
        losses.length > 0
          ? losses.reduce((sum, o) => sum + o.riskRewardActual, 0) / losses.length
          : 0,
    },
  };

  // Find optimal R:R range (where win rate is highest)
  let optimalRRRange: { min: number; max: number } | null = null;
  if (outcomes.length >= 10) {
    const rrRanges = [
      { min: 1.0, max: 1.5 },
      { min: 1.5, max: 2.0 },
      { min: 2.0, max: 2.5 },
      { min: 2.5, max: 3.0 },
      { min: 3.0, max: 4.0 },
    ];

    let bestWinRate = 0;
    for (const range of rrRanges) {
      const inRange = outcomes.filter(
        (o) => o.riskRewardPlanned >= range.min && o.riskRewardPlanned < range.max
      );
      if (inRange.length >= 3) {
        const winRate = inRange.filter((o) => o.outcome === "win").length / inRange.length;
        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          optimalRRRange = range;
        }
      }
    }
  }

  return {
    avgPlannedRR,
    avgActualRR,
    rrEfficiency,
    rrByOutcome,
    optimalRRRange,
  };
}

// ============================================================================
// Market Condition Analysis
// ============================================================================

/**
 * Get performance by market condition
 */
export function getPerformanceByMarketCondition(): MarketConditionPerformance[] {
  const outcomes = getTradeOutcomes({});
  const conditionStats = new Map<
    MarketCondition,
    {
      wins: number;
      losses: number;
      totalProfit: number;
      totalLoss: number;
      strategies: Map<string, { wins: number; losses: number }>;
    }
  >();

  const conditions: MarketCondition[] = ["trending", "ranging", "volatile", "unknown"];

  // Initialize all conditions
  for (const condition of conditions) {
    conditionStats.set(condition, {
      wins: 0,
      losses: 0,
      totalProfit: 0,
      totalLoss: 0,
      strategies: new Map(),
    });
  }

  for (const outcome of outcomes) {
    const condition = (outcome.marketCondition || "unknown") as MarketCondition;
    const stats = conditionStats.get(condition)!;

    if (outcome.outcome === "win") {
      stats.wins++;
      stats.totalProfit += outcome.profitLossPercent;
    } else if (outcome.outcome === "loss") {
      stats.losses++;
      stats.totalLoss += Math.abs(outcome.profitLossPercent);
    }

    // Track by strategy within condition
    const stratStats = stats.strategies.get(outcome.strategy) || { wins: 0, losses: 0 };
    if (outcome.outcome === "win") stratStats.wins++;
    else if (outcome.outcome === "loss") stratStats.losses++;
    stats.strategies.set(outcome.strategy, stratStats);
  }

  return conditions.map((condition) => {
    const stats = conditionStats.get(condition)!;
    const total = stats.wins + stats.losses;

    // Find best and worst strategies for this condition
    let bestStrategy: string | null = null;
    let worstStrategy: string | null = null;
    let bestWinRate = 0;
    let worstWinRate = 1;

    for (const [strategy, stratStats] of stats.strategies.entries()) {
      const stratTotal = stratStats.wins + stratStats.losses;
      if (stratTotal >= 2) {
        const winRate = stratStats.wins / stratTotal;
        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          bestStrategy = strategy;
        }
        if (winRate < worstWinRate) {
          worstWinRate = winRate;
          worstStrategy = strategy;
        }
      }
    }

    return {
      condition,
      totalTrades: total,
      wins: stats.wins,
      losses: stats.losses,
      winRate: total > 0 ? stats.wins / total : 0,
      avgProfitPercent: stats.wins > 0 ? stats.totalProfit / stats.wins : 0,
      avgLossPercent: stats.losses > 0 ? stats.totalLoss / stats.losses : 0,
      bestStrategy,
      worstStrategy,
    };
  });
}

// ============================================================================
// Symbol Analysis
// ============================================================================

/**
 * Get performance by symbol
 */
export function getPerformanceBySymbol(): SymbolPerformance[] {
  const outcomes = getTradeOutcomes({});
  const symbolStats = new Map<
    string,
    {
      wins: number;
      losses: number;
      totalProfit: number;
      totalLoss: number;
      holdingHours: number;
      strategies: Map<string, { wins: number; losses: number }>;
    }
  >();

  for (const outcome of outcomes) {
    const stats = symbolStats.get(outcome.symbol) || {
      wins: 0,
      losses: 0,
      totalProfit: 0,
      totalLoss: 0,
      holdingHours: 0,
      strategies: new Map(),
    };

    if (outcome.outcome === "win") {
      stats.wins++;
      stats.totalProfit += outcome.profitLossPercent;
    } else if (outcome.outcome === "loss") {
      stats.losses++;
      stats.totalLoss += Math.abs(outcome.profitLossPercent);
    }
    stats.holdingHours += outcome.holdingPeriodHours;

    const stratStats = stats.strategies.get(outcome.strategy) || { wins: 0, losses: 0 };
    if (outcome.outcome === "win") stratStats.wins++;
    else if (outcome.outcome === "loss") stratStats.losses++;
    stats.strategies.set(outcome.strategy, stratStats);

    symbolStats.set(outcome.symbol, stats);
  }

  const result: SymbolPerformance[] = [];

  for (const [symbol, stats] of symbolStats.entries()) {
    const total = stats.wins + stats.losses;

    // Find best strategy for this symbol
    let bestStrategy: string | null = null;
    let bestWinRate = 0;
    for (const [strategy, stratStats] of stats.strategies.entries()) {
      const stratTotal = stratStats.wins + stratStats.losses;
      if (stratTotal >= 2) {
        const winRate = stratStats.wins / stratTotal;
        if (winRate > bestWinRate) {
          bestWinRate = winRate;
          bestStrategy = strategy;
        }
      }
    }

    result.push({
      symbol,
      totalTrades: total,
      wins: stats.wins,
      losses: stats.losses,
      winRate: total > 0 ? stats.wins / total : 0,
      avgProfitPercent: stats.wins > 0 ? stats.totalProfit / stats.wins : 0,
      avgLossPercent: stats.losses > 0 ? stats.totalLoss / stats.losses : 0,
      profitFactor:
        stats.totalLoss > 0
          ? stats.totalProfit / stats.totalLoss
          : stats.totalProfit > 0
          ? Infinity
          : 0,
      bestStrategy,
      avgHoldingHours: total > 0 ? stats.holdingHours / total : 0,
    });
  }

  return result.sort((a, b) => b.totalTrades - a.totalTrades);
}

// ============================================================================
// Time-Based Analysis
// ============================================================================

/**
 * Get performance for a specific time period
 */
export function getTimeBasedPerformance(period: TimePeriod): TimeBasedPerformance {
  const { start, end } = getDateRangeForPeriod(period);
  const outcomes = getTradeOutcomes({
    sinceDate: start.toISOString(),
  }).filter((o) => new Date(o.exitTimestamp) <= end);

  if (outcomes.length === 0) {
    return {
      period,
      startDate: start.toISOString(),
      endDate: end.toISOString(),
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      totalPnlPercent: 0,
      bestDay: null,
      worstDay: null,
      streak: { currentWins: 0, currentLosses: 0, maxWins: 0, maxLosses: 0 },
    };
  }

  const wins = outcomes.filter((o) => o.outcome === "win");
  const losses = outcomes.filter((o) => o.outcome === "loss");

  const totalProfit = wins.reduce((sum, o) => sum + o.profitLossPercent, 0);
  const totalLoss = Math.abs(losses.reduce((sum, o) => sum + o.profitLossPercent, 0));
  const totalPnlPercent = outcomes.reduce((sum, o) => sum + o.profitLossPercent, 0);

  // Group by day
  const dailyPnl = new Map<string, number>();
  for (const outcome of outcomes) {
    const exitTs = outcome.exitTimestamp;
    const day = exitTs ? exitTs.split("T")[0] : "unknown";
    if (day) {
      dailyPnl.set(day, (dailyPnl.get(day) || 0) + outcome.profitLossPercent);
    }
  }

  // Find best and worst days
  let bestDay: { date: string; pnlPercent: number } | null = null;
  let worstDay: { date: string; pnlPercent: number } | null = null;

  for (const [date, pnl] of dailyPnl.entries()) {
    if (!bestDay || pnl > bestDay.pnlPercent) {
      bestDay = { date, pnlPercent: pnl };
    }
    if (!worstDay || pnl < worstDay.pnlPercent) {
      worstDay = { date, pnlPercent: pnl };
    }
  }

  // Calculate streaks
  let currentWins = 0;
  let currentLosses = 0;
  let maxWins = 0;
  let maxLosses = 0;
  let tempWins = 0;
  let tempLosses = 0;

  // Sort by timestamp for streak calculation
  const sorted = [...outcomes].sort(
    (a, b) => new Date(a.exitTimestamp).getTime() - new Date(b.exitTimestamp).getTime()
  );

  for (const outcome of sorted) {
    if (outcome.outcome === "win") {
      tempWins++;
      tempLosses = 0;
      maxWins = Math.max(maxWins, tempWins);
    } else if (outcome.outcome === "loss") {
      tempLosses++;
      tempWins = 0;
      maxLosses = Math.max(maxLosses, tempLosses);
    }
  }

  // Current streak (from most recent trades)
  for (let i = sorted.length - 1; i >= 0; i--) {
    const sortedOutcome = sorted[i];
    if (!sortedOutcome) continue;
    if (sortedOutcome.outcome === "win") {
      if (currentLosses > 0) break;
      currentWins++;
    } else if (sortedOutcome.outcome === "loss") {
      if (currentWins > 0) break;
      currentLosses++;
    }
  }

  return {
    period,
    startDate: start.toISOString(),
    endDate: end.toISOString(),
    totalTrades: outcomes.length,
    winRate: outcomes.length > 0 ? wins.length / outcomes.length : 0,
    profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
    totalPnlPercent,
    bestDay,
    worstDay,
    streak: { currentWins, currentLosses, maxWins, maxLosses },
  };
}

// ============================================================================
// Comprehensive Report
// ============================================================================

/**
 * Generate a comprehensive performance report
 */
export function generatePerformanceReport(period: TimePeriod = "month"): PerformanceReport {
  const { start, end } = getDateRangeForPeriod(period);
  const outcomes = getTradeOutcomes({
    sinceDate: start.toISOString(),
  }).filter((o) => new Date(o.exitTimestamp) <= end);

  // Overview metrics
  const wins = outcomes.filter((o) => o.outcome === "win");
  const losses = outcomes.filter((o) => o.outcome === "loss");
  const totalProfit = wins.reduce((sum, o) => sum + o.profitLossPercent, 0);
  const totalLoss = Math.abs(losses.reduce((sum, o) => sum + o.profitLossPercent, 0));
  const totalPnlPercent = outcomes.reduce((sum, o) => sum + o.profitLossPercent, 0);
  const avgHoldingHours =
    outcomes.length > 0
      ? outcomes.reduce((sum, o) => sum + o.holdingPeriodHours, 0) / outcomes.length
      : 0;

  // Get all strategy performances (for the period)
  const strategySet = new Set(outcomes.map((o) => o.strategy));
  const byStrategy: StrategyPerformance[] = [];
  for (const strategy of strategySet) {
    const stratOutcomes = outcomes.filter((o) => o.strategy === strategy);
    const stratWins = stratOutcomes.filter((o) => o.outcome === "win");
    const stratLosses = stratOutcomes.filter((o) => o.outcome === "loss");
    const stratBreakeven = stratOutcomes.filter((o) => o.outcome === "breakeven");

    const stratTotalProfit = stratWins.reduce((sum, o) => sum + o.profitLossPercent, 0);
    const stratTotalLoss = Math.abs(stratLosses.reduce((sum, o) => sum + o.profitLossPercent, 0));

    const sorted = [...stratOutcomes].sort((a, b) => b.profitLossPercent - a.profitLossPercent);

    byStrategy.push({
      strategy,
      totalTrades: stratOutcomes.length,
      wins: stratWins.length,
      losses: stratLosses.length,
      breakeven: stratBreakeven.length,
      winRate: stratOutcomes.length > 0 ? stratWins.length / stratOutcomes.length : 0,
      avgProfitPercent: stratWins.length > 0 ? stratTotalProfit / stratWins.length : 0,
      avgLossPercent: stratLosses.length > 0 ? stratTotalLoss / stratLosses.length : 0,
      profitFactor:
        stratTotalLoss > 0 ? stratTotalProfit / stratTotalLoss : stratTotalProfit > 0 ? Infinity : 0,
      avgRiskRewardActual:
        stratOutcomes.length > 0
          ? stratOutcomes.reduce((sum, o) => sum + o.riskRewardActual, 0) / stratOutcomes.length
          : 0,
      avgRiskRewardPlanned:
        stratOutcomes.length > 0
          ? stratOutcomes.reduce((sum, o) => sum + o.riskRewardPlanned, 0) / stratOutcomes.length
          : 0,
      avgHoldingPeriodHours:
        stratOutcomes.length > 0
          ? stratOutcomes.reduce((sum, o) => sum + o.holdingPeriodHours, 0) / stratOutcomes.length
          : 0,
      bestTrade:
        sorted.length > 0 && sorted[0]
          ? { symbol: sorted[0].symbol, profitPercent: sorted[0].profitLossPercent }
          : null,
      worstTrade:
        sorted.length > 0 && sorted[sorted.length - 1]
          ? {
              symbol: sorted[sorted.length - 1]!.symbol,
              profitPercent: sorted[sorted.length - 1]!.profitLossPercent,
            }
          : null,
      recentTrend: "stable", // Simplified for report
    });
  }

  // Calculate time trends
  const now = new Date();
  const daily: number[] = [];
  const weekly: number[] = [];
  const monthly: number[] = [];

  // Last 7 days
  for (let i = 0; i < 7; i++) {
    const dayStart = new Date(now);
    dayStart.setDate(dayStart.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayEnd.getDate() + 1);

    const dayOutcomes = outcomes.filter((o) => {
      const exitDate = new Date(o.exitTimestamp);
      return exitDate >= dayStart && exitDate < dayEnd;
    });

    daily.push(dayOutcomes.reduce((sum, o) => sum + o.profitLossPercent, 0));
  }

  // Last 4 weeks
  for (let i = 0; i < 4; i++) {
    const weekStart = new Date(now);
    weekStart.setDate(weekStart.getDate() - i * 7 - 7);
    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 7);

    const weekOutcomes = outcomes.filter((o) => {
      const exitDate = new Date(o.exitTimestamp);
      return exitDate >= weekStart && exitDate < weekEnd;
    });

    weekly.push(weekOutcomes.reduce((sum, o) => sum + o.profitLossPercent, 0));
  }

  // Last 3 months
  for (let i = 0; i < 3; i++) {
    const monthStart = new Date(now);
    monthStart.setMonth(monthStart.getMonth() - i - 1);
    const monthEnd = new Date(monthStart);
    monthEnd.setMonth(monthEnd.getMonth() + 1);

    const monthOutcomes = outcomes.filter((o) => {
      const exitDate = new Date(o.exitTimestamp);
      return exitDate >= monthStart && exitDate < monthEnd;
    });

    monthly.push(monthOutcomes.reduce((sum, o) => sum + o.profitLossPercent, 0));
  }

  // Generate insights
  const insights: string[] = [];

  const overallWinRate = outcomes.length > 0 ? wins.length / outcomes.length : 0;
  if (overallWinRate >= 0.6) {
    insights.push(`Strong win rate of ${Math.round(overallWinRate * 100)}% over this period`);
  } else if (overallWinRate < 0.4 && outcomes.length >= 5) {
    insights.push(
      `Win rate of ${Math.round(overallWinRate * 100)}% is below target - consider reviewing strategy selection`
    );
  }

  const riskReward = getRiskRewardAnalysis();
  if (riskReward.rrEfficiency > 0.8) {
    insights.push("Excellent R:R execution - achieving planned targets consistently");
  } else if (riskReward.rrEfficiency < 0.5 && outcomes.length >= 5) {
    insights.push("R:R efficiency is low - consider holding winners longer or reviewing exit strategy");
  }

  if (riskReward.optimalRRRange) {
    insights.push(
      `Optimal R:R range is ${riskReward.optimalRRRange.min}:1 to ${riskReward.optimalRRRange.max}:1`
    );
  }

  // Best performing strategy insight
  const sortedStrategies = [...byStrategy]
    .filter((s) => s.totalTrades >= 3)
    .sort((a, b) => b.winRate - a.winRate);
  if (sortedStrategies.length > 0) {
    const best = sortedStrategies[0];
    if (best) {
      insights.push(
        `Best performing strategy: ${best.strategy} (${Math.round(best.winRate * 100)}% win rate)`
      );
    }
  }

  // Worst performing strategy insight
  if (sortedStrategies.length > 1) {
    const worst = sortedStrategies[sortedStrategies.length - 1];
    if (worst && worst.winRate < 0.4) {
      insights.push(
        `Consider avoiding: ${worst.strategy} (${Math.round(worst.winRate * 100)}% win rate)`
      );
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    period,
    overview: {
      totalTrades: outcomes.length,
      winRate: overallWinRate,
      profitFactor: totalLoss > 0 ? totalProfit / totalLoss : totalProfit > 0 ? Infinity : 0,
      totalPnlPercent,
      avgTradePercent: outcomes.length > 0 ? totalPnlPercent / outcomes.length : 0,
      avgWinPercent: wins.length > 0 ? totalProfit / wins.length : 0,
      avgLossPercent: losses.length > 0 ? totalLoss / losses.length : 0,
      avgHoldingHours,
    },
    riskReward,
    byStrategy: byStrategy.sort((a, b) => b.totalTrades - a.totalTrades),
    byMarketCondition: getPerformanceByMarketCondition(),
    bySymbol: getPerformanceBySymbol(),
    timeTrends: { daily, weekly, monthly },
    insights,
  };
}

/**
 * Format performance report for display
 */
export function formatPerformanceReport(report: PerformanceReport): string {
  const lines: string[] = [];

  lines.push("=".repeat(50));
  lines.push("       TRADE PERFORMANCE REPORT");
  lines.push("=".repeat(50));
  lines.push(`Period: ${report.period} | Generated: ${report.generatedAt.split("T")[0]}`);
  lines.push("");

  lines.push("OVERVIEW");
  lines.push("-".repeat(50));
  lines.push(`Total Trades: ${report.overview.totalTrades}`);
  lines.push(`Win Rate: ${(report.overview.winRate * 100).toFixed(1)}%`);
  lines.push(
    `Profit Factor: ${report.overview.profitFactor === Infinity ? "Inf" : report.overview.profitFactor.toFixed(2)}`
  );
  lines.push(`Total P&L: ${report.overview.totalPnlPercent.toFixed(2)}%`);
  lines.push(`Avg Win: +${report.overview.avgWinPercent.toFixed(2)}%`);
  lines.push(`Avg Loss: -${report.overview.avgLossPercent.toFixed(2)}%`);
  lines.push(`Avg Holding: ${report.overview.avgHoldingHours.toFixed(1)} hours`);
  lines.push("");

  lines.push("RISK/REWARD ANALYSIS");
  lines.push("-".repeat(50));
  lines.push(`Planned R:R: ${report.riskReward.avgPlannedRR.toFixed(2)}:1`);
  lines.push(`Actual R:R: ${report.riskReward.avgActualRR.toFixed(2)}:1`);
  lines.push(`R:R Efficiency: ${(report.riskReward.rrEfficiency * 100).toFixed(0)}%`);
  if (report.riskReward.optimalRRRange) {
    lines.push(
      `Optimal Range: ${report.riskReward.optimalRRRange.min}:1 - ${report.riskReward.optimalRRRange.max}:1`
    );
  }
  lines.push("");

  if (report.byStrategy.length > 0) {
    lines.push("TOP STRATEGIES");
    lines.push("-".repeat(50));
    const topStrategies = report.byStrategy.slice(0, 5);
    for (const strat of topStrategies) {
      lines.push(
        `${strat.strategy}: ${(strat.winRate * 100).toFixed(0)}% win (${strat.wins}W/${strat.losses}L)`
      );
    }
    lines.push("");
  }

  if (report.insights.length > 0) {
    lines.push("INSIGHTS");
    lines.push("-".repeat(50));
    for (const insight of report.insights) {
      lines.push(`- ${insight}`);
    }
  }

  lines.push("");
  lines.push("=".repeat(50));

  return lines.join("\n");
}
