/**
 * Metrics Tools (Mastra Format)
 * Tools for retrieving performance metrics and statistics
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  getAllMetrics,
  calculateTradeMetrics,
  calculateRiskMetrics,
  formatMetricsReport,
} from "../../../platform/observability/index.ts";

// ============================================================================
// Performance Metrics Tool
// ============================================================================

export const getPerformanceMetricsTool = createTool({
  id: "get_performance_metrics",
  description:
    "Get comprehensive trading performance metrics including win rate, profit factor, " +
    "Sharpe ratio, drawdown, and more. Use when user asks about their performance, " +
    "statistics, or wants to see how well they're doing.",
  inputSchema: z.object({
    format: z
      .enum(["summary", "detailed", "json"])
      .default("summary")
      .describe("Output format: summary (human readable), detailed (full report), or json (raw data)"),
  }),
  outputSchema: z.object({
    report: z.string().optional(),
    metrics: z.any().optional(),
    summary: z.string().optional(),
  }),
  execute: async ({ format }) => {
    const metrics = getAllMetrics();

    if (format === "json") {
      return { metrics };
    }

    if (format === "detailed") {
      return { report: formatMetricsReport() };
    }

    // Summary format
    const trade = metrics.trade;
    const risk = metrics.risk;

    const summaryLines = [
      `📊 **Performance Summary**`,
      ``,
      `**Trades:** ${trade.totalTrades} total (${trade.openTrades} open)`,
      `**Win Rate:** ${(trade.winRate * 100).toFixed(1)}% (${trade.winningTrades}W / ${trade.losingTrades}L)`,
      `**Total P&L:** $${trade.totalPnl.toFixed(2)} (${trade.totalPnlPercent.toFixed(1)}%)`,
      `**Profit Factor:** ${trade.profitFactor === Infinity ? "∞" : trade.profitFactor.toFixed(2)}`,
      ``,
      `**Risk Metrics:**`,
      `- Sharpe Ratio: ${risk.sharpeRatio?.toFixed(2) ?? "N/A"}`,
      `- Max Drawdown: ${(risk.maxDrawdown * 100).toFixed(1)}%`,
      `- Current Drawdown: ${(risk.currentDrawdown * 100).toFixed(1)}%`,
    ];

    return { summary: summaryLines.join("\n") };
  },
});

// ============================================================================
// Trade Statistics Tool
// ============================================================================

export const getTradeStatisticsTool = createTool({
  id: "get_trade_statistics",
  description:
    "Get detailed trade statistics including average win/loss, holding periods, " +
    "consecutive streaks, and more. Use when user wants detailed breakdown of their trades.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    statistics: z.object({
      totalTrades: z.number(),
      openTrades: z.number(),
      closedTrades: z.number(),
      winningTrades: z.number(),
      losingTrades: z.number(),
      winRate: z.number(),
      avgWin: z.number(),
      avgLoss: z.number(),
      profitFactor: z.number(),
      totalPnl: z.number(),
      largestWin: z.number(),
      largestLoss: z.number(),
      consecutiveWins: z.number(),
      consecutiveLosses: z.number(),
      avgHoldingPeriodHours: z.number(),
    }),
  }),
  execute: async () => {
    const metrics = calculateTradeMetrics();

    return {
      statistics: {
        totalTrades: metrics.totalTrades,
        openTrades: metrics.openTrades,
        closedTrades: metrics.closedTrades,
        winningTrades: metrics.winningTrades,
        losingTrades: metrics.losingTrades,
        winRate: metrics.winRate,
        avgWin: metrics.avgWin,
        avgLoss: metrics.avgLoss,
        profitFactor: metrics.profitFactor,
        totalPnl: metrics.totalPnl,
        largestWin: metrics.largestWin,
        largestLoss: metrics.largestLoss,
        consecutiveWins: metrics.consecutiveWins,
        consecutiveLosses: metrics.consecutiveLosses,
        avgHoldingPeriodHours: metrics.avgHoldingPeriod,
      },
    };
  },
});

// ============================================================================
// Risk Analysis Tool
// ============================================================================

export const getRiskAnalysisTool = createTool({
  id: "get_risk_analysis",
  description:
    "Get risk-adjusted performance metrics including Sharpe ratio, Sortino ratio, " +
    "volatility, and drawdown analysis. Use when user asks about risk or wants to " +
    "understand their risk-adjusted returns.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    riskMetrics: z.object({
      sharpeRatio: z.number().nullable(),
      sortinoRatio: z.number().nullable(),
      maxDrawdown: z.number(),
      currentDrawdown: z.number(),
      volatility: z.number().nullable(),
    }),
    interpretation: z.string(),
  }),
  execute: async () => {
    const metrics = calculateRiskMetrics();

    // Generate interpretation
    const interpretations: string[] = [];

    if (metrics.sharpeRatio !== null) {
      if (metrics.sharpeRatio > 2) {
        interpretations.push("Excellent risk-adjusted returns (Sharpe > 2)");
      } else if (metrics.sharpeRatio > 1) {
        interpretations.push("Good risk-adjusted returns (Sharpe > 1)");
      } else if (metrics.sharpeRatio > 0) {
        interpretations.push("Positive but modest risk-adjusted returns");
      } else {
        interpretations.push("Negative risk-adjusted returns - review strategy");
      }
    }

    if (metrics.maxDrawdown > 0.2) {
      interpretations.push("High max drawdown (>20%) - consider tighter risk controls");
    } else if (metrics.maxDrawdown > 0.1) {
      interpretations.push("Moderate max drawdown (10-20%)");
    } else {
      interpretations.push("Low max drawdown (<10%) - good risk management");
    }

    return {
      riskMetrics: {
        sharpeRatio: metrics.sharpeRatio,
        sortinoRatio: metrics.sortinoRatio,
        maxDrawdown: metrics.maxDrawdown,
        currentDrawdown: metrics.currentDrawdown,
        volatility: metrics.volatility,
      },
      interpretation: interpretations.join(". "),
    };
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

export const metricsTools = {
  get_performance_metrics: getPerformanceMetricsTool,
  get_trade_statistics: getTradeStatisticsTool,
  get_risk_analysis: getRiskAnalysisTool,
};
