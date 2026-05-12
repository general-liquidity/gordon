/**
 * Strategy Explain Tool
 *
 * Agent tool for explaining generated strategies in plain English.
 * Converts Strategy DSL into human-readable explanations.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { loadGeneratedStrategy, getGeneratedStrategyBacktest } from "../../../storage/entities/generated-strategies.ts";
import type { StrategyDSL, SignalRule, Condition, StopLoss, TakeProfit } from "../../../../strategies/dsl/schema.ts";
import { getGordonContext, type MastraExecutionContext } from "../types.ts";

// ============================================================================
// Input/Output Schemas
// ============================================================================

const inputSchema = z.object({
  strategyId: z
    .string()
    .describe("ID of the strategy to explain"),
  includeBacktest: z
    .boolean()
    .default(true)
    .describe("Include backtest performance summary"),
  detailLevel: z
    .enum(["brief", "standard", "detailed"])
    .default("standard")
    .describe("Level of detail in the explanation"),
});

const outputSchema = z.object({
  success: z.boolean(),
  strategyName: z.string().optional(),
  overview: z.string().optional(),
  entryExplanation: z.string().optional(),
  exitExplanation: z.string().optional(),
  riskManagement: z.string().optional(),
  bestConditions: z.string().optional(),
  backtestSummary: z.string().optional(),
  fullExplanation: z.string().optional(),
  error: z.string().optional(),
});

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Explain indicator conditions
 */
function explainCondition(condition: Condition): string {
  if (condition.type === "indicator") {
    const { indicator, comparison, value, params } = condition;
    const periodStr = params?.period ? ` (${params.period} period)` : "";

    const compMap: Record<string, string> = {
      gt: "is above",
      lt: "is below",
      gte: "is at or above",
      lte: "is at or below",
      eq: "equals",
      cross_above: "crosses above",
      cross_below: "crosses below",
    };

    const compText = compMap[comparison] || comparison;
    const valueText = typeof value === "number" ? value.toString() : value;

    return `${indicator.toUpperCase()}${periodStr} ${compText} ${valueText}`;
  }

  if (condition.type === "price") {
    const { condition: cond, threshold } = condition;
    const condMap: Record<string, string> = {
      near_support: `price is within ${threshold || 3}% of support level`,
      near_resistance: `price is within ${threshold || 3}% of resistance level`,
      breakout_above: "price breaks above resistance",
      breakout_below: "price breaks below support",
      in_range: "price is within the support/resistance range",
    };
    return condMap[cond] || cond;
  }

  if (condition.type === "pattern") {
    const { pattern, direction } = condition;
    const dirText = direction && direction !== "any" ? ` ${direction}` : "";
    return `${dirText} ${pattern.replace("_", " ")} pattern forms`;
  }

  return "unknown condition";
}

/**
 * Explain a signal rule
 */
function explainRule(rule: SignalRule): string {
  const conditions = rule.conditions.map(explainCondition);
  const combiner = rule.operator === "AND" ? " AND " : " OR ";
  return `${rule.name}: ${conditions.join(combiner)}`;
}

/**
 * Explain stop loss configuration
 */
function explainStopLoss(stop: StopLoss): string {
  switch (stop.type) {
    case "percent":
      return `${stop.value}% below entry price`;
    case "atr":
      return `${stop.multiplier || 2}x ATR(${stop.value}) below entry`;
    case "support":
      return "just below the nearest support level";
    case "fixed":
      return `$${stop.value} below entry price`;
    default:
      return "configured stop loss";
  }
}

/**
 * Explain take profit levels
 */
function explainTakeProfits(tps: TakeProfit[]): string {
  return tps
    .map((tp, i) => {
      const targetText =
        typeof tp.target === "number"
          ? `${tp.target}:1 risk-reward`
          : tp.target === "resistance"
          ? "at resistance"
          : `${tp.targetValue || 3}x ATR`;

      return `TP${i + 1}: Exit ${(tp.percent * 100).toFixed(0)}% at ${targetText}`;
    })
    .join("; ");
}

/**
 * Generate full strategy explanation
 */
function generateExplanation(strategy: StrategyDSL, detailLevel: string): {
  overview: string;
  entryExplanation: string;
  exitExplanation: string;
  riskManagement: string;
  bestConditions: string;
} {
  // Overview
  const overview = `**${strategy.name}** is a ${strategy.riskLevel}-risk ${
    strategy.tier === "1" ? "beginner-friendly" : "intermediate"
  } strategy designed for ${strategy.timeframes.join(" and ")} timeframes. ${strategy.description}`;

  // Entry explanation
  const longRules = strategy.entryRules.long.map(explainRule);
  const shortRules = strategy.entryRules.short?.map(explainRule) || [];

  let entryExplanation = `**Entry Conditions (Long):**\n${longRules.map((r) => `- ${r}`).join("\n")}`;
  if (shortRules.length > 0) {
    entryExplanation += `\n\n**Entry Conditions (Short):**\n${shortRules.map((r) => `- ${r}`).join("\n")}`;
  }

  // Exit explanation
  const stopExplanation = explainStopLoss(strategy.exitRules.stopLoss);
  const tpExplanation = explainTakeProfits(strategy.exitRules.takeProfit);
  const trailingExplanation = strategy.exitRules.trailingStop?.enabled
    ? `Trailing stop activates at ${strategy.exitRules.trailingStop.activation}% profit, trailing by ${strategy.exitRules.trailingStop.distance}%.`
    : "";

  let exitExplanation = `**Stop Loss:** ${stopExplanation}\n**Take Profits:** ${tpExplanation}`;
  if (trailingExplanation) {
    exitExplanation += `\n**Trailing Stop:** ${trailingExplanation}`;
  }

  // Risk management summary
  const riskManagement = generateRiskSummary(strategy);

  // Best conditions
  const bestConditions = strategy.filters
    ? `Works best when: ${
        strategy.filters.trendFilter === "up"
          ? "market is trending up"
          : strategy.filters.trendFilter === "down"
          ? "market is trending down"
          : "in any market direction"
      }${
        strategy.filters.minVolume
          ? `, with volume at least ${strategy.filters.minVolume}x average`
          : ""
      }${
        strategy.filters.minVolatility
          ? `, volatility above ${strategy.filters.minVolatility}%`
          : ""
      }.`
    : "Suitable for most market conditions.";

  return { overview, entryExplanation, exitExplanation, riskManagement, bestConditions };
}

/**
 * Generate risk management summary
 */
function generateRiskSummary(strategy: StrategyDSL): string {
  const parts: string[] = [];

  // Risk level
  parts.push(`Risk Level: ${strategy.riskLevel.charAt(0).toUpperCase() + strategy.riskLevel.slice(1)}`);

  // Stop loss type
  const stopType = strategy.exitRules.stopLoss.type;
  if (stopType === "atr") {
    parts.push("Uses volatility-adjusted stop losses (ATR-based)");
  } else if (stopType === "percent") {
    parts.push(`Fixed ${strategy.exitRules.stopLoss.value}% stop loss`);
  }

  // Multiple take profits
  const numTPs = strategy.exitRules.takeProfit.length;
  if (numTPs > 1) {
    parts.push(`Scales out profits across ${numTPs} take-profit levels`);
  }

  // Trailing stop
  if (strategy.exitRules.trailingStop?.enabled) {
    parts.push("Uses trailing stop to protect profits");
  }

  return parts.join(". ") + ".";
}

/**
 * Generate backtest summary text
 */
function generateBacktestSummary(metrics: {
  totalReturn: number;
  sharpeRatio: number;
  maxDrawdown: number;
  winRate: number;
  totalTrades: number;
}): string {
  const parts: string[] = [];

  // Return assessment
  if (metrics.totalReturn > 50) {
    parts.push(`Strong returns of ${metrics.totalReturn.toFixed(1)}%`);
  } else if (metrics.totalReturn > 20) {
    parts.push(`Positive returns of ${metrics.totalReturn.toFixed(1)}%`);
  } else if (metrics.totalReturn > 0) {
    parts.push(`Modest returns of ${metrics.totalReturn.toFixed(1)}%`);
  } else {
    parts.push(`Negative returns of ${metrics.totalReturn.toFixed(1)}%`);
  }

  // Sharpe assessment
  if (metrics.sharpeRatio > 2) {
    parts.push(`excellent risk-adjusted returns (Sharpe: ${metrics.sharpeRatio.toFixed(2)})`);
  } else if (metrics.sharpeRatio > 1) {
    parts.push(`good risk-adjusted returns (Sharpe: ${metrics.sharpeRatio.toFixed(2)})`);
  } else if (metrics.sharpeRatio > 0.5) {
    parts.push(`acceptable risk-adjusted returns (Sharpe: ${metrics.sharpeRatio.toFixed(2)})`);
  } else {
    parts.push(`low risk-adjusted returns (Sharpe: ${metrics.sharpeRatio.toFixed(2)})`);
  }

  // Win rate and trades
  parts.push(`${metrics.winRate.toFixed(0)}% win rate across ${metrics.totalTrades} trades`);

  // Drawdown warning
  if (metrics.maxDrawdown > 30) {
    parts.push(`significant drawdown of ${metrics.maxDrawdown.toFixed(1)}%`);
  } else if (metrics.maxDrawdown > 15) {
    parts.push(`moderate drawdown of ${metrics.maxDrawdown.toFixed(1)}%`);
  } else {
    parts.push(`low drawdown of ${metrics.maxDrawdown.toFixed(1)}%`);
  }

  return parts.join(", ") + ".";
}

// ============================================================================
// Tool Definition
// ============================================================================

export const strategyExplainTool = createTool({
  id: "strategy_explain",
  description:
    "Explain a generated strategy in plain English. " +
    "Breaks down entry rules, exit rules, and risk management into understandable terms. " +
    "Use when the user asks 'explain this strategy', 'how does X strategy work', " +
    "'what are the entry conditions', or wants to understand a strategy better.",
  inputSchema,
  outputSchema,
  execute: async (input, execContext: MastraExecutionContext) => {
    try {
      // Load the strategy
      const strategy = await loadGeneratedStrategy(input.strategyId);
      if (!strategy) {
        return {
          success: false,
          error: `Strategy '${input.strategyId}' not found. Use list_generated_strategies to see available strategies.`,
        };
      }

      // Generate explanations
      const { overview, entryExplanation, exitExplanation, riskManagement, bestConditions } =
        generateExplanation(strategy, input.detailLevel);

      // Get backtest summary if requested
      let backtestSummary: string | undefined;
      if (input.includeBacktest) {
        const backtest = await getGeneratedStrategyBacktest(input.strategyId);
        if (backtest) {
          backtestSummary = generateBacktestSummary({
            totalReturn: backtest.metrics.totalReturn,
            sharpeRatio: backtest.metrics.sharpeRatio,
            maxDrawdown: backtest.metrics.maxDrawdown,
            winRate: backtest.metrics.winRate,
            totalTrades: backtest.metrics.totalTrades,
          });
        } else {
          backtestSummary = "No backtest results available for this strategy.";
        }
      }

      // Create full explanation based on detail level
      let fullExplanation = `# ${strategy.name}\n\n${overview}`;

      if (input.detailLevel !== "brief") {
        fullExplanation += `\n\n## Entry Rules\n${entryExplanation}`;
        fullExplanation += `\n\n## Exit Rules\n${exitExplanation}`;
        fullExplanation += `\n\n## Risk Management\n${riskManagement}`;
      }

      if (input.detailLevel === "detailed") {
        fullExplanation += `\n\n## Best Market Conditions\n${bestConditions}`;
        fullExplanation += `\n\n## Required Indicators\n${strategy.requiredIndicators.join(", ")}`;
      }

      if (backtestSummary) {
        fullExplanation += `\n\n## Backtest Performance\n${backtestSummary}`;
      }

      return {
        success: true,
        strategyName: strategy.name,
        overview,
        entryExplanation,
        exitExplanation,
        riskManagement,
        bestConditions,
        backtestSummary,
        fullExplanation,
      };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to explain strategy",
      };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export default strategyExplainTool;
