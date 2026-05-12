/**
 * Agent Reflection Module
 *
 * Provides self-correction capabilities for critical operations like trade plan creation.
 * Implements both rule-based validation and LLM-based semantic reflection.
 */

import { z } from "zod";

import type { Plan } from "../../../types/plan.ts";
import type { LLMClient } from "../../ai/llm/index.ts";
import type { GordonContext } from "../types.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { emitEvent } from "../../../events/index.ts";

const logger = createModuleLogger("reflection");

// ============================================================================
// Types
// ============================================================================

/**
 * Result of a reflection operation
 */
export interface ReflectionResult {
  /** Whether the content passed reflection checks */
  isValid: boolean;
  /** List of issues found during reflection */
  issues: string[];
  /** Suggestions for fixing issues */
  suggestions: string[];
  /** Confidence score (0-1) in the reflection result */
  confidence: number;
  /** Additional metadata about the reflection */
  metadata?: {
    durationMs: number;
    checksPerformed: number;
    usedLLM: boolean;
  };
}

/**
 * Options for reflection operations
 */
export interface ReflectionOptions {
  /** Skip LLM-based reflection (use only rule-based checks) */
  skipLLM?: boolean;
  /** Minimum confidence threshold for passing */
  minConfidence?: number;
  /** Additional context for reflection */
  additionalContext?: string;
}

// ============================================================================
// Constants
// ============================================================================

const MIN_RISK_REWARD_RATIO = 1.2;
const MAX_ALLOCATION_PERCENT = 0.25; // 25% max of portfolio
const MAX_STOP_LOSS_DISTANCE_PERCENT = 0.15; // 15% max from entry
const MIN_STOP_LOSS_DISTANCE_PERCENT = 0.02; // 2% min from entry

// LLM reflection schema
const LLMReflectionResultSchema = z.object({
  isValid: z.boolean(),
  issues: z.array(z.string()),
  suggestions: z.array(z.string()),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

// ============================================================================
// Rule-Based Plan Validation
// ============================================================================

/**
 * Validate price level logic for a plan
 */
function validatePriceLevels(plan: Plan): string[] {
  const issues: string[] = [];
  const entryPrice = plan.entry.price;

  // For long positions
  if (plan.direction === "long") {
    // Stop loss must be below entry
    if (entryPrice !== null && plan.stopLoss.price >= entryPrice) {
      issues.push(
        `Stop-loss ($${plan.stopLoss.price.toFixed(2)}) must be below entry ($${entryPrice.toFixed(2)}) for long positions`
      );
    }

    // Take profits must be above entry
    for (const tp of plan.takeProfit) {
      if (entryPrice !== null && tp.price <= entryPrice) {
        issues.push(
          `Take profit ($${tp.price.toFixed(2)}) must be above entry ($${entryPrice.toFixed(2)}) for long positions`
        );
      }
    }

    // DCA levels must be below entry (if present)
    if (plan.dca) {
      for (const dca of plan.dca) {
        if (entryPrice !== null && dca.price >= entryPrice) {
          issues.push(
            `DCA level ($${dca.price.toFixed(2)}) must be below entry ($${entryPrice.toFixed(2)}) for long positions`
          );
        }
      }
    }

    // Grid levels validation (if grid strategy)
    if (plan.grid && plan.grid.levels.length > 0) {
      const lowestGridLevel = plan.grid.levels[plan.grid.levels.length - 1];
      if (lowestGridLevel && plan.stopLoss.price >= lowestGridLevel.price) {
        issues.push(
          `Stop-loss ($${plan.stopLoss.price.toFixed(2)}) must be below lowest grid level ($${lowestGridLevel.price.toFixed(2)})`
        );
      }
    }
  }

  return issues;
}

/**
 * Calculate and validate risk/reward ratio
 */
function validateRiskRewardRatio(plan: Plan): { issues: string[]; ratio: number } {
  const issues: string[] = [];
  const entryPrice = plan.entry.price;

  if (entryPrice === null || plan.takeProfit.length === 0) {
    return { issues: ["Cannot calculate R:R ratio without entry price and take profit levels"], ratio: 0 };
  }

  // Calculate risk (distance from entry to stop)
  const risk = entryPrice - plan.stopLoss.price;
  if (risk <= 0) {
    return { issues: ["Invalid risk calculation: stop loss is at or above entry"], ratio: 0 };
  }

  // Calculate weighted average reward based on TP levels
  let weightedReward = 0;
  for (const tp of plan.takeProfit) {
    const reward = tp.price - entryPrice;
    weightedReward += reward * tp.percentToSell;
  }

  const ratio = weightedReward / risk;

  if (ratio < MIN_RISK_REWARD_RATIO) {
    issues.push(
      `Risk/reward ratio (${ratio.toFixed(2)}:1) is below minimum acceptable (${MIN_RISK_REWARD_RATIO}:1)`
    );
  }

  return { issues, ratio };
}

/**
 * Validate allocation and position sizing
 */
function validateAllocation(plan: Plan, context: GordonContext): string[] {
  const issues: string[] = [];
  const { allocation } = plan;
  const { portfolioValue, availableCash } = context;

  // Check allocation doesn't exceed max percent
  if (allocation.percentOfPortfolio > MAX_ALLOCATION_PERCENT) {
    issues.push(
      `Allocation (${(allocation.percentOfPortfolio * 100).toFixed(1)}%) exceeds maximum allowed (${MAX_ALLOCATION_PERCENT * 100}%)`
    );
  }

  // Check allocation doesn't exceed available cash
  if (allocation.amount > availableCash * 0.95) {
    issues.push(
      `Allocation ($${allocation.amount.toFixed(2)}) exceeds 95% of available cash ($${availableCash.toFixed(2)})`
    );
  }

  // Sanity check: allocation percent matches amount
  const expectedPercent = allocation.amount / portfolioValue;
  if (Math.abs(expectedPercent - allocation.percentOfPortfolio) > 0.01) {
    issues.push(
      `Allocation percentage (${(allocation.percentOfPortfolio * 100).toFixed(1)}%) doesn't match amount relative to portfolio value`
    );
  }

  return issues;
}

/**
 * Validate stop loss distance
 */
function validateStopLossDistance(plan: Plan): string[] {
  const issues: string[] = [];
  const entryPrice = plan.entry.price;

  if (entryPrice === null) {
    return [];
  }

  const stopDistance = Math.abs(entryPrice - plan.stopLoss.price) / entryPrice;

  if (stopDistance > MAX_STOP_LOSS_DISTANCE_PERCENT) {
    issues.push(
      `Stop loss distance (${(stopDistance * 100).toFixed(1)}%) exceeds maximum (${MAX_STOP_LOSS_DISTANCE_PERCENT * 100}%)`
    );
  }

  if (stopDistance < MIN_STOP_LOSS_DISTANCE_PERCENT) {
    issues.push(
      `Stop loss distance (${(stopDistance * 100).toFixed(1)}%) is below minimum (${MIN_STOP_LOSS_DISTANCE_PERCENT * 100}%)`
    );
  }

  return issues;
}

/**
 * Validate take profit structure
 */
function validateTakeProfitStructure(plan: Plan): string[] {
  const issues: string[] = [];
  const { takeProfit } = plan;

  if (takeProfit.length === 0) {
    issues.push("At least one take profit level is required");
    return issues;
  }

  // Check percentages sum to 1
  const totalPercent = takeProfit.reduce((sum, tp) => sum + tp.percentToSell, 0);
  if (Math.abs(totalPercent - 1.0) > 0.01) {
    issues.push(
      `Take profit percentages sum to ${(totalPercent * 100).toFixed(1)}% instead of 100%`
    );
  }

  // Check TP levels are in ascending order
  for (let i = 1; i < takeProfit.length; i++) {
    const prev = takeProfit[i - 1];
    const curr = takeProfit[i];
    if (prev && curr && curr.price <= prev.price) {
      issues.push("Take profit levels should be in ascending price order");
      break;
    }
  }

  return issues;
}

/**
 * Validate grid configuration (if present)
 */
function validateGridConfig(plan: Plan): string[] {
  const issues: string[] = [];
  const { grid } = plan;

  if (!grid) {
    if (plan.strategy === "grid_entry") {
      issues.push("Grid entry strategy requires grid configuration");
    }
    return issues;
  }

  // Check levels count
  if (grid.levels.length < 3) {
    issues.push("Grid should have at least 3 levels");
  }

  if (grid.levels.length > 7) {
    issues.push("Grid should have at most 7 levels");
  }

  // Check percentages sum to 1
  const totalPercent = grid.levels.reduce((sum, level) => sum + level.percentOfAllocation, 0);
  if (Math.abs(totalPercent - 1.0) > 0.01) {
    issues.push(
      `Grid level percentages sum to ${(totalPercent * 100).toFixed(1)}% instead of 100%`
    );
  }

  // Check levels are in descending order
  for (let i = 1; i < grid.levels.length; i++) {
    const prev = grid.levels[i - 1];
    const curr = grid.levels[i];
    if (prev && curr && curr.price >= prev.price) {
      issues.push("Grid levels should be in descending price order");
      break;
    }
  }

  // Check price range consistency
  if (grid.levels.length > 0) {
    const highestLevel = grid.levels[0];
    const lowestLevel = grid.levels[grid.levels.length - 1];
    if (highestLevel && Math.abs(highestLevel.price - grid.priceRange.high) > 0.01) {
      issues.push("Grid price range high doesn't match highest level");
    }
    if (lowestLevel && Math.abs(lowestLevel.price - grid.priceRange.low) > 0.01) {
      issues.push("Grid price range low doesn't match lowest level");
    }
  }

  return issues;
}

// ============================================================================
// Main Reflection Functions
// ============================================================================

/**
 * Perform rule-based reflection on a trade plan
 *
 * This is a fast, deterministic validation that checks structural correctness
 * of the plan without requiring an LLM call.
 */
export function reflectOnPlanRules(plan: Plan, context: GordonContext): ReflectionResult {
  const startTime = Date.now();
  const allIssues: string[] = [];

  // Run all validation checks
  const priceLevelIssues = validatePriceLevels(plan);
  const { issues: rrIssues, ratio } = validateRiskRewardRatio(plan);
  const allocationIssues = validateAllocation(plan, context);
  const stopLossIssues = validateStopLossDistance(plan);
  const tpIssues = validateTakeProfitStructure(plan);
  const gridIssues = validateGridConfig(plan);

  allIssues.push(
    ...priceLevelIssues,
    ...rrIssues,
    ...allocationIssues,
    ...stopLossIssues,
    ...tpIssues,
    ...gridIssues
  );

  // Generate suggestions for each issue
  const suggestions = allIssues.map((issue) => generateSuggestion(issue, plan));

  // Calculate confidence based on issue count
  const confidence = allIssues.length === 0 ? 1.0 : Math.max(0, 1 - allIssues.length * 0.15);

  const result: ReflectionResult = {
    isValid: allIssues.length === 0,
    issues: allIssues,
    suggestions,
    confidence,
    metadata: {
      durationMs: Date.now() - startTime,
      checksPerformed: 6, // Number of validation functions run
      usedLLM: false,
    },
  };

  logger.debug("Rule-based reflection completed", {
    planId: plan.id,
    isValid: result.isValid,
    issueCount: allIssues.length,
    rrRatio: ratio.toFixed(2),
  });

  return result;
}

/**
 * Generate a suggestion for fixing an issue
 */
function generateSuggestion(issue: string, plan: Plan): string {
  // Pattern-based suggestion generation
  if (issue.includes("Stop-loss") && issue.includes("below entry")) {
    const suggestedStop = plan.entry.price ? plan.entry.price * 0.95 : 0;
    return `Consider setting stop-loss at $${suggestedStop.toFixed(2)} (5% below entry)`;
  }

  if (issue.includes("Risk/reward ratio")) {
    return "Consider moving take profit targets higher or tightening stop loss to improve R:R";
  }

  if (issue.includes("Allocation") && issue.includes("exceeds")) {
    return "Reduce position size to stay within risk limits";
  }

  if (issue.includes("Stop loss distance") && issue.includes("exceeds")) {
    return "Consider a tighter stop loss or reconsider the entry point";
  }

  if (issue.includes("Stop loss distance") && issue.includes("below minimum")) {
    return "Consider a wider stop loss to avoid being stopped out by normal price fluctuation";
  }

  if (issue.includes("Take profit percentages")) {
    return "Adjust take profit percentages to sum to 100%";
  }

  if (issue.includes("Grid")) {
    return "Review grid configuration to ensure proper structure";
  }

  // Default suggestion
  return `Review and fix: ${issue}`;
}

/**
 * Perform LLM-based reflection on a trade plan
 *
 * This uses the LLM to perform semantic analysis of the plan,
 * checking for logical consistency and potential issues that
 * rule-based checks might miss.
 */
export async function reflectOnPlanWithLLM(
  plan: Plan,
  context: GordonContext,
  options: ReflectionOptions = {}
): Promise<ReflectionResult> {
  const startTime = Date.now();
  const { llm } = context;

  if (!llm) {
    logger.warn("LLM client not available, falling back to rule-based reflection");
    return reflectOnPlanRules(plan, context);
  }

  const systemPrompt = `You are a trading plan reviewer. Analyze the provided trade plan for:
1. Logical consistency (entry, stop loss, take profit levels make sense)
2. Risk management (R:R ratio, position sizing)
3. Strategy alignment (plan matches the stated strategy)
4. Potential contradictions or issues

Be concise and specific. Focus on actionable issues.

Respond with JSON in this exact format:
{
  "isValid": boolean,
  "issues": ["list of specific issues found"],
  "suggestions": ["list of specific suggestions to fix issues"],
  "confidence": number between 0 and 1,
  "reasoning": "brief explanation of your assessment"
}`;

  const userMessage = `Review this trade plan:

Symbol: ${plan.symbol}
Direction: ${plan.direction}
Strategy: ${plan.strategy}
Entry: ${plan.entry.type} at ${plan.entry.price ?? "market"}
Stop Loss: ${plan.stopLoss.price}
Take Profit Levels: ${plan.takeProfit.map((tp) => `$${tp.price} (${(tp.percentToSell * 100).toFixed(0)}%)`).join(", ")}
Allocation: $${plan.allocation.amount} (${(plan.allocation.percentOfPortfolio * 100).toFixed(1)}% of portfolio)
${plan.grid ? `Grid: ${plan.grid.levels.length} levels from $${plan.grid.priceRange.high} to $${plan.grid.priceRange.low}` : ""}
${plan.dca ? `DCA: ${plan.dca.length} levels` : ""}

Reasoning provided: ${plan.reasoning}

Portfolio Value: $${context.portfolioValue.toFixed(2)}
Available Cash: $${context.availableCash.toFixed(2)}
${options.additionalContext ? `\nAdditional Context: ${options.additionalContext}` : ""}

Analyze this plan and identify any issues.`;

  try {
    const response = await llm.chatWithJSON(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      LLMReflectionResultSchema
    );

    const result: ReflectionResult = {
      isValid: response.isValid,
      issues: response.issues,
      suggestions: response.suggestions,
      confidence: response.confidence,
      metadata: {
        durationMs: Date.now() - startTime,
        checksPerformed: 1,
        usedLLM: true,
      },
    };

    logger.debug("LLM reflection completed", {
      planId: plan.id,
      isValid: result.isValid,
      issueCount: response.issues.length,
      confidence: response.confidence,
    });

    return result;
  } catch (error) {
    logger.error("LLM reflection failed, falling back to rule-based", error as Error);
    return reflectOnPlanRules(plan, context);
  }
}

/**
 * Perform comprehensive reflection on a trade plan
 *
 * Combines rule-based and LLM-based reflection for thorough validation.
 * Rule-based checks run first (fast, deterministic), then LLM provides
 * semantic analysis if no critical issues are found.
 */
export async function reflectOnPlan(
  plan: Plan,
  context: GordonContext,
  options: ReflectionOptions = {}
): Promise<ReflectionResult> {
  const startTime = Date.now();

  // First, run rule-based checks
  const ruleResult = reflectOnPlanRules(plan, context);

  // If there are critical issues or LLM is skipped, return rule-based result
  if (!ruleResult.isValid || options.skipLLM) {
    await emitReflectionEvent(plan, ruleResult, "rules");
    return ruleResult;
  }

  // Run LLM reflection for semantic analysis
  const llmResult = await reflectOnPlanWithLLM(plan, context, options);

  // Combine results
  const combinedIssues = [...new Set([...ruleResult.issues, ...llmResult.issues])];
  const combinedSuggestions = [...new Set([...ruleResult.suggestions, ...llmResult.suggestions])];
  const combinedConfidence = (ruleResult.confidence + llmResult.confidence) / 2;

  const result: ReflectionResult = {
    isValid: combinedIssues.length === 0,
    issues: combinedIssues,
    suggestions: combinedSuggestions,
    confidence: combinedConfidence,
    metadata: {
      durationMs: Date.now() - startTime,
      checksPerformed: (ruleResult.metadata?.checksPerformed ?? 0) + (llmResult.metadata?.checksPerformed ?? 0),
      usedLLM: true,
    },
  };

  await emitReflectionEvent(plan, result, "combined");
  return result;
}

/**
 * Reflect on analysis content using LLM
 *
 * Use this for semantic validation of analysis text, checking for
 * contradictions, unsupported claims, or logical inconsistencies.
 */
export async function reflectOnAnalysis(
  analysisContent: string,
  context: GordonContext,
  options: ReflectionOptions = {}
): Promise<ReflectionResult> {
  const startTime = Date.now();
  const { llm } = context;

  if (!llm || options.skipLLM) {
    return {
      isValid: true,
      issues: [],
      suggestions: [],
      confidence: 0.5, // Lower confidence when LLM not used
      metadata: {
        durationMs: Date.now() - startTime,
        checksPerformed: 0,
        usedLLM: false,
      },
    };
  }

  const systemPrompt = `You are an analysis reviewer. Check the provided market analysis for:
1. Internal contradictions (e.g., bullish and bearish conclusions)
2. Unsupported claims (conclusions without evidence)
3. Missing context (important factors not considered)
4. Logical consistency

Be concise. Focus on factual issues, not style.

Respond with JSON:
{
  "isValid": boolean,
  "issues": ["list of issues"],
  "suggestions": ["list of suggestions"],
  "confidence": number 0-1,
  "reasoning": "brief explanation"
}`;

  const userMessage = `Review this market analysis:

${analysisContent}

${options.additionalContext ? `\nContext: ${options.additionalContext}` : ""}

Identify any contradictions, unsupported claims, or logical issues.`;

  try {
    const response = await llm.chatWithJSON(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      LLMReflectionResultSchema
    );

    return {
      isValid: response.isValid,
      issues: response.issues,
      suggestions: response.suggestions,
      confidence: response.confidence,
      metadata: {
        durationMs: Date.now() - startTime,
        checksPerformed: 1,
        usedLLM: true,
      },
    };
  } catch (error) {
    logger.error("Analysis reflection failed", error as Error);
    return {
      isValid: true,
      issues: [],
      suggestions: [],
      confidence: 0.3,
      metadata: {
        durationMs: Date.now() - startTime,
        checksPerformed: 0,
        usedLLM: false,
      },
    };
  }
}

/**
 * Generic LLM-based reflection for any content type
 */
export async function reflectWithLLM(
  content: string,
  contentType: "plan" | "analysis" | "strategy" | "custom",
  context: GordonContext,
  customPrompt?: string
): Promise<ReflectionResult> {
  const startTime = Date.now();
  const { llm } = context;

  if (!llm) {
    return {
      isValid: true,
      issues: [],
      suggestions: [],
      confidence: 0.5,
      metadata: {
        durationMs: Date.now() - startTime,
        checksPerformed: 0,
        usedLLM: false,
      },
    };
  }

  const prompts: Record<string, string> = {
    plan: "You are reviewing a trading plan for logical consistency and risk management.",
    analysis: "You are reviewing market analysis for contradictions and unsupported claims.",
    strategy: "You are reviewing a trading strategy for clarity and feasibility.",
    custom: customPrompt ?? "You are reviewing content for quality and consistency.",
  };

  const systemPrompt = `${prompts[contentType]}

Respond with JSON:
{
  "isValid": boolean,
  "issues": ["list of issues"],
  "suggestions": ["list of suggestions"],
  "confidence": number 0-1,
  "reasoning": "brief explanation"
}`;

  try {
    const response = await llm.chatWithJSON(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `Review this content:\n\n${content}` },
      ],
      LLMReflectionResultSchema
    );

    return {
      isValid: response.isValid,
      issues: response.issues,
      suggestions: response.suggestions,
      confidence: response.confidence,
      metadata: {
        durationMs: Date.now() - startTime,
        checksPerformed: 1,
        usedLLM: true,
      },
    };
  } catch (error) {
    logger.error("Generic reflection failed", error as Error);
    return {
      isValid: true,
      issues: [],
      suggestions: [],
      confidence: 0.3,
      metadata: {
        durationMs: Date.now() - startTime,
        checksPerformed: 0,
        usedLLM: false,
      },
    };
  }
}

// ============================================================================
// Event Emission
// ============================================================================

/**
 * Emit reflection event for observability
 */
async function emitReflectionEvent(
  plan: Plan,
  result: ReflectionResult,
  method: "rules" | "llm" | "combined"
): Promise<void> {
  const analysis = result.isValid
    ? `Plan ${plan.id} passed reflection (confidence: ${(result.confidence * 100).toFixed(0)}%)`
    : `Plan ${plan.id} has ${result.issues.length} issue(s): ${result.issues.join("; ")}`;

  await emitEvent("agent:reflection", {
    agent: "planner",
    analysis,
    adjustments: result.suggestions.length > 0 ? result.suggestions : undefined,
  });

  logger.info("Reflection completed", {
    planId: plan.id,
    method,
    isValid: result.isValid,
    issueCount: result.issues.length,
    confidence: result.confidence,
    durationMs: result.metadata?.durationMs,
  });
}

// ============================================================================
// Utility Functions
// ============================================================================

/**
 * Quick validation check for a plan (rule-based only)
 * Use this for fast pre-flight checks before expensive operations.
 */
export function quickValidatePlan(plan: Plan, context: GordonContext): boolean {
  const result = reflectOnPlanRules(plan, context);
  return result.isValid;
}

/**
 * Get a summary of reflection result suitable for display
 */
export function formatReflectionSummary(result: ReflectionResult): string {
  if (result.isValid) {
    return `Validation passed (${(result.confidence * 100).toFixed(0)}% confidence)`;
  }

  const issuesSummary = result.issues.slice(0, 3).join("\n- ");
  const moreIssues = result.issues.length > 3 ? `\n... and ${result.issues.length - 3} more` : "";

  return `Validation failed with ${result.issues.length} issue(s):\n- ${issuesSummary}${moreIssues}`;
}
