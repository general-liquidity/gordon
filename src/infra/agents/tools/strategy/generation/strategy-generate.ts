/**
 * Strategy Generate Tool
 *
 * Agent tool for generating new trading strategies from natural language descriptions.
 * Uses AI to create Strategy DSL definitions that are validated and backtested.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  BACKTEST_NOT_PERFORMED_WARNING,
  createStrategyGenerator,
} from "../../../strategy-generator.ts";
import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "../../types.ts";
import { saveGeneratedStrategy } from "../../../../storage/entities/generated-strategies.ts";

// ============================================================================
// Input/Output Schemas
// ============================================================================

const inputSchema = z.object({
  description: z
    .string()
    .min(10)
    .max(1000)
    .describe("Natural language description of the trading strategy to generate"),
  riskLevel: z
    .enum(["low", "medium", "high"])
    .default("medium")
    .describe("Risk level preference for the strategy"),
  timeframes: z
    .array(z.string())
    .default(["4h", "1d"])
    .describe("Preferred timeframes for the strategy"),
  backtestDays: z
    .number()
    .min(7)
    .max(365)
    .default(90)
    .describe("Days of historical data to use for backtesting"),
  symbol: z
    .string()
    .default("BTCUSDT")
    .describe("Trading symbol to use for backtesting"),
  minSharpe: z
    .number()
    .min(0)
    .max(5)
    .default(0.5)
    .describe("Minimum Sharpe ratio threshold"),
  maxIterations: z
    .number()
    .min(1)
    .max(5)
    .default(3)
    .describe("Maximum iterations for improving the strategy"),
});

const outputSchema = z.object({
  success: z.boolean(),
  strategyId: z.string().optional(),
  strategyName: z.string().optional(),
  strategyDescription: z.string().optional(),
  backtestSummary: z
    .object({
      totalReturn: z.number(),
      sharpeRatio: z.number(),
      maxDrawdown: z.number(),
      winRate: z.number(),
      totalTrades: z.number(),
    })
    .optional(),
  iterations: z.number().optional(),
  improvements: z.array(z.string()).optional(),
  meetsThresholds: z.boolean().optional(),
  backtestPerformed: z.boolean().optional(),
  warnings: z.array(z.string()).optional(),
  error: z.string().optional(),
});

// ============================================================================
// Tool Definition
// ============================================================================

export const strategyGenerateTool = createTool({
  id: "strategy_generate",
  description:
    "Generate a new trading strategy from a natural language description. " +
    "The AI will create a complete strategy with entry rules, exit rules, and risk management. " +
    "The strategy is automatically backtested and iteratively improved if needed. " +
    "Use when the user asks to 'create a strategy', 'generate a strategy for', " +
    "'build a trading strategy', or describes trading conditions they want to capture.",
  inputSchema,
  outputSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);

    // Check for required clients
    if (!ctx?.llm) {
      return {
        success: false,
        error: "LLM client not available. Please configure API keys.",
      };
    }

    const normalizedSymbol = normalizeSymbol(input.symbol);

    try {
      // Create strategy generator
      const generator = createStrategyGenerator(ctx.llm, ctx.exchange ?? undefined);

      // Generate strategy
      const result = await generator.generateFromPrompt(input.description, {
        riskLevel: input.riskLevel,
        timeframes: input.timeframes,
        backtestDays: input.backtestDays,
        symbol: normalizedSymbol,
        minSharpe: input.minSharpe,
        maxIterations: input.maxIterations,
      });

      // Save the generated strategy
      try {
        await saveGeneratedStrategy(result.strategy, result.backtestResult);
      } catch (saveError) {
        // Log but don't fail if save fails
        console.warn("Failed to save generated strategy:", saveError);
      }

      // Extract backtest summary
      const metrics = result.backtestResult.metrics;
      const warnings = result.backtestResult.warnings;
      const backtestPerformed = !warnings.includes(BACKTEST_NOT_PERFORMED_WARNING);

      return {
        success: true,
        strategyId: result.strategy.id,
        strategyName: result.strategy.name,
        strategyDescription: result.strategy.description,
        backtestSummary: {
          totalReturn: Math.round(metrics.totalReturn * 100) / 100,
          sharpeRatio: Math.round(metrics.sharpeRatio * 100) / 100,
          maxDrawdown: Math.round(metrics.maxDrawdown * 100) / 100,
          winRate: Math.round(metrics.winRate * 100) / 100,
          totalTrades: metrics.totalTrades,
        },
        iterations: result.iterations,
        improvements: result.improvements,
        meetsThresholds: result.meetsThresholds,
        backtestPerformed,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Strategy generation failed",
      };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export default strategyGenerateTool;
