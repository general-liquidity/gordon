/**
 * Eval Tools (Mastra Format)
 * Tools for recording trade outcomes and retrieving performance statistics
 *
 * These tools enable the feedback loop by allowing agents to:
 * - Record trade outcomes when positions close
 * - Query strategy performance metrics
 * - Get learning insights for better recommendations
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { getTrade } from "../../storage/trades.ts";
import { getPlan } from "../../storage/plans.ts";
import {
  recordTradeClose,
  trackPlanRecommendation,
  generatePerformanceContext,
  formatPerformanceContextForPrompt,
  generateLearningInsights,
  formatLearningInsights,
  getStrategyConfidenceMultiplier,
  getAgentConfidenceMultiplier,
  processUnrecordedTrades,
} from "./feedbackLoop.ts";
import {
  getStrategyPerformance,
  getAgentPerformance,
  getAllStrategyPerformances,
  getRecentTradeSummary,
} from "./tradeEvaluator.ts";
import {
  generatePerformanceReport,
  formatPerformanceReport,
  getWinRateByStrategy,
  getRiskRewardAnalysis,
  getPerformanceByMarketCondition,
  getPerformanceBySymbol,
  type TimePeriod,
} from "./performanceMetrics.ts";

// ============================================================================
// Record Trade Outcome Tool
// ============================================================================

export const recordTradeOutcomeTool = createTool({
  id: "record_trade_outcome",
  description:
    "Record the outcome of a closed trade for learning and performance tracking. " +
    "Use this when a trade closes to feed the learning system. " +
    "The system will calculate P/L, R:R achieved, and update strategy statistics.",
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the closed trade to record"),
    marketCondition: z
      .enum(["trending", "ranging", "volatile", "unknown"])
      .optional()
      .default("unknown")
      .describe("Market condition during the trade (helps correlate performance)"),
    notes: z.string().optional().describe("Optional notes about the trade"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    outcome: z
      .object({
        id: z.string(),
        symbol: z.string(),
        strategy: z.string(),
        outcome: z.enum(["win", "loss", "breakeven"]),
        profitLossPercent: z.number(),
        riskRewardActual: z.number(),
        holdingPeriodHours: z.number(),
      })
      .optional(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ tradeId, marketCondition }) => {
    const trade = getTrade(tradeId);
    if (!trade) {
      return {
        success: false,
        message: `Trade not found: ${tradeId}`,
        error: "Trade not found",
      };
    }

    if (trade.status !== "CLOSED") {
      return {
        success: false,
        message: `Trade ${tradeId} is not closed (status: ${trade.status})`,
        error: "Trade not closed",
      };
    }

    const outcome = recordTradeClose(trade, marketCondition);

    if (!outcome) {
      return {
        success: false,
        message: "Failed to record trade outcome",
        error: "Recording failed",
      };
    }

    return {
      success: true,
      outcome: {
        id: outcome.id,
        symbol: outcome.symbol,
        strategy: outcome.strategy,
        outcome: outcome.outcome,
        profitLossPercent: outcome.profitLossPercent,
        riskRewardActual: outcome.riskRewardActual,
        holdingPeriodHours: outcome.holdingPeriodHours,
      },
      message: `Recorded ${outcome.outcome} for ${outcome.symbol}: ${outcome.profitLossPercent.toFixed(2)}% P/L`,
    };
  },
});

// ============================================================================
// Get Strategy Performance Tool
// ============================================================================

export const getStrategyPerformanceTool = createTool({
  id: "get_strategy_performance",
  description:
    "Get performance statistics for a specific trading strategy. " +
    "Shows win rate, profit factor, average R:R, and recent trend. " +
    "Use this to evaluate which strategies are working best.",
  inputSchema: z.object({
    strategy: z
      .string()
      .describe("Strategy ID (e.g., 'support_bounce', 'bollinger_bounce')"),
  }),
  outputSchema: z.object({
    strategy: z.string(),
    totalTrades: z.number(),
    wins: z.number(),
    losses: z.number(),
    winRate: z.number(),
    winRatePercent: z.string(),
    profitFactor: z.number(),
    avgProfitPercent: z.number(),
    avgLossPercent: z.number(),
    avgRiskRewardActual: z.number(),
    avgRiskRewardPlanned: z.number(),
    recentTrend: z.string(),
    bestTrade: z.object({ symbol: z.string(), profitPercent: z.number() }).nullable(),
    worstTrade: z.object({ symbol: z.string(), profitPercent: z.number() }).nullable(),
    confidenceMultiplier: z.number(),
    recommendation: z.string(),
  }),
  execute: async ({ strategy }) => {
    const performance = getStrategyPerformance(strategy);
    const confidenceMultiplier = getStrategyConfidenceMultiplier(strategy);

    let recommendation = "Insufficient data for recommendation";
    if (performance.totalTrades >= 5) {
      if (performance.winRate >= 0.6 && performance.recentTrend !== "declining") {
        recommendation = "High confidence - continue using this strategy";
      } else if (performance.winRate >= 0.5) {
        recommendation = "Moderate confidence - use with appropriate sizing";
      } else if (performance.winRate < 0.4) {
        recommendation = "Low confidence - consider avoiding or reviewing criteria";
      } else {
        recommendation = "Average performance - monitor closely";
      }

      if (performance.recentTrend === "declining") {
        recommendation += ". Note: Recent trend is declining.";
      } else if (performance.recentTrend === "improving") {
        recommendation += ". Note: Recent trend is improving.";
      }
    }

    return {
      strategy: performance.strategy,
      totalTrades: performance.totalTrades,
      wins: performance.wins,
      losses: performance.losses,
      winRate: performance.winRate,
      winRatePercent: `${Math.round(performance.winRate * 100)}%`,
      profitFactor: performance.profitFactor === Infinity ? 999 : performance.profitFactor,
      avgProfitPercent: performance.avgProfitPercent,
      avgLossPercent: performance.avgLossPercent,
      avgRiskRewardActual: performance.avgRiskRewardActual,
      avgRiskRewardPlanned: performance.avgRiskRewardPlanned,
      recentTrend: performance.recentTrend,
      bestTrade: performance.bestTrade,
      worstTrade: performance.worstTrade,
      confidenceMultiplier,
      recommendation,
    };
  },
});

// ============================================================================
// Get All Strategy Performances Tool
// ============================================================================

export const getAllStrategyPerformancesTool = createTool({
  id: "get_all_strategy_performances",
  description:
    "Get performance statistics for all strategies that have recorded trades. " +
    "Use this to compare strategies and identify the best performers.",
  inputSchema: z.object({
    minTrades: z
      .number()
      .min(1)
      .default(3)
      .describe("Minimum trades required to include a strategy"),
    sortBy: z
      .enum(["winRate", "totalTrades", "profitFactor"])
      .default("winRate")
      .describe("Sort strategies by this metric"),
  }),
  outputSchema: z.object({
    strategies: z.array(
      z.object({
        strategy: z.string(),
        totalTrades: z.number(),
        winRate: z.string(),
        profitFactor: z.string(),
        recentTrend: z.string(),
      })
    ),
    summary: z.string(),
  }),
  execute: async ({ minTrades, sortBy }) => {
    let performances = getAllStrategyPerformances().filter((p) => p.totalTrades >= minTrades);

    // Sort
    switch (sortBy) {
      case "winRate":
        performances.sort((a, b) => b.winRate - a.winRate);
        break;
      case "totalTrades":
        performances.sort((a, b) => b.totalTrades - a.totalTrades);
        break;
      case "profitFactor":
        performances.sort((a, b) => {
          const pfA = a.profitFactor === Infinity ? 999 : a.profitFactor;
          const pfB = b.profitFactor === Infinity ? 999 : b.profitFactor;
          return pfB - pfA;
        });
        break;
    }

    const strategies = performances.slice(0, 10).map((p) => ({
      strategy: p.strategy,
      totalTrades: p.totalTrades,
      winRate: `${Math.round(p.winRate * 100)}%`,
      profitFactor: p.profitFactor === Infinity ? "Inf" : p.profitFactor.toFixed(2),
      recentTrend: p.recentTrend,
    }));

    const topPerformer = performances.length > 0 ? performances[0] : null;
    const summary = topPerformer
      ? `Top strategy: ${topPerformer.strategy} with ${Math.round(topPerformer.winRate * 100)}% win rate (${topPerformer.totalTrades} trades)`
      : "No strategies with enough trades to evaluate";

    return { strategies, summary };
  },
});

// ============================================================================
// Get Performance Context Tool
// ============================================================================

export const getPerformanceContextTool = createTool({
  id: "get_performance_context",
  description:
    "Get recent performance context for decision making. " +
    "Returns win rate, best/worst setups, patterns, and insights. " +
    "Use this before making recommendations to consider past performance.",
  inputSchema: z.object({
    format: z
      .enum(["json", "prompt"])
      .default("json")
      .describe("Output format: json for data, prompt for agent injection"),
  }),
  outputSchema: z.object({
    context: z.any().optional(),
    promptText: z.string().optional(),
    hasData: z.boolean(),
  }),
  execute: async ({ format }) => {
    const context = generatePerformanceContext();

    if (format === "prompt") {
      const promptText = formatPerformanceContextForPrompt(context);
      return {
        promptText,
        hasData: context.totalRecentTrades > 0,
      };
    }

    return {
      context,
      hasData: context.totalRecentTrades > 0,
    };
  },
});

// ============================================================================
// Get Learning Insights Tool
// ============================================================================

export const getLearningInsightsTool = createTool({
  id: "get_learning_insights",
  description:
    "Get learning insights derived from trade history. " +
    "Shows which strategies and conditions work best, and what to avoid. " +
    "Use this for strategic planning and to improve recommendations.",
  inputSchema: z.object({
    format: z
      .enum(["json", "text"])
      .default("text")
      .describe("Output format: json for data, text for formatted display"),
  }),
  outputSchema: z.object({
    insights: z.any().optional(),
    formattedText: z.string().optional(),
  }),
  execute: async ({ format }) => {
    const insights = generateLearningInsights();

    if (format === "text") {
      return {
        formattedText: formatLearningInsights(insights),
      };
    }

    return {
      insights,
    };
  },
});

// ============================================================================
// Get Performance Report Tool
// ============================================================================

export const getPerformanceReportTool = createTool({
  id: "get_performance_report",
  description:
    "Generate a comprehensive performance report for a time period. " +
    "Includes overview, risk/reward analysis, strategy breakdown, and insights. " +
    "Use when user asks for detailed performance analysis.",
  inputSchema: z.object({
    period: z
      .enum(["day", "week", "month", "quarter", "year", "all"])
      .default("month")
      .describe("Time period to analyze"),
    format: z
      .enum(["json", "text"])
      .default("text")
      .describe("Output format"),
  }),
  outputSchema: z.object({
    report: z.any().optional(),
    formattedText: z.string().optional(),
  }),
  execute: async ({ period, format }) => {
    const report = generatePerformanceReport(period as TimePeriod);

    if (format === "text") {
      return {
        formattedText: formatPerformanceReport(report),
      };
    }

    return {
      report,
    };
  },
});

// ============================================================================
// Track Recommendation Tool
// ============================================================================

export const trackRecommendationTool = createTool({
  id: "track_recommendation",
  description:
    "Track a new trade recommendation for later outcome analysis. " +
    "Call this when creating a plan to enable learning from the result. " +
    "Associates the recommendation with an agent and confidence level.",
  inputSchema: z.object({
    planId: z.string().describe("The plan ID to track"),
    recommendedByAgent: z
      .string()
      .optional()
      .describe("Agent that made the recommendation (e.g., 'Analyst', 'Scanner')"),
    confidenceAtEntry: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Confidence level when recommendation was made (0-1)"),
    marketCondition: z
      .enum(["trending", "ranging", "volatile", "unknown"])
      .optional()
      .describe("Current market condition"),
    timeframe: z.string().optional().describe("Timeframe used for analysis"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    recommendationId: z.string().optional(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ planId, recommendedByAgent, confidenceAtEntry, marketCondition, timeframe }) => {
    const plan = getPlan(planId);
    if (!plan) {
      return {
        success: false,
        message: `Plan not found: ${planId}`,
        error: "Plan not found",
      };
    }

    const recommendation = trackPlanRecommendation(plan, {
      recommendedByAgent,
      confidenceAtEntry,
      marketCondition,
      timeframe,
    });

    return {
      success: true,
      recommendationId: recommendation.id,
      message: `Tracking recommendation for ${plan.symbol} (${plan.strategy})`,
    };
  },
});

// ============================================================================
// Process Unrecorded Trades Tool
// ============================================================================

export const processUnrecordedTradesTool = createTool({
  id: "process_unrecorded_trades",
  description:
    "Process any closed trades that haven't been recorded for learning. " +
    "Run this periodically to catch any missed trade recordings.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    processed: z.number(),
    message: z.string(),
  }),
  execute: async () => {
    const processed = processUnrecordedTrades();

    return {
      processed,
      message:
        processed > 0
          ? `Processed ${processed} previously unrecorded trades`
          : "No unrecorded trades found",
    };
  },
});

// ============================================================================
// Get Win Rate Analysis Tool
// ============================================================================

export const getWinRateAnalysisTool = createTool({
  id: "get_win_rate_analysis",
  description:
    "Get detailed win rate analysis by strategy, including trends. " +
    "Shows which strategies are improving or declining.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    strategies: z.array(
      z.object({
        strategy: z.string(),
        winRate: z.string(),
        trades: z.number(),
        trend: z.string(),
      })
    ),
    summary: z.string(),
  }),
  execute: async () => {
    const winRates = getWinRateByStrategy();

    const strategies = Array.from(winRates.entries())
      .map(([strategy, data]) => ({
        strategy,
        winRate: `${Math.round(data.winRate * 100)}%`,
        trades: data.trades,
        trend: data.trend,
      }))
      .sort((a, b) => parseInt(b.winRate) - parseInt(a.winRate));

    const improving = strategies.filter((s) => s.trend === "improving").length;
    const declining = strategies.filter((s) => s.trend === "declining").length;

    const summary =
      strategies.length > 0
        ? `${strategies.length} strategies tracked. ${improving} improving, ${declining} declining.`
        : "No strategy data available";

    return { strategies, summary };
  },
});

// ============================================================================
// Get Risk Reward Analysis Tool
// ============================================================================

export const getRiskRewardAnalysisTool = createTool({
  id: "get_risk_reward_analysis",
  description:
    "Get analysis of risk/reward performance across all trades. " +
    "Shows planned vs actual R:R and identifies optimal R:R ranges.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    avgPlannedRR: z.number(),
    avgActualRR: z.number(),
    rrEfficiency: z.string(),
    optimalRRRange: z.string().nullable(),
    insight: z.string(),
  }),
  execute: async () => {
    const analysis = getRiskRewardAnalysis();

    let insight = "";
    if (analysis.rrEfficiency >= 0.8) {
      insight = "Excellent R:R execution - achieving planned targets";
    } else if (analysis.rrEfficiency >= 0.5) {
      insight = "Moderate R:R execution - some room for improvement";
    } else if (analysis.avgActualRR > 0) {
      insight = "Consider holding winners longer or reviewing exit strategy";
    } else {
      insight = "Insufficient data for R:R analysis";
    }

    return {
      avgPlannedRR: Number(analysis.avgPlannedRR.toFixed(2)),
      avgActualRR: Number(analysis.avgActualRR.toFixed(2)),
      rrEfficiency: `${Math.round(analysis.rrEfficiency * 100)}%`,
      optimalRRRange: analysis.optimalRRRange
        ? `${analysis.optimalRRRange.min}:1 to ${analysis.optimalRRRange.max}:1`
        : null,
      insight,
    };
  },
});

// ============================================================================
// Get Market Condition Performance Tool
// ============================================================================

export const getMarketConditionPerformanceTool = createTool({
  id: "get_market_condition_performance",
  description:
    "Get performance breakdown by market condition (trending, ranging, volatile). " +
    "Helps identify which conditions favor your trading style.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    conditions: z.array(
      z.object({
        condition: z.string(),
        totalTrades: z.number(),
        winRate: z.string(),
        bestStrategy: z.string().nullable(),
      })
    ),
    recommendation: z.string(),
  }),
  execute: async () => {
    const performances = getPerformanceByMarketCondition();

    const conditions = performances.map((p) => ({
      condition: p.condition,
      totalTrades: p.totalTrades,
      winRate: `${Math.round(p.winRate * 100)}%`,
      bestStrategy: p.bestStrategy,
    }));

    const best = performances.filter((p) => p.totalTrades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
    const worst = performances.filter((p) => p.totalTrades >= 3).sort((a, b) => a.winRate - b.winRate)[0];

    let recommendation = "Insufficient data for market condition analysis";
    if (best && worst && best.winRate > worst.winRate + 0.15) {
      recommendation = `Focus on ${best.condition} markets (${Math.round(best.winRate * 100)}% win rate). Be cautious in ${worst.condition} markets (${Math.round(worst.winRate * 100)}% win rate).`;
    } else if (best) {
      recommendation = `Best performance in ${best.condition} markets`;
    }

    return { conditions, recommendation };
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Eval tools exported as an object for Mastra Agent
 */
export const evalTools = {
  record_trade_outcome: recordTradeOutcomeTool,
  get_strategy_performance: getStrategyPerformanceTool,
  get_all_strategy_performances: getAllStrategyPerformancesTool,
  get_performance_context: getPerformanceContextTool,
  get_learning_insights: getLearningInsightsTool,
  get_performance_report: getPerformanceReportTool,
  track_recommendation: trackRecommendationTool,
  process_unrecorded_trades: processUnrecordedTradesTool,
  get_win_rate_analysis: getWinRateAnalysisTool,
  get_risk_reward_analysis: getRiskRewardAnalysisTool,
  get_market_condition_performance: getMarketConditionPerformanceTool,
};
