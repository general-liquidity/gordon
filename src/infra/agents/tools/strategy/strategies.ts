/**
 * Strategy Tools (Mastra Format)
 *
 * Tools for listing, detecting, and using trading strategies.
 * These tools bridge the Strategy Library with Gordon's agents.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  strategyRegistry,
  runEnsemble,
  runQuickEnsemble,
  type StrategyId,
} from "../../../../strategies/index.ts";
import { getGordonContext, normalizeSymbol, type MastraExecutionContext } from "../types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please run setup first." },
  strategyNotFound: (id: string) => ({
    error: `Strategy "${id}" not found. Use list_strategies to see available strategies.`,
  }),
};

// ============================================================================
// List Strategies Tool
// ============================================================================

export const listStrategiesTool = createTool({
  id: "list_strategies",
  description:
    "List all available trading strategies with their descriptions and tiers. " +
    "Use this when the user asks 'what strategies do you have?' or 'show me strategies'.",
  inputSchema: z.object({
    tier: z
      .number()
      .min(1)
      .max(2)
      .optional()
      .describe("Filter by tier (1 = beginner, 2 = intermediate). Omit for all."),
  }),
  outputSchema: z.object({
    tier1: z
      .object({
        label: z.string(),
        strategies: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            indicators: z.string(),
            timeframes: z.string(),
            risk: z.string(),
          }),
        ),
      })
      .optional(),
    tier2: z
      .object({
        label: z.string(),
        strategies: z.array(
          z.object({
            id: z.string(),
            name: z.string(),
            description: z.string(),
            indicators: z.string(),
            timeframes: z.string(),
            risk: z.string(),
          }),
        ),
      })
      .optional(),
    total: z.number(),
  }),
  execute: async ({ tier }) => {
    const formatted = strategyRegistry.listFormatted();

    if (tier === 1) {
      return {
        tier1: formatted.tier1,
        total: formatted.tier1.strategies.length,
      };
    }

    if (tier === 2) {
      return {
        tier2: formatted.tier2,
        total: formatted.tier2.strategies.length,
      };
    }

    return formatted;
  },
});

// ============================================================================
// Get Strategy Details Tool
// ============================================================================

export const getStrategyDetailsTool = createTool({
  id: "get_strategy_details",
  description:
    "Get detailed information about a specific strategy including rules and indicators. " +
    "Use when the user asks 'tell me about X strategy' or 'how does X work?'.",
  inputSchema: z.object({
    strategyId: z.string().describe("Strategy ID (e.g., 'support_bounce', 'bollinger_bounce')"),
  }),
  outputSchema: z.object({
    id: z.string().optional(),
    name: z.string().optional(),
    tier: z.number().optional(),
    description: z.string().optional(),
    indicators: z.array(z.string()).optional(),
    timeframes: z.array(z.string()).optional(),
    riskLevel: z.string().optional(),
    rules: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ strategyId }) => {
    const strategy = strategyRegistry.get(strategyId as StrategyId);

    if (!strategy) {
      return errors.strategyNotFound(strategyId);
    }

    return {
      id: strategy.id,
      name: strategy.name,
      tier: strategy.tier,
      description: strategy.description,
      indicators: strategy.indicators,
      timeframes: strategy.timeframes,
      riskLevel: strategy.riskLevel,
      rules: strategy.getPromptFragment(),
    };
  },
});

// ============================================================================
// Detect Strategy Tool
// ============================================================================

export const detectStrategyTool = createTool({
  id: "detect_strategy",
  description:
    "Detect if a specific strategy's conditions are met for a symbol. " +
    "Use when the user asks 'is X strategy good for BTC?' or 'check bollinger bounce on ETH'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETH')"),
    strategyId: z.string().describe("Strategy ID to check (e.g., 'support_bounce')"),
    timeframe: z.string().default("4h").describe("Timeframe to analyze"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    strategy: z.string().optional(),
    detected: z.boolean().optional(),
    confidence: z.number().optional(),
    confidencePercent: z.string().optional(),
    reasoning: z.string().optional(),
    signals: z.record(z.string(), z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, strategyId, timeframe }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const strategy = strategyRegistry.get(strategyId as StrategyId);
    if (!strategy) {
      return errors.strategyNotFound(strategyId);
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const result = await strategy.detect(normalizedSymbol, timeframe, {
        exchange: ctx.exchange,
      });

      return {
        symbol: normalizedSymbol,
        strategy: strategy.name,
        detected: result.detected,
        confidence: result.confidence,
        confidencePercent: `${Math.round(result.confidence * 100)}%`,
        reasoning: result.reasoning,
        signals: result.signals,
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Detection failed",
      };
    }
  },
});

// ============================================================================
// Scan For Strategy Tool
// ============================================================================

export const scanForStrategyTool = createTool({
  id: "scan_for_strategy",
  description:
    "Scan multiple coins for a specific strategy. " +
    "Use when the user asks 'find coins good for bollinger bounce' or 'scan for support bounce setups'.",
  inputSchema: z.object({
    strategyId: z.string().describe("Strategy ID to scan for (e.g., 'support_bounce')"),
    symbols: z
      .array(z.string())
      .default([
        "BTCUSDT",
        "ETHUSDT",
        "BNBUSDT",
        "SOLUSDT",
        "XRPUSDT",
        "ADAUSDT",
        "DOGEUSDT",
        "AVAXUSDT",
        "DOTUSDT",
        "LINKUSDT",
      ])
      .describe("Symbols to scan (defaults to top 10)"),
    timeframe: z.string().default("4h").describe("Timeframe to analyze"),
    minConfidence: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Minimum confidence threshold (0-1)"),
  }),
  outputSchema: z.object({
    strategy: z.string().optional(),
    scanned: z.number().optional(),
    detected: z.number().optional(),
    opportunities: z
      .array(
        z.object({
          symbol: z.string(),
          confidence: z.string(),
          reasoning: z.string(),
        }),
      )
      .optional(),
    noSetups: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { strategyId, symbols, timeframe, minConfidence },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const strategy = strategyRegistry.get(strategyId as StrategyId);
    if (!strategy) {
      return errors.strategyNotFound(strategyId);
    }

    const opportunities: { symbol: string; confidence: string; reasoning: string }[] = [];
    const noSetups: string[] = [];

    for (const symbol of symbols) {
      const normalizedSymbol = normalizeSymbol(symbol);

      try {
        const result = await strategy.detect(normalizedSymbol, timeframe, {
          exchange: ctx.exchange,
        });

        if (result.detected && result.confidence >= minConfidence) {
          opportunities.push({
            symbol: normalizedSymbol,
            confidence: `${Math.round(result.confidence * 100)}%`,
            reasoning: result.reasoning,
          });
        } else {
          noSetups.push(normalizedSymbol);
        }
      } catch {
        noSetups.push(`${normalizedSymbol} (error)`);
      }
    }

    // Sort by confidence descending
    opportunities.sort((a, b) => {
      const confA = parseInt(a.confidence, 10);
      const confB = parseInt(b.confidence, 10);
      return confB - confA;
    });

    return {
      strategy: strategy.name,
      scanned: symbols.length,
      detected: opportunities.length,
      opportunities: opportunities.slice(0, 10),
      noSetups: noSetups.length > 5 ? undefined : noSetups, // Only show if few
    };
  },
});

// ============================================================================
// Suggest Strategy Tool
// ============================================================================

export const suggestStrategyTool = createTool({
  id: "suggest_strategy",
  description:
    "Suggest the best strategy for a specific coin based on current market conditions. " +
    "Use when the user asks 'what strategy is best for BTC?' or 'which strategy should I use?'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETH')"),
    timeframe: z.string().default("4h").describe("Timeframe to analyze"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    recommendations: z
      .array(
        z.object({
          strategy: z.string(),
          strategyId: z.string(),
          confidence: z.string(),
          reasoning: z.string(),
        }),
      )
      .optional(),
    noSetups: z.boolean().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, timeframe }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);
    const allStrategies = strategyRegistry.getAll();

    const results: {
      strategy: string;
      strategyId: StrategyId;
      confidence: number;
      reasoning: string;
    }[] = [];

    for (const strategy of allStrategies) {
      // Skip grid_entry as it's a special strategy
      if (strategy.id === "grid_entry") continue;

      try {
        const result = await strategy.detect(normalizedSymbol, timeframe, {
          exchange: ctx.exchange,
        });

        if (result.detected && result.confidence > 0.4) {
          results.push({
            strategy: strategy.name,
            strategyId: strategy.id,
            confidence: result.confidence,
            reasoning: result.reasoning,
          });
        }
      } catch {
        // Skip failed detections
      }
    }

    if (results.length === 0) {
      return {
        symbol: normalizedSymbol,
        noSetups: true,
        message: `No strong setups detected for ${normalizedSymbol}. Consider waiting for better conditions.`,
      };
    }

    // Sort by confidence
    results.sort((a, b) => b.confidence - a.confidence);

    return {
      symbol: normalizedSymbol,
      recommendations: results.slice(0, 3).map((r) => ({
        strategy: r.strategy,
        strategyId: r.strategyId,
        confidence: `${Math.round(r.confidence * 100)}%`,
        reasoning: r.reasoning,
      })),
    };
  },
});

// ============================================================================
// Run Strategy Ensemble Tool
// ============================================================================

export const runStrategyEnsembleTool = createTool({
  id: "run_strategy_ensemble",
  description:
    "Run multiple strategies and combine their signals for more robust detection. " +
    "Returns confidence weighted by how many strategies agree. " +
    "Use when you want higher confidence signals or to validate a single strategy's detection.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETH')"),
    timeframe: z.string().default("4h").describe("Timeframe to analyze"),
    strategies: z
      .array(z.string())
      .optional()
      .describe("Specific strategy IDs to run (omit for all strategies)"),
    minAgreement: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Minimum percentage of strategies that must agree (0-1, default 0.5)"),
    tierFilter: z
      .number()
      .min(1)
      .max(2)
      .optional()
      .describe("Only run tier 1 or tier 2 strategies"),
    quickMode: z
      .boolean()
      .default(false)
      .describe("Use quick mode with top 3 strategies and 66% agreement threshold"),
  }),
  outputSchema: z.object({
    symbol: z.string().optional(),
    timeframe: z.string().optional(),
    detected: z.boolean().optional(),
    confidence: z.number().optional(),
    confidencePercent: z.string().optional(),
    agreementPercent: z.string().optional(),
    bullishCount: z.number().optional(),
    totalCount: z.number().optional(),
    recommendedStrategy: z.string().nullable().optional(),
    combinedReasoning: z.string().optional(),
    strategies: z
      .array(
        z.object({
          id: z.string(),
          detected: z.boolean(),
          confidence: z.string(),
          reasoning: z.string(),
        }),
      )
      .optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbol, timeframe, strategies, minAgreement, tierFilter, quickMode },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const normalizedSymbol = normalizeSymbol(symbol);

    try {
      const result = quickMode
        ? await runQuickEnsemble(normalizedSymbol, timeframe, { exchange: ctx.exchange })
        : await runEnsemble(
            normalizedSymbol,
            timeframe,
            { exchange: ctx.exchange },
            {
              strategies,
              minAgreement,
              tierFilter: tierFilter as 1 | 2 | undefined,
            },
          );

      return {
        symbol: result.symbol,
        timeframe: result.timeframe,
        detected: result.detected,
        confidence: result.confidence,
        confidencePercent: `${Math.round(result.confidence * 100)}%`,
        agreementPercent: `${Math.round(result.agreementPercent * 100)}%`,
        bullishCount: result.bullishCount,
        totalCount: result.totalCount,
        recommendedStrategy: result.recommendedStrategy,
        combinedReasoning: result.combinedReasoning,
        strategies: result.strategies.map((s) => ({
          id: s.id,
          detected: s.detected,
          confidence: `${Math.round(s.confidence * 100)}%`,
          reasoning: s.reasoning,
        })),
      };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "Ensemble detection failed",
      };
    }
  },
});

// ============================================================================
// Scan With Ensemble Tool
// ============================================================================

export const scanWithEnsembleTool = createTool({
  id: "scan_with_ensemble",
  description:
    "Scan multiple coins using ensemble detection for higher confidence signals. " +
    "Runs all strategies on each coin and ranks by combined confidence. " +
    "Use for comprehensive market scanning with validated signals.",
  inputSchema: z.object({
    symbols: z
      .array(z.string())
      .default([
        "BTCUSDT",
        "ETHUSDT",
        "BNBUSDT",
        "SOLUSDT",
        "XRPUSDT",
        "ADAUSDT",
        "DOGEUSDT",
        "AVAXUSDT",
        "DOTUSDT",
        "LINKUSDT",
      ])
      .describe("Symbols to scan (defaults to top 10)"),
    timeframe: z.string().default("4h").describe("Timeframe to analyze"),
    minAgreement: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("Minimum percentage of strategies that must agree (0-1)"),
    tierFilter: z
      .number()
      .min(1)
      .max(2)
      .optional()
      .describe("Only run tier 1 or tier 2 strategies"),
    maxResults: z
      .number()
      .min(1)
      .max(20)
      .default(5)
      .describe("Maximum number of results to return"),
  }),
  outputSchema: z.object({
    scanned: z.number().optional(),
    detected: z.number().optional(),
    opportunities: z
      .array(
        z.object({
          symbol: z.string(),
          confidence: z.string(),
          agreementPercent: z.string(),
          bullishCount: z.number(),
          totalCount: z.number(),
          recommendedStrategy: z.string().nullable(),
          combinedReasoning: z.string(),
        }),
      )
      .optional(),
    noSetups: z.array(z.string()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    { symbols, timeframe, minAgreement, tierFilter, maxResults },
    execContext: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return errors.noExchange;
    }

    const opportunities: Array<{
      symbol: string;
      confidence: string;
      agreementPercent: string;
      bullishCount: number;
      totalCount: number;
      recommendedStrategy: string | null;
      combinedReasoning: string;
    }> = [];
    const noSetups: string[] = [];

    for (const symbol of symbols) {
      const normalizedSymbol = normalizeSymbol(symbol);

      try {
        const result = await runEnsemble(
          normalizedSymbol,
          timeframe,
          { exchange: ctx.exchange },
          {
            minAgreement,
            tierFilter: tierFilter as 1 | 2 | undefined,
          },
        );

        if (result.detected) {
          opportunities.push({
            symbol: normalizedSymbol,
            confidence: `${Math.round(result.confidence * 100)}%`,
            agreementPercent: `${Math.round(result.agreementPercent * 100)}%`,
            bullishCount: result.bullishCount,
            totalCount: result.totalCount,
            recommendedStrategy: result.recommendedStrategy,
            combinedReasoning: result.combinedReasoning,
          });
        } else {
          noSetups.push(normalizedSymbol);
        }
      } catch {
        noSetups.push(`${normalizedSymbol} (error)`);
      }
    }

    // Sort by confidence descending
    opportunities.sort((a, b) => {
      const confA = parseInt(a.confidence, 10);
      const confB = parseInt(b.confidence, 10);
      return confB - confA;
    });

    return {
      scanned: symbols.length,
      detected: opportunities.length,
      opportunities: opportunities.slice(0, maxResults),
      noSetups: noSetups.length <= 5 ? noSetups : undefined,
    };
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Strategy tools exported as an object for Mastra Agent
 */
export const strategyTools = {
  list_strategies: listStrategiesTool,
  get_strategy_details: getStrategyDetailsTool,
  detect_strategy: detectStrategyTool,
  scan_for_strategy: scanForStrategyTool,
  suggest_strategy: suggestStrategyTool,
  run_strategy_ensemble: runStrategyEnsembleTool,
  scan_with_ensemble: scanWithEnsembleTool,
};
