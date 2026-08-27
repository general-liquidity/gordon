/**
 * Strategy Generation Tools
 *
 * Tools for AI-powered strategy generation, iteration, and explanation.
 * These tools enable users to create, improve, and understand trading
 * strategies through natural language interaction.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// Import individual tools
import { strategyGenerateTool } from "./strategy-generate.ts";
import { strategyIterateTool } from "./strategy-iterate.ts";
import { strategyExplainTool } from "./strategy-explain.ts";

// Import storage functions
import {
  listGeneratedStrategies,
  countGeneratedStrategies,
  deleteGeneratedStrategy,
  type GeneratedStrategyQueryOptions,
} from "../../../../storage/entities/generated-strategies.ts";

// ============================================================================
// List Generated Strategies Tool
// ============================================================================

const listGeneratedStrategiesTool = createTool({
  id: "list_generated_strategies",
  description:
    "List all AI-generated strategies with their performance summaries. " +
    "Use when the user asks to 'show my strategies', 'list generated strategies', " +
    "or 'what strategies have I created'.",
  inputSchema: z.object({
    riskLevel: z.enum(["low", "medium", "high"]).optional().describe("Filter by risk level"),
    minReturn: z.number().optional().describe("Filter by minimum backtest return percentage"),
    minSharpe: z.number().optional().describe("Filter by minimum Sharpe ratio"),
    orderBy: z
      .enum(["createdAt", "backtestReturn", "backtestSharpe", "name"])
      .default("createdAt")
      .describe("Field to order results by"),
    orderDirection: z.enum(["asc", "desc"]).default("desc").describe("Sort direction"),
    limit: z.number().min(1).max(50).default(10).describe("Maximum number of results"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    strategies: z
      .array(
        z.object({
          id: z.string(),
          name: z.string(),
          description: z.string(),
          riskLevel: z.string(),
          timeframes: z.array(z.string()),
          createdAt: z.string(),
          backtestReturn: z.number().optional(),
          backtestSharpe: z.number().optional(),
          backtestWinRate: z.number().optional(),
        }),
      )
      .optional(),
    totalCount: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ riskLevel, minReturn, minSharpe, orderBy, orderDirection, limit }) => {
    try {
      const options: GeneratedStrategyQueryOptions = {
        riskLevel,
        minReturn,
        minSharpe,
        orderBy,
        orderDirection,
        limit,
      };

      const strategies = listGeneratedStrategies(options);
      const totalCount = countGeneratedStrategies({
        riskLevel,
        minReturn,
        minSharpe,
      });

      return {
        success: true,
        strategies,
        totalCount,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to list strategies",
      };
    }
  },
});

// ============================================================================
// Delete Generated Strategy Tool
// ============================================================================

const deleteGeneratedStrategyTool = createTool({
  id: "delete_generated_strategy",
  description:
    "Delete a generated strategy by ID. " +
    "Use when the user asks to 'delete strategy X', 'remove strategy', " +
    "or 'clean up old strategies'.",
  inputSchema: z.object({
    strategyId: z.string().describe("ID of the strategy to delete"),
    confirm: z.boolean().default(false).describe("Confirmation flag - must be true to proceed"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ strategyId, confirm }) => {
    if (!confirm) {
      return {
        success: false,
        error: "Deletion requires confirmation. Set confirm=true to proceed.",
      };
    }

    try {
      const deleted = deleteGeneratedStrategy(strategyId);

      if (deleted) {
        return {
          success: true,
          message: `Strategy '${strategyId}' has been deleted.`,
        };
      }

      return {
        success: false,
        error: `Strategy '${strategyId}' not found or could not be deleted.`,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to delete strategy",
      };
    }
  },
});

// ============================================================================
// Export Tools Object
// ============================================================================

/**
 * Strategy generation tools exported as an object for Mastra Agent
 */
export const strategyGenerationTools = {
  strategy_generate: strategyGenerateTool,
  strategy_iterate: strategyIterateTool,
  strategy_explain: strategyExplainTool,
  list_generated_strategies: listGeneratedStrategiesTool,
  delete_generated_strategy: deleteGeneratedStrategyTool,
};

// Re-export individual tools
export {
  strategyGenerateTool,
  strategyIterateTool,
  strategyExplainTool,
  listGeneratedStrategiesTool,
  deleteGeneratedStrategyTool,
};
