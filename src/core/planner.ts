/**
 * Planner Module for Gordon CLI
 *
 * Uses AI to generate trade plans from analysis data.
 * The planner is the brain that turns analysis into actionable plans.
 */

import { LLMClient, loadPrompt, buildMessages } from "../infra/llm/index.ts";
import { PlanSchema, type Plan, type GordonConfig } from "../types/index.ts";
import type { DetailedAnalysis } from "./analyzer.ts";

// ============================================================================
// Types
// ============================================================================

export interface PlannerInput {
  analysis: DetailedAnalysis;
  preferences: {
    riskLevel: "low" | "medium" | "high";
    maxAllocation: number; // dollar amount
    cashReservePercent: number;
  };
  portfolioValue: number;
}

/**
 * Internal schema for LLM response before we add generated fields
 * The LLM doesn't generate id, createdAt, or status - we add those
 */
interface LLMPlanResponse {
  symbol: string;
  direction: "long";
  strategy: "support_bounce";
  allocation: {
    currency: "USDT";
    amount: number;
    percentOfPortfolio: number;
  };
  entry: {
    type: "limit" | "market";
    price: number | null;
  };
  dca: Array<{
    price: number;
    percentOfAllocation: number;
  }> | null;
  stopLoss: {
    price: number;
  };
  takeProfit: Array<{
    price: number;
    percentToSell: number;
  }>;
  reasoning: string;
}

// ============================================================================
// Constants
// ============================================================================

const ALPHANUMERIC_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ID_LENGTH = 8;

// Validation constants
const MIN_RISK_REWARD_RATIO = 1.2; // Minimum acceptable R:R

// Stop loss distance ranges by risk level (percentage from entry)
const STOP_LOSS_RANGES: Record<string, { min: number; max: number }> = {
  low: { min: 0.03, max: 0.05 },    // 3-5%
  medium: { min: 0.05, max: 0.08 }, // 5-8%
  high: { min: 0.08, max: 0.12 },   // 8-12%
};

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Generate a unique ID with the specified prefix
 * @param prefix - Prefix for the ID (e.g., "pln_")
 * @returns ID string in format: prefix + 8 random alphanumeric characters
 */
export function generateId(prefix: string): string {
  let result = "";
  for (let i = 0; i < ID_LENGTH; i++) {
    const randomIndex = Math.floor(Math.random() * ALPHANUMERIC_CHARS.length);
    result += ALPHANUMERIC_CHARS[randomIndex];
  }
  return prefix + result;
}

/**
 * Build context object from planner input for prompt injection
 */
function buildPlannerContext(input: PlannerInput): Record<string, unknown> {
  const { analysis, preferences, portfolioValue } = input;

  // Extract support levels (S1, S2, S3)
  const supports = analysis.supports.slice(0, 3);
  const resistances = analysis.resistances.slice(0, 3);

  return {
    symbol: analysis.symbol,
    currentPrice: analysis.price,

    // Support levels
    support: {
      s1: supports[0]?.price ?? null,
      s2: supports[1]?.price ?? null,
      s3: supports[2]?.price ?? null,
    },

    // Resistance levels
    resistance: {
      r1: resistances[0]?.price ?? null,
      r2: resistances[1]?.price ?? null,
      r3: resistances[2]?.price ?? null,
    },

    // Indicators
    indicators: {
      rsi: analysis.indicators.rsi,
      macdSignal: analysis.macdState.includes("bullish")
        ? "bullish"
        : analysis.macdState.includes("bearish")
        ? "bearish"
        : "neutral",
      volumeTrend:
        analysis.volumeTrend === "rising"
          ? "increasing"
          : analysis.volumeTrend === "falling"
          ? "decreasing"
          : "stable",
    },

    // Market conditions
    trend:
      analysis.trend === "up"
        ? "uptrend"
        : analysis.trend === "down"
        ? "downtrend"
        : "sideways",
    volatility: analysis.risk, // Using risk as a proxy for volatility
    setupQuality:
      analysis.setupConfidence >= 0.7
        ? "strong"
        : analysis.setupConfidence >= 0.4
        ? "moderate"
        : "weak",

    // User preferences
    preferences: {
      riskLevel: preferences.riskLevel,
      cashReservePercent: preferences.cashReservePercent,
      maxAllocationPerTrade: preferences.maxAllocation / portfolioValue,
    },

    // Portfolio state
    portfolio: {
      totalValue: portfolioValue,
      availableCash: portfolioValue * (1 - preferences.cashReservePercent),
    },
  };
}

/**
 * Calculate risk/reward ratio for a plan
 */
function calculateRiskReward(
  entryPrice: number | null,
  stopPrice: number,
  takeProfits: Array<{ price: number; percentToSell: number }>
): number {
  if (entryPrice === null || takeProfits.length === 0) {
    return 0;
  }

  // Risk is distance from entry to stop
  const risk = entryPrice - stopPrice;
  if (risk <= 0) {
    return 0;
  }

  // Calculate weighted average reward based on TP levels
  let weightedReward = 0;
  for (const tp of takeProfits) {
    const reward = tp.price - entryPrice;
    weightedReward += reward * tp.percentToSell;
  }

  return weightedReward / risk;
}

/**
 * Validate basic plan structure
 */
function validatePlanStructure(plan: LLMPlanResponse, input: PlannerInput): string[] {
  const errors: string[] = [];
  const { preferences } = input;

  // Entry must exist
  if (plan.entry.type === "limit" && plan.entry.price === null) {
    errors.push("Limit order requires an entry price");
  }

  // Stop loss must exist and be below entry for long
  if (!plan.stopLoss || plan.stopLoss.price === undefined) {
    errors.push("Stop loss is required");
  } else if (plan.entry.price !== null && plan.stopLoss.price >= plan.entry.price) {
    errors.push("Stop loss must be below entry price for long positions");
  }

  // Take profits must exist
  if (!plan.takeProfit || plan.takeProfit.length === 0) {
    errors.push("At least one take profit level is required");
  } else {
    // TP percentages must sum to 1
    const tpSum = plan.takeProfit.reduce((sum, tp) => sum + tp.percentToSell, 0);
    if (Math.abs(tpSum - 1.0) > 0.01) {
      errors.push(`Take profit percentages must sum to 100%, got ${(tpSum * 100).toFixed(1)}%`);
    }

    // TPs must be above entry
    if (plan.entry.price !== null) {
      for (const tp of plan.takeProfit) {
        if (tp.price <= plan.entry.price) {
          errors.push(`Take profit ${tp.price} must be above entry ${plan.entry.price}`);
        }
      }
    }
  }

  // Validate stop loss distance based on risk level
  if (plan.entry.price !== null && plan.stopLoss?.price) {
    const stopDistance = (plan.entry.price - plan.stopLoss.price) / plan.entry.price;
    const range = STOP_LOSS_RANGES[preferences.riskLevel];

    if (range) {
      if (stopDistance < range.min) {
        errors.push(
          `Stop loss too tight for ${preferences.riskLevel} risk: ${(stopDistance * 100).toFixed(1)}% (min: ${(range.min * 100).toFixed(0)}%)`
        );
      }
      if (stopDistance > range.max) {
        errors.push(
          `Stop loss too wide for ${preferences.riskLevel} risk: ${(stopDistance * 100).toFixed(1)}% (max: ${(range.max * 100).toFixed(0)}%)`
        );
      }
    }
  }

  // Validate risk/reward ratio
  if (plan.entry.price !== null && plan.stopLoss?.price && plan.takeProfit?.length > 0) {
    const rr = calculateRiskReward(plan.entry.price, plan.stopLoss.price, plan.takeProfit);
    if (rr < MIN_RISK_REWARD_RATIO) {
      errors.push(
        `Risk/reward ratio ${rr.toFixed(2)}:1 is below minimum ${MIN_RISK_REWARD_RATIO}:1`
      );
    }
  }

  // Allocation must not exceed max
  if (plan.allocation.amount > preferences.maxAllocation) {
    errors.push(
      `Allocation ${plan.allocation.amount} exceeds max allowed ${preferences.maxAllocation}`
    );
  }

  // DCA validation if present
  if (plan.dca && plan.dca.length > 0) {
    const dcaSum = plan.dca.reduce((sum, d) => sum + d.percentOfAllocation, 0);
    if (Math.abs(dcaSum - 1.0) > 0.01) {
      errors.push(`DCA percentages must sum to 100%, got ${(dcaSum * 100).toFixed(1)}%`);
    }

    // DCA prices must be below entry
    if (plan.entry.price !== null) {
      for (const dca of plan.dca) {
        if (dca.price >= plan.entry.price) {
          errors.push(`DCA level ${dca.price} must be below entry ${plan.entry.price}`);
        }
      }
    }
  }

  return errors;
}

// ============================================================================
// Main Function
// ============================================================================

/**
 * Generate a trade plan from analysis data using AI
 *
 * @param client - LLM client for AI communication
 * @param input - Planner input containing analysis, preferences, and portfolio value
 * @returns A complete trade plan ready for execution
 * @throws Error if plan generation or validation fails
 */
export async function generatePlan(
  client: LLMClient,
  input: PlannerInput
): Promise<Plan> {
  // Step 1: Load the planner prompt
  const systemPrompt = await loadPrompt("planner");

  // Step 2: Build context with analysis data, preferences, and portfolio constraints
  const context = buildPlannerContext(input);

  // Step 3: Build messages for LLM
  const userMessage = `Generate a trade plan for the following setup:

${JSON.stringify(context, null, 2)}

Respond with a JSON object containing the plan. Follow all the rules in the system prompt.`;

  const messages = buildMessages(systemPrompt, userMessage);

  // Step 4: Call LLM with JSON mode
  // We use a partial schema that matches what the LLM generates
  // (without id, createdAt, status which we add ourselves)
  const LLMResponseSchema = PlanSchema.omit({
    id: true,
    createdAt: true,
    status: true,
  });

  const llmResponse = await client.chatWithJSON(messages, LLMResponseSchema);

  // Step 5: Validate basic structure
  const validationErrors = validatePlanStructure(llmResponse as LLMPlanResponse, input);
  if (validationErrors.length > 0) {
    throw new Error(`Plan validation failed: ${validationErrors.join("; ")}`);
  }

  // Step 6: Generate plan ID
  const id = generateId("pln_");

  // Step 7: Set createdAt to now
  const createdAt = new Date().toISOString();

  // Step 8: Set status to DRAFT
  const status = "DRAFT" as const;

  // Build final plan
  const plan: Plan = {
    ...llmResponse,
    id,
    createdAt,
    status,
  };

  // Final validation with full schema
  const parseResult = PlanSchema.safeParse(plan);
  if (!parseResult.success) {
    const errorMessages = parseResult.error.issues
      .map((e) => `${String(e.path.join("."))}: ${e.message}`)
      .join(", ");
    throw new Error(`Final plan validation failed: ${errorMessages}`);
  }

  return parseResult.data;
}
