/**
 * Backtest Tools (Mastra Format)
 *
 * Tools for backtesting trading strategies including:
 * - Running backtests on historical data
 * - Optimizing strategy parameters via grid search
 * - Comparing multiple strategies
 * - Formatting backtest results for display
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { strategyRegistry, type StrategyId } from "../../../strategies/index.ts";
import type { Strategy } from "../../../strategies/types.ts";
import { DEFAULT_BACKTEST_CONFIG } from "../../../backtest/types.ts";
import type {
  BacktestConfig,
  BacktestMetrics,
  BacktestResult,
  BacktestTrade,
} from "../../../backtest/types.ts";
import { runBacktest } from "../../../backtest/engine.ts";
import { formatBacktestSummary } from "../../../backtest/reporting/formatter.ts";
import { fetchHistoricalData, fetchHistoricalDataRange } from "../../../backtest/data/historical.ts";
import {
  analyzeBacktestResult,
  compareBacktestResults,
  findBestStrategy,
  rankStrategiesByMetric,
} from "../../../backtest/analysis.ts";
import {
  exportResultsJson,
  exportResultsCsv,
  generateHtmlReport,
} from "../../../backtest/reporting/export.ts";
import { filterExcludeMonths, filterMarketHours, filterFirstLastHour } from "../../../backtest/filters.ts";
import { analyzeAlphaDecay } from "../../../backtest/alpha-decay.ts";
import { generateBacktestChart } from "../../../backtest/plotting.ts";
import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "./types.ts";

// ============================================================================
// Helper Functions
// ============================================================================

// Helper functions are defined below in this file.

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noBinance: { error: "Binance client not connected. Please run setup first." },
  strategyNotFound: (id: string) => ({
    error: `Strategy "${id}" not found. Use list_strategies to see available strategies.`,
  }),
  insufficientData: (symbol: string) => ({
    error: `Insufficient historical data for ${symbol}. Try a shorter backtest period or different timeframe.`,
  }),
};

function mapExitReason(reason: string): BacktestTrade["exitReason"] {
  const upper = reason.toUpperCase();
  if (upper.includes("STOP")) return "STOP";
  if (upper.includes("TAKE_PROFIT") || upper.includes("TP")) return "TP1";
  if (upper.includes("END")) return "END_OF_TEST";
  return "SIGNAL";
}

function buildBacktestConfig(
  strategyId: string,
  symbol: string,
  timeframe: string,
  days: number,
  initialCapital: number,
  commissionRate: number
): BacktestConfig {
  return {
    strategyId,
    symbol,
    timeframe,
    days,
    initialCapital,
    positionSizePercent: (DEFAULT_BACKTEST_CONFIG.positionSizePercent ?? 10),
    compounding: DEFAULT_BACKTEST_CONFIG.compounding ?? false,
    feePercent: commissionRate * 100,
    slippagePercent: DEFAULT_BACKTEST_CONFIG.slippagePercent ?? 0.05,
  };
}

function buildBacktestResult(
  strategy: Strategy,
  config: BacktestConfig,
  engineResult: ReturnType<typeof runBacktest>,
  executionTime: number
): BacktestResult {
  const trades: BacktestTrade[] = engineResult.trades.map((trade) => ({
    id: trade.id,
    entryTime: new Date(trade.entryTime).toISOString(),
    exitTime: new Date(trade.exitTime).toISOString(),
    entryPrice: trade.entryPrice,
    exitPrice: trade.exitPrice,
    quantity: trade.quantity,
    positionValue: trade.entryPrice * trade.quantity,
    side: trade.side,
    pnl: trade.netPnL,
    pnlPercent: trade.returnPct,
    fees: trade.commission,
    exitReason: mapExitReason(trade.exitReason),
  }));

  return {
    id: `bt_${Date.now()}`,
    strategyName: strategy.name,
    config,
    metrics: engineResult.metrics,
    trades,
    equityCurve: engineResult.equityCurve.map((point) => ({
      timestamp: point.timestamp,
      equity: point.equity,
    })),
    drawdownCurve: engineResult.equityCurve.map((point) => ({
      timestamp: point.timestamp,
      drawdown: point.drawdownPct,
    })),
    startDate: new Date(engineResult.startDate).toISOString(),
    endDate: new Date(engineResult.endDate).toISOString(),
    executionTime,
    createdAt: new Date().toISOString(),
    warnings: [],
  };
}

// ============================================================================
// Backtest Result Schema
// ============================================================================

const backtestMetricsSchema = z.object({
  totalReturn: z.number(),
  annualizedReturn: z.number(),
  cagr: z.number(),
  maxDrawdown: z.number(),
  sharpeRatio: z.number(),
  sortinoRatio: z.number(),
  volatility: z.number(),
  calmarRatio: z.number(),
  totalTrades: z.number(),
  winningTrades: z.number(),
  losingTrades: z.number(),
  winRate: z.number(),
  profitFactor: z.number(),
  averageTrade: z.number(),
  averageWin: z.number(),
  averageLoss: z.number(),
  expectancy: z.number(),
  maxConsecutiveWins: z.number(),
  maxConsecutiveLosses: z.number(),
  initialValue: z.number(),
  finalValue: z.number(),
  totalPnl: z.number(),
  netProfit: z.number(),
  totalFees: z.number(),
  avgTradeDuration: z.number(),
  maxDrawdownDuration: z.number(),
});

const backtestTradeSchema = z.object({
  id: z.string(),
  entryTime: z.string(),
  exitTime: z.string(),
  entryPrice: z.number(),
  exitPrice: z.number(),
  quantity: z.number(),
  positionValue: z.number(),
  side: z.enum(["LONG", "SHORT"]),
  pnl: z.number(),
  pnlPercent: z.number(),
  fees: z.number(),
  exitReason: z.enum(["TP1", "TP2", "TP3", "STOP", "SIGNAL", "END_OF_TEST"]),
  entrySignals: z.record(z.string(), z.unknown()).optional(),
});

const backtestConfigSchema = z.object({
  strategyId: z.string(),
  symbol: z.string(),
  timeframe: z.string(),
  days: z.number(),
  initialCapital: z.number(),
  positionSizePercent: z.number(),
  compounding: z.boolean(),
  feePercent: z.number(),
  slippagePercent: z.number(),
});

const backtestResultSchema = z.object({
  id: z.string(),
  strategyName: z.string(),
  config: backtestConfigSchema,
  metrics: backtestMetricsSchema,
  trades: z.array(backtestTradeSchema),
  equityCurve: z.array(z.object({
    timestamp: z.number(),
    equity: z.number(),
  })),
  drawdownCurve: z.array(z.object({
    timestamp: z.number(),
    drawdown: z.number(),
  })),
  startDate: z.string(),
  endDate: z.string(),
  executionTime: z.number(),
  createdAt: z.string(),
  warnings: z.array(z.string()),
});

const ohlcSchema = z.object({
  timestamp: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
});

// ============================================================================
// Run Backtest Tool
// ============================================================================

export const runBacktestTool = createTool({
  id: "run_backtest",
  description:
    "Run a backtest for a strategy on historical data. Returns performance metrics " +
    "including total return, win rate, Sharpe ratio, max drawdown, and individual trade details. " +
    "Use when the user asks to 'backtest X strategy', 'test how X would perform', " +
    "or 'simulate X strategy on historical data'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    strategyId: z.string().describe("Strategy ID (e.g., 'support_bounce')"),
    timeframe: z.string().default("4h").describe("Candle timeframe"),
    days: z.number().default(90).describe("Number of days to backtest"),
    initialCapital: z.number().default(10000).describe("Starting capital in USDT"),
    commission: z.number().default(0.001).describe("Commission rate (0.001 = 0.1%)"),
  }),
  outputSchema: z.object({
    result: backtestResultSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, strategyId, timeframe, days, initialCapital, commission },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const strategy = strategyRegistry.get(strategyId as StrategyId);
    if (!strategy) {
      return errors.strategyNotFound(strategyId);
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const executionStart = Date.now();

      const ohlcData = await fetchHistoricalData(
        ctx.binance,
        normalizedSymbol,
        timeframe,
        days
      );

      if (ohlcData.length < 100) {
        return errors.insufficientData(normalizedSymbol);
      }

      const backtestConfig = buildBacktestConfig(
        strategyId,
        normalizedSymbol,
        timeframe,
        days,
        initialCapital,
        commission
      );

      const engineParams = {
        initialCapital,
        commissionRate: commission,
      };

      const engineResult = runBacktest(strategy, ohlcData, engineParams);
      const executionTime = Date.now() - executionStart;

      const result = buildBacktestResult(strategy, backtestConfig, engineResult, executionTime);
      const summary = formatBacktestSummary(result);

      return { result, summary };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Backtest execution failed",
      };
    }
  },
});

// ============================================================================
// Optimize Strategy Tool
// ============================================================================

export const optimizeStrategyTool = createTool({
  id: "optimize_strategy",
  description:
    "Optimize strategy parameters using grid search to find the best configuration. " +
    "Use when the user asks to 'optimize X strategy', 'find best parameters', " +
    "or 'tune strategy settings'.",
  inputSchema: z.object({
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETH')"),
    strategyId: z
      .string()
      .describe("Strategy ID to optimize"),
    timeframe: z
      .string()
      .default("4h")
      .describe("Candle timeframe for analysis"),
    parameterRanges: z
      .record(z.string(), z.array(z.number()))
      .describe("Parameters to optimize with their value ranges (e.g., { 'period': [10, 14, 20] })"),
    optimizeFor: z
      .enum(["sharpe", "return", "winRate", "drawdown"])
      .default("sharpe")
      .describe("Metric to optimize for"),
    maxIterations: z
      .number()
      .default(50)
      .describe("Maximum number of parameter combinations to test"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    strategy: z.string().optional(),
    optimizedFor: z.string().optional(),
    bestParameters: z.record(z.string(), z.unknown()).optional(),
    bestMetrics: backtestMetricsSchema.optional(),
    iterationsTested: z.number().optional(),
    allResults: z.array(z.object({
      parameters: z.record(z.string(), z.unknown()),
      metrics: backtestMetricsSchema,
      score: z.number(),
    })).optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, strategyId, timeframe, parameterRanges, optimizeFor, maxIterations },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return { error: errors.noBinance.error };
    }

    const strategy = strategyRegistry.get(strategyId as StrategyId);
    if (!strategy) {
      return { error: errors.strategyNotFound(strategyId).error };
    }

    const normalizedSymbol = normalizeSymbol(symbol);
    const warnings: string[] = [];

    const ohlcData = await fetchHistoricalData(
      ctx.binance,
      normalizedSymbol,
      timeframe,
      90
    );

    if (ohlcData.length < 100) {
      return { error: errors.insufficientData(normalizedSymbol).error };
    }

    const metricKeyMap: Record<string, keyof BacktestMetrics> = {
      sharpe: "sharpeRatio",
      return: "totalReturn",
      winRate: "winRate",
      drawdown: "maxDrawdown",
    };

    const metricKey = metricKeyMap[optimizeFor] ?? "sharpeRatio";

    // Generate parameter combinations
    const paramNames = Object.keys(parameterRanges);
    const combinations: Array<Record<string, number>> = [];

    function generateCombinations(index: number, current: Record<string, number>) {
      if (index === paramNames.length) {
        combinations.push({ ...current });
        return;
      }
      const paramName = paramNames[index]!;
      for (const value of parameterRanges[paramName]!) {
        current[paramName] = value;
        generateCombinations(index + 1, current);
      }
    }

    generateCombinations(0, {});

    const testCombinations = combinations.slice(0, maxIterations);
    if (combinations.length > maxIterations) {
      warnings.push(`Testing ${maxIterations} of ${combinations.length} possible combinations.`);
    }

    const allResults: Array<{
      parameters: Record<string, number>;
      metrics: BacktestMetrics;
      score: number;
    }> = [];

    const engineParams = {
      initialCapital: DEFAULT_BACKTEST_CONFIG.initialCapital,
      commissionRate: 0.001,
    };

    for (const params of testCombinations) {
      const result = runBacktest(strategy, ohlcData, engineParams, params);
      const metricValue = (result.metrics[metricKey] as number) ?? 0;
      const score = metricKey === "maxDrawdown" ? -metricValue : metricValue;

      allResults.push({
        parameters: params,
        metrics: result.metrics,
        score,
      });
    }

    allResults.sort((a, b) => b.score - a.score);

    const best = allResults[0];

    return {
      symbol: normalizedSymbol,
      strategy: strategy.name,
      optimizedFor: optimizeFor,
      bestParameters: best?.parameters ?? {},
      bestMetrics: best?.metrics,
      iterationsTested: testCombinations.length,
      allResults,
      warnings,
    };
  },
});

// ============================================================================
// Compare Backtests Tool
// ============================================================================

export const compareBacktestsTool = createTool({
  id: "compare_backtests",
  description:
    "Compare multiple strategies on the same symbol and time period. " +
    "Use when the user asks to 'compare strategies', 'which strategy is better', " +
    "or 'rank strategies for X coin'.",
  inputSchema: z.object({
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETH')"),
    strategyIds: z
      .array(z.string())
      .describe("List of strategy IDs to compare"),
    timeframe: z
      .string()
      .default("4h")
      .describe("Candle timeframe for analysis"),
    startDate: z
      .string()
      .optional()
      .describe("Comparison start date (ISO format)"),
    endDate: z
      .string()
      .optional()
      .describe("Comparison end date (ISO format)"),
    rankBy: z
      .enum(["sharpe", "return", "winRate", "drawdown"])
      .default("sharpe")
      .describe("Metric to rank strategies by"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    timeframe: z.string().optional(),
    period: z.object({
      startDate: z.string(),
      endDate: z.string(),
      days: z.number(),
    }).optional(),
    rankedBy: z.string().optional(),
    rankings: z.array(z.object({
      rank: z.number(),
      strategy: z.string(),
      strategyId: z.string(),
      metrics: backtestMetricsSchema,
      score: z.number(),
    })).optional(),
    buyAndHold: z.object({
      totalReturn: z.number(),
      maxDrawdown: z.number(),
    }).optional(),
    warnings: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, strategyIds, timeframe, startDate, endDate, rankBy },
    execContext: MastraExecutionContext
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return { error: errors.noBinance.error };
    }

    const normalizedSymbol = normalizeSymbol(symbol);
    const warnings: string[] = [];

    const metricKeyMap: Record<string, keyof BacktestMetrics> = {
      sharpe: "sharpeRatio",
      return: "totalReturn",
      winRate: "winRate",
      drawdown: "maxDrawdown",
    };

    const metricKey = metricKeyMap[rankBy] ?? "sharpeRatio";

    // Validate strategies
    const validStrategies: Strategy[] = [];
    for (const id of strategyIds) {
      const found = strategyRegistry.get(id as StrategyId);
      if (found) {
        validStrategies.push(found);
      } else {
        warnings.push(`Strategy '${id}' not found and will be skipped.`);
      }
    }

    if (validStrategies.length === 0) {
      return { error: "No valid strategies to compare." };
    }

    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
    const periodDays = Math.max(
      1,
      Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000))
    );

    const ohlcData = startDate || endDate
      ? await fetchHistoricalDataRange(
          ctx.binance,
          normalizedSymbol,
          timeframe,
          start.getTime(),
          end.getTime()
        )
      : await fetchHistoricalData(ctx.binance, normalizedSymbol, timeframe, periodDays);

    if (ohlcData.length < 100) {
      return { error: errors.insufficientData(normalizedSymbol).error };
    }

    const engineParams = {
      initialCapital: DEFAULT_BACKTEST_CONFIG.initialCapital,
      commissionRate: 0.001,
    };

    const results: BacktestResult[] = [];
    for (const strat of validStrategies) {
      const execStart = Date.now();
      const config = buildBacktestConfig(
        strat.id,
        normalizedSymbol,
        timeframe,
        periodDays,
        engineParams.initialCapital,
        engineParams.commissionRate
      );
      const engineResult = runBacktest(strat, ohlcData, engineParams);
      const backtestResult = buildBacktestResult(
        strat,
        config,
        engineResult,
        Date.now() - execStart
      );
      results.push(backtestResult);
    }

    const comparison = compareBacktestResults(results, metricKey);

    const rankings = comparison.comparisonTable.map((row, index) => ({
      rank: index + 1,
      strategy: row.strategy as string,
      strategyId: (row.result as BacktestResult)?.config.strategyId ?? "unknown",
      metrics: row.metrics as BacktestMetrics,
      score: (() => {
        const metrics = row.metrics as BacktestMetrics;
        if (!metrics) return 0;
        const value = metrics[metricKey] as number;
        return metricKey === "maxDrawdown" ? -value : value;
      })(),
    }));

    // Simple buy-and-hold benchmark
    const firstClose = ohlcData[0]?.close ?? 0;
    const lastClose = ohlcData[ohlcData.length - 1]?.close ?? 0;
    let buyHoldReturn = 0;
    let buyHoldMaxDrawdown = 0;
    if (firstClose > 0) {
      buyHoldReturn = ((lastClose - firstClose) / firstClose) * 100;
      let peak = firstClose;
      for (const bar of ohlcData) {
        if (bar.close > peak) {
          peak = bar.close;
        }
        const drawdown = ((peak - bar.close) / peak) * 100;
        buyHoldMaxDrawdown = Math.max(buyHoldMaxDrawdown, drawdown);
      }
    }

    return {
      symbol: normalizedSymbol,
      timeframe,
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        days: periodDays,
      },
      rankedBy: rankBy,
      rankings,
      buyAndHold: {
        totalReturn: buyHoldReturn,
        maxDrawdown: buyHoldMaxDrawdown,
      },
      warnings,
    };
  },
});

// ============================================================================
// Get Backtest Summary Tool
// ============================================================================

export const getBacktestSummaryTool = createTool({
  id: "get_backtest_summary",
  description:
    "Get a human-readable summary of backtest results with insights. " +
    "Use after running a backtest to explain results to the user.",
  inputSchema: z.object({
    backtestResult: backtestResultSchema.describe("The backtest result to summarize"),
  }),
  outputSchema: z.object({
    summary: z.string().optional(),
    verdict: z.enum(["excellent", "good", "fair", "poor", "avoid"]).optional(),
    strengths: z.array(z.string()).optional(),
    weaknesses: z.array(z.string()).optional(),
    recommendations: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ backtestResult }) => {
    const metrics = backtestResult.metrics;
    const strengths: string[] = [];
    const weaknesses: string[] = [];
    const recommendations: string[] = [];

    // Analyze total return
    if (metrics.totalReturn > 50) {
      strengths.push(`Strong total return of ${metrics.totalReturn}%`);
    } else if (metrics.totalReturn > 20) {
      strengths.push(`Decent total return of ${metrics.totalReturn}%`);
    } else if (metrics.totalReturn < 0) {
      weaknesses.push(`Negative total return of ${metrics.totalReturn}%`);
    }

    // Analyze Sharpe ratio
    if (metrics.sharpeRatio !== null) {
      if (metrics.sharpeRatio > 2) {
        strengths.push(`Excellent risk-adjusted returns (Sharpe: ${metrics.sharpeRatio})`);
      } else if (metrics.sharpeRatio > 1) {
        strengths.push(`Good risk-adjusted returns (Sharpe: ${metrics.sharpeRatio})`);
      } else if (metrics.sharpeRatio < 0.5) {
        weaknesses.push(`Poor risk-adjusted returns (Sharpe: ${metrics.sharpeRatio})`);
        recommendations.push("Consider strategies with better risk-adjusted returns");
      }
    }

    // Analyze max drawdown
    if (metrics.maxDrawdown < 10) {
      strengths.push(`Low maximum drawdown of ${metrics.maxDrawdown}%`);
    } else if (metrics.maxDrawdown > 30) {
      weaknesses.push(`High maximum drawdown of ${metrics.maxDrawdown}%`);
      recommendations.push("Consider tighter stop-losses to reduce drawdown");
    }

    // Analyze win rate
    if (metrics.winRate !== null) {
      if (metrics.winRate > 60) {
        strengths.push(`High win rate of ${metrics.winRate}%`);
      } else if (metrics.winRate < 40) {
        weaknesses.push(`Low win rate of ${metrics.winRate}%`);
      }
    }

    // Analyze trade count
    if (metrics.totalTrades < 10) {
      weaknesses.push(`Very few trades (${metrics.totalTrades}) - results may not be statistically significant`);
      recommendations.push("Run backtest over a longer period for more trades");
    }

    // Determine verdict
    let verdict: "excellent" | "good" | "fair" | "poor" | "avoid";
    const score = (metrics.sharpeRatio || 0) * 0.4 +
      (metrics.totalReturn / 50) * 0.3 +
      ((100 - metrics.maxDrawdown) / 100) * 0.2 +
      ((metrics.winRate || 50) / 100) * 0.1;

    if (score > 1.5) verdict = "excellent";
    else if (score > 1) verdict = "good";
    else if (score > 0.5) verdict = "fair";
    else if (score > 0) verdict = "poor";
    else verdict = "avoid";

    // Generate summary
    const summary = `${backtestResult.strategyName} on ${backtestResult.config.symbol} (${backtestResult.config.timeframe}): ` +
      `${metrics.totalReturn.toFixed(2)}% return over ${backtestResult.config.days} days with ` +
      `${metrics.totalTrades} trades. ` +
      `Sharpe ratio: ${metrics.sharpeRatio.toFixed(2)}. ` +
      `Max drawdown: ${metrics.maxDrawdown.toFixed(2)}%. ` +
      `Win rate: ${metrics.winRate.toFixed(2)}%.`;

    // Add disclaimer
    recommendations.push("Past performance does not guarantee future results");
    if (backtestResult.config.days < 90) {
      recommendations.push("Consider testing over a longer period (90+ days)");
    }

    return {
      summary,
      verdict,
      strengths: strengths.length > 0 ? strengths : undefined,
      weaknesses: weaknesses.length > 0 ? weaknesses : undefined,
      recommendations,
    };
  },
});

// ============================================================================
// Analysis & Utility Tools (MCP parity)
// ============================================================================

export const analyzeBacktestResultsTool = createTool({
  id: "analyze_backtest_results",
  description: "Analyze a single backtest result comprehensively.",
  inputSchema: z.object({
    result: backtestResultSchema,
  }),
  outputSchema: z.object({
    analysis: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ result }) => {
    return { analysis: analyzeBacktestResult(result) as unknown as Record<string, unknown> };
  },
});

export const compareBacktestResultsTool = createTool({
  id: "compare_backtest_results",
  description: "Compare multiple backtest results and rank them.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    sortBy: z.string().default("totalReturn"),
  }),
  outputSchema: z.object({
    comparison: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, sortBy }) => {
    if (results.length === 0) {
      return { error: "No results provided." };
    }

    const metricKey = (sortBy in results[0]!.metrics ? sortBy : "totalReturn") as keyof BacktestMetrics;
    return { comparison: compareBacktestResults(results, metricKey) };
  },
});

export const rankStrategiesByMetricTool = createTool({
  id: "rank_strategies_by_metric",
  description: "Rank strategies by a specific metric.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    metric: z.string().default("totalReturn"),
  }),
  outputSchema: z.object({
    rankings: z.array(z.object({
      strategy: z.string(),
      value: z.number(),
      rank: z.number(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, metric }) => {
    if (results.length === 0) {
      return { error: "No results provided." };
    }
    const metricKey = (metric in results[0]!.metrics ? metric : "totalReturn") as keyof BacktestMetrics;
    return { rankings: rankStrategiesByMetric(results, metricKey) };
  },
});

export const findBestStrategyTool = createTool({
  id: "find_best_strategy",
  description: "Find the best performing strategy by a specific metric.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    metric: z.string().default("totalReturn"),
  }),
  outputSchema: z.object({
    best: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, metric }) => {
    if (results.length === 0) {
      return { error: "No results provided." };
    }
    const metricKey = (metric in results[0]!.metrics ? metric : "totalReturn") as keyof BacktestMetrics;
    return { best: findBestStrategy(results, metricKey) };
  },
});

// ============================================================================
// Reporting & Export Tools
// ============================================================================

export const exportResultsJsonTool = createTool({
  id: "export_results_json",
  description: "Export backtest results to a JSON file.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    filepath: z.string(),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filepath: z.string().optional(),
    numResults: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, filepath }) => exportResultsJson(results, filepath),
});

export const exportResultsCsvTool = createTool({
  id: "export_results_csv",
  description: "Export backtest results to a CSV file.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    filepath: z.string(),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filepath: z.string().optional(),
    numResults: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, filepath }) => exportResultsCsv(results, filepath),
});

export const generateHtmlReportTool = createTool({
  id: "generate_html_report",
  description: "Generate an HTML report for backtest results.",
  inputSchema: z.object({
    results: z.array(backtestResultSchema),
    filepath: z.string(),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filepath: z.string().optional(),
    numResults: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, filepath }) => generateHtmlReport(results, filepath),
});

// ============================================================================
// Data Filtering Tools
// ============================================================================

export const filterExcludeMonthsTool = createTool({
  id: "filter_exclude_months",
  description: "Filter OHLC data to exclude a range of months.",
  inputSchema: z.object({
    ohlcData: z.array(ohlcSchema),
    startMonth: z.number().default(5),
    endMonth: z.number().default(9),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filteredData: z.array(ohlcSchema).optional(),
    originalRows: z.number().optional(),
    filteredRows: z.number().optional(),
    rowsRemoved: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ohlcData, startMonth, endMonth }) => {
    return filterExcludeMonths(ohlcData, startMonth, endMonth);
  },
});

export const filterMarketHoursTool = createTool({
  id: "filter_market_hours",
  description: "Filter OHLC data into market hours and non-market hours (weekdays only, UTC).",
  inputSchema: z.object({
    ohlcData: z.array(ohlcSchema),
    openTimeStr: z.string().default("13:30"),
    closeTimeStr: z.string().default("20:00"),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    marketHoursData: z.array(ohlcSchema).optional(),
    nonMarketHoursData: z.array(ohlcSchema).optional(),
    marketHoursRows: z.number().optional(),
    nonMarketHoursRows: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ohlcData, openTimeStr, closeTimeStr }) => {
    return filterMarketHours(ohlcData, openTimeStr, closeTimeStr);
  },
});

export const filterFirstLastHourTool = createTool({
  id: "filter_first_last_hour",
  description: "Filter OHLC data for first and last hour of trading (weekdays only, UTC).",
  inputSchema: z.object({
    ohlcData: z.array(ohlcSchema),
    marketOpenStr: z.string().default("13:30"),
    oneHourAfterOpenStr: z.string().default("14:30"),
    oneHourBeforeCloseStr: z.string().default("19:00"),
    marketCloseStr: z.string().default("20:00"),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    filteredData: z.array(ohlcSchema).optional(),
    originalRows: z.number().optional(),
    filteredRows: z.number().optional(),
    rowsRemoved: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ohlcData, marketOpenStr, oneHourAfterOpenStr, oneHourBeforeCloseStr, marketCloseStr }) => {
    return filterFirstLastHour(ohlcData, marketOpenStr, oneHourAfterOpenStr, oneHourBeforeCloseStr, marketCloseStr);
  },
});

// ============================================================================
// Alpha Decay Tool
// ============================================================================

export const analyzeAlphaDecayTool = createTool({
  id: "analyze_alpha_decay",
  description: "Analyze how performance degrades with entry delays.",
  inputSchema: z.object({
    results: z.record(z.string(), z.record(z.string(), z.unknown())),
    metric: z.string().default("return_pct"),
  }),
  outputSchema: z.object({
    analysis: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ results, metric }) => {
    const parsed: Record<number, Record<string, unknown>> = {};
    for (const [key, value] of Object.entries(results)) {
      const delay = Number(key);
      if (!Number.isNaN(delay) && value && typeof value === "object") {
        parsed[delay] = value as Record<string, unknown>;
      }
    }

    const analysis = analyzeAlphaDecay(parsed, metric);
    if ("error" in analysis) {
      return { error: analysis.error };
    }
    return { analysis: analysis as unknown as Record<string, unknown> };
  },
});

// ============================================================================
// Plotting Tool
// ============================================================================

export const generateBacktestChartTool = createTool({
  id: "generate_backtest_chart",
  description: "Generate an ASCII chart for backtest visualization.",
  inputSchema: z.object({
    ohlcData: z.array(ohlcSchema),
    stats: z.object({
      equityCurve: z.array(z.number()).optional(),
    }).optional(),
    title: z.string().default("Backtest Result"),
  }),
  outputSchema: z.object({
    status: z.string().optional(),
    chart: z.string().optional(),
    title: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ ohlcData, stats, title }) => {
    return generateBacktestChart(ohlcData, stats ?? {}, title);
  },
});

// ============================================================================
// Optimization Utilities (MCP parity)
// ============================================================================

export const gridSearchOptimizationTool = createTool({
  id: "grid_search_optimization",
  description: "Perform grid search optimization on precomputed backtest results.",
  inputSchema: z.object({
    param_grid: z.record(z.string(), z.array(z.unknown())),
    backtest_results: z.array(z.object({
      params: z.record(z.string(), z.unknown()),
      stats: z.record(z.string(), z.unknown()),
    })),
    metric: z.string().default("sharpe_ratio"),
    constraint_func_code: z.string().optional(),
  }),
  outputSchema: z.object({
    best_params: z.record(z.string(), z.unknown()).optional(),
    best_metric: z.number().optional(),
    best_stats: z.record(z.string(), z.unknown()).optional(),
    rank: z.number().optional(),
    total_combinations_tested: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ param_grid, backtest_results, metric, constraint_func_code }) => {
    if (constraint_func_code) {
      return { error: "constraint_func_code is not supported in TS implementation." };
    }

    const paramNames = Object.keys(param_grid);
    const combinations: Array<Record<string, unknown>> = [];

    function generateCombinations(index: number, current: Record<string, unknown>) {
      if (index === paramNames.length) {
        combinations.push({ ...current });
        return;
      }
      const paramName = paramNames[index]!;
      const values = param_grid[paramName]!;
      for (const value of values) {
        current[paramName] = value;
        generateCombinations(index + 1, current);
      }
    }

    generateCombinations(0, {});

    let bestParams: Record<string, unknown> | null = null;
    let bestMetric = -Infinity;
    let bestStats: Record<string, unknown> | null = null;
    let rank = 0;

    for (const params of combinations) {
      const match = backtest_results.find((result) => {
        const resultParams = result.params ?? {};
        return Object.entries(params).every(([key, value]) => resultParams[key] === value);
      });
      const stats = match?.stats ?? {};
      const value = typeof stats[metric] === "number" ? (stats[metric] as number) : -Infinity;

      if (value > bestMetric) {
        bestMetric = value;
        bestParams = params;
        bestStats = stats;
      }
    }

    if (!bestParams || !bestStats || bestMetric === -Infinity) {
      return { error: "No valid results found." };
    }

    rank = 1;

    return {
      best_params: bestParams,
      best_metric: bestMetric,
      best_stats: bestStats,
      rank,
      total_combinations_tested: combinations.length,
    };
  },
});

export const randomSearchOptimizationTool = createTool({
  id: "random_search_optimization",
  description: "Perform random search optimization on precomputed backtest results.",
  inputSchema: z.object({
    param_distributions: z.record(z.string(), z.unknown()),
    backtest_results: z.array(z.object({
      params: z.record(z.string(), z.unknown()),
      stats: z.record(z.string(), z.unknown()),
    })),
    n_iter: z.number().default(50),
    metric: z.string().default("sharpe_ratio"),
  }),
  outputSchema: z.object({
    best_params: z.record(z.string(), z.unknown()).optional(),
    best_metric: z.number().optional(),
    best_stats: z.record(z.string(), z.unknown()).optional(),
    rank: z.number().optional(),
    total_iterations: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ param_distributions, backtest_results, n_iter, metric }) => {
    const sampleParam = (dist: unknown): unknown => {
      if (Array.isArray(dist)) {
        if (dist.length === 2 && typeof dist[0] === "number" && typeof dist[1] === "number") {
          const min = dist[0];
          const max = dist[1];
          return min + Math.random() * (max - min);
        }
        return dist[Math.floor(Math.random() * dist.length)];
      }
      return dist;
    };

    let bestParams: Record<string, unknown> | null = null;
    let bestMetric = -Infinity;
    let bestStats: Record<string, unknown> | null = null;

    for (let i = 0; i < n_iter; i++) {
      const params: Record<string, unknown> = {};
      for (const [key, dist] of Object.entries(param_distributions)) {
        params[key] = sampleParam(dist);
      }

      const match = backtest_results.find((result) => {
        const resultParams = result.params ?? {};
        return Object.entries(params).every(([key, value]) => resultParams[key] === value);
      });

      const stats = match?.stats ?? {};
      const value = typeof stats[metric] === "number" ? (stats[metric] as number) : -Infinity;

      if (value > bestMetric) {
        bestMetric = value;
        bestParams = params;
        bestStats = stats;
      }
    }

    if (!bestParams || !bestStats || bestMetric === -Infinity) {
      return { error: "No valid results found." };
    }

    return {
      best_params: bestParams,
      best_metric: bestMetric,
      best_stats: bestStats,
      rank: 1,
      total_iterations: n_iter,
    };
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Backtest tools exported as an object for Mastra Agent
 */
export const backtestTools = {
  run_backtest: runBacktestTool,
  optimize_strategy: optimizeStrategyTool,
  compare_backtests: compareBacktestsTool,
  get_backtest_summary: getBacktestSummaryTool,
  analyze_backtest_results: analyzeBacktestResultsTool,
  compare_backtest_results: compareBacktestResultsTool,
  rank_strategies_by_metric: rankStrategiesByMetricTool,
  find_best_strategy: findBestStrategyTool,
  export_results_json: exportResultsJsonTool,
  export_results_csv: exportResultsCsvTool,
  generate_html_report: generateHtmlReportTool,
  filter_exclude_months: filterExcludeMonthsTool,
  filter_market_hours: filterMarketHoursTool,
  filter_first_last_hour: filterFirstLastHourTool,
  analyze_alpha_decay: analyzeAlphaDecayTool,
  generate_backtest_chart: generateBacktestChartTool,
  grid_search_optimization: gridSearchOptimizationTool,
  random_search_optimization: randomSearchOptimizationTool,
};
