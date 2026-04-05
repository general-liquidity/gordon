/**
 * Feedback Loop
 * Learning from trade outcomes to improve future recommendations
 *
 * This module provides:
 * - Automatic outcome recording when trades close
 * - Performance context injection into agent prompts
 * - Confidence adjustment based on recent accuracy
 * - Learning patterns and insights generation
 */

import { createModuleLogger } from "../../logger/index.ts";
import { getTrade, listTrades } from "../../storage/trades.ts";
import { getPlan } from "../../storage/plans.ts";
import type { Trade, Plan } from "../../types/index.ts";
import {
  recordTradeOutcome,
  trackRecommendation,
  getRecommendationByPlanId,
  getRecentTradeSummary,
  getStrategyPerformance,
  getAgentPerformance,
  type TradeOutcome,
  type TradeRecommendation,
} from "./tradeEvaluator.ts";
import {
  getWinRateByStrategy,
  getRiskRewardAnalysis,
  getPerformanceByMarketCondition,
  generatePerformanceReport,
  formatPerformanceReport,
} from "./performanceMetrics.ts";

const logger = createModuleLogger("feedback-loop");

// ============================================================================
// Types
// ============================================================================

/**
 * Performance context for agent prompts
 */
export interface PerformanceContext {
  winRateLast20: number;
  totalRecentTrades: number;
  bestPerformingSetups: string[];
  cautiousSetups: string[];
  recentPatterns: string[];
  confidenceAdjustment: number;
  marketConditionInsight: string | null;
  riskRewardInsight: string | null;
}

/**
 * Learning insights from trade history
 */
export interface LearningInsights {
  topStrategies: Array<{ strategy: string; winRate: number; trades: number }>;
  weakStrategies: Array<{ strategy: string; winRate: number; trades: number }>;
  optimalConditions: string[];
  avoidConditions: string[];
  holdingPeriodInsight: string | null;
  rrInsight: string | null;
  overallTrend: "improving" | "declining" | "stable";
}

// ============================================================================
// Outcome Recording
// ============================================================================

/**
 * Record a trade outcome from a closed trade
 * This should be called when a trade closes (either manually or via automation)
 */
export function recordTradeClose(
  trade: Trade,
  marketCondition?: "trending" | "ranging" | "volatile" | "unknown"
): TradeOutcome | null {
  if (trade.status !== "CLOSED") {
    logger.warn("Cannot record outcome for non-closed trade", { tradeId: trade.id });
    return null;
  }

  // Get the associated plan
  const plan = getPlan(trade.planId);
  if (!plan) {
    logger.warn("Plan not found for trade", { tradeId: trade.id, planId: trade.planId });
    return null;
  }

  // Calculate metrics
  const entryPrice = trade.averageEntry;
  const exitPrice = trade.exits.length > 0
    ? trade.exits.reduce((sum, e) => sum + e.price * e.quantity, 0) / trade.exits.reduce((sum, e) => sum + e.quantity, 0)
    : trade.averageEntry;
  const firstTakeProfit = plan.takeProfit[0];
  const targetPrice = firstTakeProfit ? firstTakeProfit.price : entryPrice * 1.1;
  const stopLossPrice = plan.stopLoss.price;

  // Determine outcome
  let outcome: "win" | "loss" | "breakeven";
  if (trade.realizedPnlPercent > 0.5) {
    outcome = "win";
  } else if (trade.realizedPnlPercent < -0.5) {
    outcome = "loss";
  } else {
    outcome = "breakeven";
  }

  // Calculate risk-reward
  const plannedRisk = Math.abs(entryPrice - stopLossPrice);
  const plannedReward = Math.abs(targetPrice - entryPrice);
  const riskRewardPlanned = plannedRisk > 0 ? plannedReward / plannedRisk : 0;

  const actualProfit = exitPrice - entryPrice;
  const riskRewardActual = plannedRisk > 0 ? actualProfit / plannedRisk : 0;

  // Calculate holding period
  const openTime = new Date(trade.openedAt).getTime();
  const closeTime = trade.closedAt ? new Date(trade.closedAt).getTime() : Date.now();
  const holdingPeriodHours = (closeTime - openTime) / (1000 * 60 * 60);

  // Get recommendation if exists
  const recommendation = getRecommendationByPlanId(trade.planId);

  const outcomeRecord = recordTradeOutcome({
    tradeId: trade.id,
    planId: trade.planId,
    symbol: trade.symbol,
    strategy: plan.strategy,
    direction: plan.direction,
    entryPrice,
    targetPrice,
    stopLossPrice,
    exitPrice,
    outcome,
    profitLoss: trade.realizedPnl,
    profitLossPercent: trade.realizedPnlPercent,
    riskRewardActual,
    riskRewardPlanned,
    marketCondition: marketCondition || recommendation?.marketCondition || "unknown",
    timeframe: recommendation?.timeframe || "4h",
    holdingPeriodHours,
    recommendedByAgent: recommendation?.recommendedByAgent,
    confidenceAtEntry: recommendation?.confidenceAtEntry,
    entryTimestamp: trade.openedAt,
    exitTimestamp: trade.closedAt || new Date().toISOString(),
  });

  logger.info("Recorded trade outcome", {
    tradeId: trade.id,
    symbol: trade.symbol,
    outcome,
    profitLossPercent: trade.realizedPnlPercent,
  });

  return outcomeRecord;
}

/**
 * Track a new recommendation when a plan is created
 */
export function trackPlanRecommendation(
  plan: Plan,
  options?: {
    recommendedByAgent?: string;
    confidenceAtEntry?: number;
    marketCondition?: "trending" | "ranging" | "volatile" | "unknown";
    timeframe?: string;
  }
): TradeRecommendation {
  const entryPrice = plan.entry.price || 0;
  const firstTP = plan.takeProfit[0];
  const targetPrice = firstTP ? firstTP.price : entryPrice * 1.1;
  const stopLossPrice = plan.stopLoss.price;

  const plannedRisk = Math.abs(entryPrice - stopLossPrice);
  const plannedReward = Math.abs(targetPrice - entryPrice);
  const riskRewardPlanned = plannedRisk > 0 ? plannedReward / plannedRisk : 0;

  return trackRecommendation({
    planId: plan.id,
    symbol: plan.symbol,
    strategy: plan.strategy,
    direction: plan.direction,
    entryPrice,
    targetPrice,
    stopLossPrice,
    riskRewardPlanned,
    marketCondition: options?.marketCondition || "unknown",
    timeframe: options?.timeframe || "4h",
    recommendedByAgent: options?.recommendedByAgent,
    confidenceAtEntry: options?.confidenceAtEntry,
  });
}

/**
 * Process all closed trades that haven't been recorded yet
 * This can be run periodically to catch any missed recordings
 */
export function processUnrecordedTrades(): number {
  const closedTrades = listTrades({ status: "CLOSED" });
  let recorded = 0;

  for (const trade of closedTrades) {
    // Check if already recorded (by checking if recommendation was closed)
    const recommendation = getRecommendationByPlanId(trade.planId);
    if (recommendation && recommendation.status === "closed") {
      continue; // Already recorded
    }

    const result = recordTradeClose(trade);
    if (result) {
      recorded++;
    }
  }

  if (recorded > 0) {
    logger.info(`Processed ${recorded} previously unrecorded trades`);
  }

  return recorded;
}

// ============================================================================
// Performance Context Generation
// ============================================================================

/**
 * Generate performance context for agent prompt injection
 */
export function generatePerformanceContext(): PerformanceContext {
  const summary = getRecentTradeSummary(20);
  const rr = getRiskRewardAnalysis();
  const conditions = getPerformanceByMarketCondition();

  // Calculate confidence adjustment based on recent accuracy
  // If recent performance is strong, maintain confidence
  // If recent performance is weak, suggest more caution
  let confidenceAdjustment = 0;
  if (summary.totalTrades >= 5) {
    if (summary.winRate >= 0.6) {
      confidenceAdjustment = 0.05; // Slight boost
    } else if (summary.winRate < 0.4) {
      confidenceAdjustment = -0.1; // More caution
    }
  }

  // Generate market condition insight
  let marketConditionInsight: string | null = null;
  const goodConditions = conditions.filter((c) => c.totalTrades >= 3 && c.winRate >= 0.6);
  const badConditions = conditions.filter((c) => c.totalTrades >= 3 && c.winRate < 0.4);

  if (goodConditions.length > 0) {
    marketConditionInsight = `Performing well in ${goodConditions.map((c) => c.condition).join(", ")} markets`;
  }
  if (badConditions.length > 0) {
    const warning = `Underperforming in ${badConditions.map((c) => c.condition).join(", ")} markets`;
    marketConditionInsight = marketConditionInsight
      ? `${marketConditionInsight}. ${warning}`
      : warning;
  }

  // Generate R:R insight
  let riskRewardInsight: string | null = null;
  if (rr.rrEfficiency < 0.5 && summary.totalTrades >= 5) {
    riskRewardInsight = "Consider holding winners longer - actual R:R is below planned";
  } else if (rr.optimalRRRange) {
    riskRewardInsight = `Optimal R:R range: ${rr.optimalRRRange.min}:1 to ${rr.optimalRRRange.max}:1`;
  }

  return {
    winRateLast20: summary.winRate,
    totalRecentTrades: summary.totalTrades,
    bestPerformingSetups: summary.bestSetups,
    cautiousSetups: summary.cautiousSetups,
    recentPatterns: summary.recentPatterns,
    confidenceAdjustment,
    marketConditionInsight,
    riskRewardInsight,
  };
}

/**
 * Format performance context as a string for agent prompt injection
 */
export function formatPerformanceContextForPrompt(context: PerformanceContext): string {
  if (context.totalRecentTrades === 0) {
    return ""; // No data to inject
  }

  const lines: string[] = [];
  lines.push("");
  lines.push("## Recent Performance Context");
  lines.push(`- Win Rate (last ${context.totalRecentTrades} trades): ${Math.round(context.winRateLast20 * 100)}%`);

  if (context.bestPerformingSetups.length > 0) {
    lines.push(`- Best performing setups: ${context.bestPerformingSetups.join(", ")}`);
  }

  if (context.cautiousSetups.length > 0) {
    lines.push(`- Setups to be cautious with: ${context.cautiousSetups.join(", ")}`);
  }

  if (context.recentPatterns.length > 0) {
    lines.push(`- Recent patterns: ${context.recentPatterns.join("; ")}`);
  }

  if (context.marketConditionInsight) {
    lines.push(`- Market insight: ${context.marketConditionInsight}`);
  }

  if (context.riskRewardInsight) {
    lines.push(`- R:R insight: ${context.riskRewardInsight}`);
  }

  if (context.confidenceAdjustment !== 0) {
    const direction = context.confidenceAdjustment > 0 ? "Slightly more confident" : "Slightly more cautious";
    lines.push(`- Confidence adjustment: ${direction} based on recent results`);
  }

  lines.push("");

  return lines.join("\n");
}

// ============================================================================
// Learning Insights
// ============================================================================

/**
 * Generate learning insights from historical trade data
 */
export function generateLearningInsights(): LearningInsights {
  const strategyWinRates = getWinRateByStrategy();
  const conditions = getPerformanceByMarketCondition();
  const rr = getRiskRewardAnalysis();

  // Categorize strategies
  const strategies = Array.from(strategyWinRates.entries()).map(([strategy, data]) => ({
    strategy,
    winRate: data.winRate,
    trades: data.trades,
    trend: data.trend,
  }));

  const topStrategies = strategies
    .filter((s) => s.trades >= 3 && s.winRate >= 0.55)
    .sort((a, b) => b.winRate - a.winRate)
    .slice(0, 5);

  const weakStrategies = strategies
    .filter((s) => s.trades >= 3 && s.winRate < 0.45)
    .sort((a, b) => a.winRate - b.winRate)
    .slice(0, 5);

  // Optimal and avoid conditions
  const optimalConditions = conditions
    .filter((c) => c.totalTrades >= 3 && c.winRate >= 0.55)
    .map((c) => c.condition);

  const avoidConditions = conditions
    .filter((c) => c.totalTrades >= 3 && c.winRate < 0.4)
    .map((c) => c.condition);

  // Holding period insight
  let holdingPeriodInsight: string | null = null;
  // This would require more detailed analysis of holding periods
  // For now, we'll base it on the R:R efficiency
  if (rr.rrEfficiency < 0.5) {
    holdingPeriodInsight = "Consider adjusting exit timing - winners may be closing too early";
  } else if (rr.rrEfficiency > 1.2) {
    holdingPeriodInsight = "Excellent exit timing - exceeding planned targets";
  }

  // R:R insight
  let rrInsight: string | null = null;
  if (rr.optimalRRRange) {
    rrInsight = `Best results with ${rr.optimalRRRange.min}:1 to ${rr.optimalRRRange.max}:1 planned R:R`;
  }

  // Overall trend
  let overallTrend: "improving" | "declining" | "stable" = "stable";
  const improvingStrategies = strategies.filter((s) => s.trend === "improving").length;
  const decliningStrategies = strategies.filter((s) => s.trend === "declining").length;

  if (improvingStrategies > decliningStrategies + 1) {
    overallTrend = "improving";
  } else if (decliningStrategies > improvingStrategies + 1) {
    overallTrend = "declining";
  }

  return {
    topStrategies: topStrategies.map((s) => ({
      strategy: s.strategy,
      winRate: s.winRate,
      trades: s.trades,
    })),
    weakStrategies: weakStrategies.map((s) => ({
      strategy: s.strategy,
      winRate: s.winRate,
      trades: s.trades,
    })),
    optimalConditions,
    avoidConditions,
    holdingPeriodInsight,
    rrInsight,
    overallTrend,
  };
}

/**
 * Format learning insights for display
 */
export function formatLearningInsights(insights: LearningInsights): string {
  const lines: string[] = [];

  lines.push("=".repeat(50));
  lines.push("       LEARNING INSIGHTS");
  lines.push("=".repeat(50));
  lines.push(`Overall Trend: ${insights.overallTrend.toUpperCase()}`);
  lines.push("");

  if (insights.topStrategies.length > 0) {
    lines.push("TOP PERFORMING STRATEGIES");
    lines.push("-".repeat(50));
    for (const strat of insights.topStrategies) {
      lines.push(`  ${strat.strategy}: ${Math.round(strat.winRate * 100)}% win rate (${strat.trades} trades)`);
    }
    lines.push("");
  }

  if (insights.weakStrategies.length > 0) {
    lines.push("STRATEGIES NEEDING REVIEW");
    lines.push("-".repeat(50));
    for (const strat of insights.weakStrategies) {
      lines.push(`  ${strat.strategy}: ${Math.round(strat.winRate * 100)}% win rate (${strat.trades} trades)`);
    }
    lines.push("");
  }

  if (insights.optimalConditions.length > 0) {
    lines.push(`Optimal market conditions: ${insights.optimalConditions.join(", ")}`);
  }

  if (insights.avoidConditions.length > 0) {
    lines.push(`Challenging market conditions: ${insights.avoidConditions.join(", ")}`);
  }

  if (insights.holdingPeriodInsight) {
    lines.push(`Holding insight: ${insights.holdingPeriodInsight}`);
  }

  if (insights.rrInsight) {
    lines.push(`R:R insight: ${insights.rrInsight}`);
  }

  lines.push("");
  lines.push("=".repeat(50));

  return lines.join("\n");
}

// ============================================================================
// Confidence Adjustment
// ============================================================================

/**
 * Calculate confidence adjustment for a specific strategy
 * Returns a multiplier (e.g., 0.9 for 10% reduction, 1.1 for 10% boost)
 */
export function getStrategyConfidenceMultiplier(strategy: string): number {
  const performance = getStrategyPerformance(strategy);

  if (performance.totalTrades < 5) {
    return 1.0; // Not enough data
  }

  // Base adjustment on win rate deviation from 50%
  const winRateDeviation = performance.winRate - 0.5;

  // Also consider recent trend
  let trendBonus = 0;
  if (performance.recentTrend === "improving") {
    trendBonus = 0.05;
  } else if (performance.recentTrend === "declining") {
    trendBonus = -0.05;
  }

  // Calculate multiplier (range: 0.7 to 1.3)
  const adjustment = winRateDeviation * 0.5 + trendBonus;
  return Math.max(0.7, Math.min(1.3, 1.0 + adjustment));
}

/**
 * Calculate confidence adjustment for a specific agent
 */
export function getAgentConfidenceMultiplier(agentName: string): number {
  const performance = getAgentPerformance(agentName);

  if (performance.totalRecommendations < 5) {
    return 1.0; // Not enough data
  }

  // Base adjustment on win rate and confidence accuracy
  const winRateDeviation = performance.winRate - 0.5;
  const accuracyBonus = performance.confidenceAccuracy * 0.2;

  // Calculate multiplier (range: 0.7 to 1.3)
  const adjustment = winRateDeviation * 0.4 + accuracyBonus;
  return Math.max(0.7, Math.min(1.3, 1.0 + adjustment));
}

// ============================================================================
// Exports
// ============================================================================

export {
  getRecentTradeSummary,
  getStrategyPerformance,
  getAgentPerformance,
  generatePerformanceReport,
  formatPerformanceReport,
};
