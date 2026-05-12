/**
 * Strategy Iterate Tool
 *
 * Agent tool for improving an existing generated strategy based on feedback.
 * Uses AI to refine the strategy DSL and re-backtest.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  BACKTEST_NOT_PERFORMED_WARNING,
  createStrategyGenerator,
} from "../../../strategy-generator.ts";
import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "../../types.ts";
import {
  loadGeneratedStrategy,
  saveGeneratedStrategy,
  getGeneratedStrategyBacktest,
} from "../../../../storage/entities/generated-strategies.ts";

// ============================================================================
// Input/Output Schemas
// ============================================================================

const inputSchema = z.object({
  strategyId: z
    .string()
    .describe("ID of the strategy to improve"),
  feedback: z
    .string()
    .min(10)
    .max(500)
    .describe("Feedback on what to improve (e.g., 'improve win rate', 'reduce drawdown', 'add RSI filter')"),
  symbol: z
    .string()
    .default("BTCUSDT")
    .describe("Trading symbol to use for backtesting"),
  backtestDays: z
    .number()
    .min(7)
    .max(365)
    .default(90)
    .describe("Days of historical data to use for backtesting"),
});

const outputSchema = z.object({
  success: z.boolean(),
  strategyId: z.string().optional(),
  strategyName: z.string().optional(),
  previousMetrics: z
    .object({
      totalReturn: z.number(),
      sharpeRatio: z.number(),
      maxDrawdown: z.number(),
      winRate: z.number(),
    })
    .optional(),
  newMetrics: z
    .object({
      totalReturn: z.number(),
      sharpeRatio: z.number(),
      maxDrawdown: z.number(),
      winRate: z.number(),
      totalTrades: z.number(),
    })
    .optional(),
  changesApplied: z.array(z.string()).optional(),
  improved: z.boolean().optional(),
  backtestPerformed: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
  error: z.string().optional(),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const strategyIterateTool = createTool({
  id: "strategy_iterate",
  description:
    "Improve an existing generated strategy based on specific feedback. " +
    "The AI will modify the strategy to address the feedback while preserving core logic. " +
    "Use when the user says 'improve this strategy', 'make it less risky', " +
    "'increase the win rate', or provides specific improvement suggestions.",
  inputSchema,
  outputSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);

    if (!ctx?.llm) {
      return {
        success: false,
        error: "LLM client not available. Please configure API keys.",
      };
    }

    const normalizedSymbol = normalizeSymbol(input.symbol);

    try {
      // Load existing strategy
      const existingStrategy = await loadGeneratedStrategy(input.strategyId);
      if (!existingStrategy) {
        return {
          success: false,
          error: `Strategy '${input.strategyId}' not found. Use strategy_generate to create a new strategy.`,
        };
      }

      // Get previous backtest result if available
      const previousBacktest = await getGeneratedStrategyBacktest(input.strategyId);
      const previousMetrics = previousBacktest
        ? {
            totalReturn: previousBacktest.metrics.totalReturn,
            sharpeRatio: previousBacktest.metrics.sharpeRatio,
            maxDrawdown: previousBacktest.metrics.maxDrawdown,
            winRate: previousBacktest.metrics.winRate,
          }
        : undefined;

      // Create generator and iterate
      const generator = createStrategyGenerator(ctx.llm, ctx.exchange ?? undefined);

      // Create a mock backtest result if we don't have one
      const backtestForIteration = previousBacktest || {
        id: `bt_${Date.now()}`,
        strategyName: existingStrategy.name,
        config: {
          strategyId: existingStrategy.id,
          symbol: normalizedSymbol,
          timeframe: existingStrategy.timeframes[0] || "4h",
          days: input.backtestDays,
          initialCapital: 10000,
          positionSizePercent: 10,
          compounding: false,
          feePercent: 0.1,
          slippagePercent: 0.05,
        },
        metrics: {
          totalReturn: 0,
          annualizedReturn: 0,
          cagr: 0,
          maxDrawdown: 0,
          sharpeRatio: 0,
          sortinoRatio: 0,
          volatility: 0,
          calmarRatio: 0,
          totalTrades: 0,
          winningTrades: 0,
          losingTrades: 0,
          winRate: 0,
          profitFactor: 0,
          averageTrade: 0,
          averageWin: 0,
          averageLoss: 0,
          expectancy: 0,
          maxConsecutiveWins: 0,
          maxConsecutiveLosses: 0,
          initialValue: 10000,
          finalValue: 10000,
          totalPnl: 0,
          netProfit: 0,
          totalFees: 0,
          avgTradeDuration: 0,
          maxDrawdownDuration: 0,
        },
        trades: [],
        equityCurve: [],
        drawdownCurve: [],
        startDate: new Date().toISOString(),
        endDate: new Date().toISOString(),
        executionTime: 0,
        createdAt: new Date().toISOString(),
        warnings: [],
      };

      const result = await generator.iterateStrategy(
        existingStrategy,
        backtestForIteration,
        input.feedback,
        {
          riskLevel: existingStrategy.riskLevel,
          timeframes: existingStrategy.timeframes,
          backtestDays: input.backtestDays,
          symbol: normalizedSymbol,
        }
      );

      // Save the improved strategy
      try {
        await saveGeneratedStrategy(result.strategy, result.backtestResult);
      } catch (saveError) {
        console.warn("Failed to save iterated strategy:", saveError);
      }

      // Compare metrics
      const warnings = result.backtestResult.warnings;
      const backtestPerformed = !warnings.includes(BACKTEST_NOT_PERFORMED_WARNING);
      const newMetrics = backtestPerformed
        ? {
            totalReturn: Math.round(result.backtestResult.metrics.totalReturn * 100) / 100,
            sharpeRatio: Math.round(result.backtestResult.metrics.sharpeRatio * 100) / 100,
            maxDrawdown: Math.round(result.backtestResult.metrics.maxDrawdown * 100) / 100,
            winRate: Math.round(result.backtestResult.metrics.winRate * 100) / 100,
            totalTrades: result.backtestResult.metrics.totalTrades,
          }
        : undefined;

      // Determine if improved based on key metrics
      let improved: boolean | undefined;
      if (previousMetrics && newMetrics) {
        const sharpeImproved = newMetrics.sharpeRatio > previousMetrics.sharpeRatio;
        const returnImproved = newMetrics.totalReturn > previousMetrics.totalReturn;
        const drawdownImproved = newMetrics.maxDrawdown < previousMetrics.maxDrawdown;

        // Consider improved if majority of key metrics improved
        const improvementCount = [sharpeImproved, returnImproved, drawdownImproved].filter(Boolean).length;
        improved = improvementCount >= 2;
      }

      return {
        success: true,
        strategyId: result.strategy.id,
        strategyName: result.strategy.name,
        previousMetrics,
        newMetrics,
        changesApplied: result.improvements,
        improved,
        backtestPerformed,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Strategy iteration failed",
      };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export default strategyIterateTool;
