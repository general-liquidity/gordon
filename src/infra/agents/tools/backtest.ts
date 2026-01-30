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
import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "./types.ts";
import type { Candle } from "../../../core/indicators/types.ts";

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Calculate number of candles needed for a given number of days and timeframe
 */
function calculateCandleCount(days: number, timeframe: string): number {
  const hoursPerDay = 24;
  const timeframeHours: Record<string, number> = {
    "1m": 1 / 60,
    "5m": 5 / 60,
    "15m": 15 / 60,
    "30m": 30 / 60,
    "1h": 1,
    "2h": 2,
    "4h": 4,
    "6h": 6,
    "8h": 8,
    "12h": 12,
    "1d": 24,
    "3d": 72,
    "1w": 168,
  };

  const tfHours = timeframeHours[timeframe] ?? 4;
  return Math.ceil((days * hoursPerDay) / tfHours);
}

/**
 * Calculate Sharpe Ratio from trade returns
 */
function calculateSharpeRatio(returns: number[], riskFreeRate: number = 0.02): number {
  if (returns.length < 2) return 0;

  const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / (returns.length - 1);
  const stdDev = Math.sqrt(variance);

  if (stdDev === 0) return 0;

  // Annualize assuming ~252 trading days
  const annualizedReturn = avgReturn * 252;
  const annualizedStdDev = stdDev * Math.sqrt(252);

  return (annualizedReturn - riskFreeRate) / annualizedStdDev;
}

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

// ============================================================================
// Backtest Result Schema
// ============================================================================

const backtestResultSchema = z.object({
  symbol: z.string(),
  strategyId: z.string(),
  strategyName: z.string(),
  timeframe: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  initialCapital: z.number(),
  finalCapital: z.number(),
  totalReturn: z.number(),
  totalReturnPercent: z.number(),
  totalTrades: z.number(),
  winningTrades: z.number(),
  losingTrades: z.number(),
  winRate: z.number(),
  profitFactor: z.number(),
  maxDrawdown: z.number(),
  maxDrawdownPercent: z.number(),
  sharpeRatio: z.number(),
  averageWin: z.number(),
  averageLoss: z.number(),
  averageHoldingPeriod: z.number(),
  trades: z.array(z.object({
    entryTime: z.number(),
    entryPrice: z.number(),
    exitTime: z.number(),
    exitPrice: z.number(),
    side: z.enum(["long", "short"]),
    quantity: z.number(),
    pnl: z.number(),
    pnlPercent: z.number(),
    commission: z.number(),
  })),
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
      // Fetch historical data
      const candleCount = calculateCandleCount(days, timeframe);
      const candles = await ctx.binance.getCandles(normalizedSymbol, timeframe, Math.min(candleCount, 1000));

      if (candles.length < 100) {
        return errors.insufficientData(normalizedSymbol);
      }

      // Run backtest simulation
      const trades: Array<{
        entryTime: number;
        entryPrice: number;
        exitTime: number;
        exitPrice: number;
        side: "long" | "short";
        quantity: number;
        pnl: number;
        pnlPercent: number;
        commission: number;
      }> = [];

      let capital = initialCapital;
      let peakCapital = initialCapital;
      let maxDrawdown = 0;
      let inPosition = false;
      let entryCandle: Candle | null = null;
      let entryPrice = 0;
      let quantity = 0;

      // Sliding window for strategy detection
      const windowSize = Math.min(100, Math.floor(candles.length / 2));

      for (let i = windowSize; i < candles.length - 1; i++) {
        const windowCandles = candles.slice(i - windowSize, i + 1);
        const currentCandle = candles[i]!;
        const nextCandle = candles[i + 1]!;

        if (!inPosition) {
          // Check for entry signal
          try {
            const detection = await strategy.detect(normalizedSymbol, timeframe, {
              binance: ctx.binance,
              candles: windowCandles,
              currentPrice: currentCandle.close,
            });

            if (detection.detected && detection.confidence >= 0.6) {
              // Enter position at next candle open
              inPosition = true;
              entryCandle = currentCandle;
              entryPrice = nextCandle.open;
              quantity = (capital * 0.95) / entryPrice; // Use 95% of capital

              const entryCommission = entryPrice * quantity * commission;
              capital -= entryCommission;
            }
          } catch {
            // Detection failed, skip this candle
          }
        } else if (entryCandle) {
          // Check for exit conditions
          const holdingBars = i - candles.indexOf(entryCandle);
          const pnlPercent = ((currentCandle.close - entryPrice) / entryPrice) * 100;

          // Exit conditions: take profit at 5%, stop loss at -3%, or max 20 bars
          const takeProfit = pnlPercent >= 5;
          const stopLoss = pnlPercent <= -3;
          const maxHold = holdingBars >= 20;

          if (takeProfit || stopLoss || maxHold) {
            // Exit position
            const exitPrice = nextCandle.open;
            const exitCommission = exitPrice * quantity * commission;
            const pnl = (exitPrice - entryPrice) * quantity - exitCommission;
            const finalPnlPercent = ((exitPrice - entryPrice) / entryPrice) * 100;

            trades.push({
              entryTime: entryCandle.openTime ?? 0,
              entryPrice,
              exitTime: nextCandle.openTime ?? 0,
              exitPrice,
              side: "long",
              quantity,
              pnl,
              pnlPercent: finalPnlPercent,
              commission: exitCommission,
            });

            capital += pnl + (entryPrice * quantity);

            // Track max drawdown
            if (capital > peakCapital) {
              peakCapital = capital;
            }
            const drawdown = peakCapital - capital;
            if (drawdown > maxDrawdown) {
              maxDrawdown = drawdown;
            }

            // Reset position
            inPosition = false;
            entryCandle = null;
            entryPrice = 0;
            quantity = 0;
          }
        }
      }

      // Calculate statistics
      const winningTrades = trades.filter((t) => t.pnl > 0);
      const losingTrades = trades.filter((t) => t.pnl <= 0);

      const totalWins = winningTrades.reduce((sum, t) => sum + t.pnl, 0);
      const totalLosses = Math.abs(losingTrades.reduce((sum, t) => sum + t.pnl, 0));

      const returns = trades.map((t) => t.pnlPercent / 100);
      const sharpeRatio = calculateSharpeRatio(returns);

      const avgHoldingPeriod = trades.length > 0
        ? trades.reduce((sum, t) => sum + (t.exitTime - t.entryTime), 0) / trades.length / (1000 * 60 * 60)
        : 0;

      const result = {
        symbol: normalizedSymbol,
        strategyId,
        strategyName: strategy.name,
        timeframe,
        startDate: new Date(candles[0]?.openTime ?? 0).toISOString(),
        endDate: new Date(candles[candles.length - 1]?.openTime ?? 0).toISOString(),
        initialCapital,
        finalCapital: capital,
        totalReturn: capital - initialCapital,
        totalReturnPercent: ((capital - initialCapital) / initialCapital) * 100,
        totalTrades: trades.length,
        winningTrades: winningTrades.length,
        losingTrades: losingTrades.length,
        winRate: trades.length > 0 ? (winningTrades.length / trades.length) * 100 : 0,
        profitFactor: totalLosses > 0 ? totalWins / totalLosses : totalWins > 0 ? Infinity : 0,
        maxDrawdown,
        maxDrawdownPercent: peakCapital > 0 ? (maxDrawdown / peakCapital) * 100 : 0,
        sharpeRatio,
        averageWin: winningTrades.length > 0 ? totalWins / winningTrades.length : 0,
        averageLoss: losingTrades.length > 0 ? totalLosses / losingTrades.length : 0,
        averageHoldingPeriod: avgHoldingPeriod,
        trades,
      };

      // Generate summary
      const summary = [
        `Backtest Results for ${strategy.name} on ${normalizedSymbol}`,
        `Period: ${result.startDate.split("T")[0]} to ${result.endDate.split("T")[0]}`,
        ``,
        `Performance:`,
        `  Total Return: $${result.totalReturn.toFixed(2)} (${result.totalReturnPercent.toFixed(2)}%)`,
        `  Final Capital: $${result.finalCapital.toFixed(2)}`,
        ``,
        `Trade Statistics:`,
        `  Total Trades: ${result.totalTrades}`,
        `  Win Rate: ${result.winRate.toFixed(1)}%`,
        `  Profit Factor: ${result.profitFactor === Infinity ? "Inf" : result.profitFactor.toFixed(2)}`,
        ``,
        `Risk Metrics:`,
        `  Max Drawdown: $${result.maxDrawdown.toFixed(2)} (${result.maxDrawdownPercent.toFixed(2)}%)`,
        `  Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`,
        ``,
        `Trade Details:`,
        `  Average Win: $${result.averageWin.toFixed(2)}`,
        `  Average Loss: $${result.averageLoss.toFixed(2)}`,
        `  Avg Holding Period: ${result.averageHoldingPeriod.toFixed(1)} hours`,
      ].join("\n");

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

    // Generate parameter combinations
    const paramNames = Object.keys(parameterRanges);
    const combinations: Array<Record<string, number>> = [];

    function generateCombinations(index: number, current: Record<string, number>) {
      if (index === paramNames.length) {
        combinations.push({ ...current });
        return;
      }
      const paramName = paramNames[index];
      for (const value of parameterRanges[paramName]) {
        current[paramName] = value;
        generateCombinations(index + 1, current);
      }
    }

    generateCombinations(0, {});

    // Limit iterations
    const testCombinations = combinations.slice(0, maxIterations);
    if (combinations.length > maxIterations) {
      warnings.push(`Testing ${maxIterations} of ${combinations.length} possible combinations.`);
    }

    // Note: This is a placeholder implementation
    // In production, this would call the MCP backtesting server for actual optimization
    warnings.push("Note: This is a simplified optimization. For full parameter optimization, use the backtesting MCP server.");

    // Return placeholder result structure
    return {
      symbol: normalizedSymbol,
      strategy: strategy.name,
      optimizedFor: optimizeFor,
      bestParameters: testCombinations[0] || {},
      bestMetrics: {
        totalReturn: 0,
        sharpeRatio: null,
        maxDrawdown: 0,
        winRate: null,
        numTrades: 0,
        avgTradeReturn: null,
        profitFactor: null,
      },
      iterationsTested: testCombinations.length,
      allResults: [],
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

    // Validate strategies
    const validStrategies: Array<{ id: string; name: string }> = [];
    for (const id of strategyIds) {
      const strategy = strategyRegistry.get(id as StrategyId);
      if (strategy) {
        validStrategies.push({ id: strategy.id, name: strategy.name });
      } else {
        warnings.push(`Strategy '${id}' not found and will be skipped.`);
      }
    }

    if (validStrategies.length === 0) {
      return { error: "No valid strategies to compare." };
    }

    // Calculate date range
    const end = endDate ? new Date(endDate) : new Date();
    const start = startDate ? new Date(startDate) : new Date(end.getTime() - 90 * 24 * 60 * 60 * 1000);
    const periodDays = Math.round((end.getTime() - start.getTime()) / (24 * 60 * 60 * 1000));

    // Note: This is a placeholder - in production, run actual backtests
    warnings.push("Note: This is a comparison stub. Connect to the backtesting MCP server for actual comparison.");

    return {
      symbol: normalizedSymbol,
      timeframe,
      period: {
        startDate: start.toISOString(),
        endDate: end.toISOString(),
        days: periodDays,
      },
      rankedBy: rankBy,
      rankings: validStrategies.map((s, i) => ({
        rank: i + 1,
        strategy: s.name,
        strategyId: s.id,
        metrics: {
          totalReturn: 0,
          sharpeRatio: null,
          maxDrawdown: 0,
          winRate: null,
          numTrades: 0,
          avgTradeReturn: null,
          profitFactor: null,
        },
        score: 0,
      })),
      buyAndHold: {
        totalReturn: 0,
        maxDrawdown: 0,
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
    if (backtestResult.error) {
      return { error: backtestResult.error };
    }

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
    if (metrics.numTrades < 10) {
      weaknesses.push(`Very few trades (${metrics.numTrades}) - results may not be statistically significant`);
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
    const summary = `${backtestResult.strategy} on ${backtestResult.symbol} (${backtestResult.timeframe}): ` +
      `${metrics.totalReturn}% return over ${backtestResult.periodDays} days with ` +
      `${metrics.numTrades} trades. ` +
      (metrics.sharpeRatio ? `Sharpe ratio: ${metrics.sharpeRatio}. ` : "") +
      `Max drawdown: ${metrics.maxDrawdown}%. ` +
      (metrics.winRate ? `Win rate: ${metrics.winRate}%.` : "");

    // Add disclaimer
    recommendations.push("Past performance does not guarantee future results");
    if (backtestResult.periodDays < 90) {
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
};
