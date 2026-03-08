/**
 * Trading Tools (Mastra Format)
 * Tools for creating, managing, and executing trading plans
 *
 * Migrated from OpenAI Agents SDK format to Mastra format.
 * Key changes:
 * - tool() -> createTool()
 * - name -> id
 * - parameters -> inputSchema
 * - Context access via execContext.requestContext.get() using getGordonContext helper
 * - needsApproval removed (handle via guardrails in Mastra)
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { generatePlan } from "../../../core/planner.ts";
import { executePlan, closeTrade, closePartialPosition } from "../../../core/executor.ts";
import { analyze } from "../../../core/analyzer.ts";
import { calculateGridLevels } from "../../../core/grid-calculator.ts";
import {
  getTrailingStopTracker,
  type TrailingStopConfig,
} from "../../../core/trailing-stop.ts";
import { PlanSchema } from "../../../types/plan.ts";
import { TradeSchema } from "../../../types/trade.ts";
import { loadConfig, saveConfig } from "../../storage/config.ts";
import { listPlans, getPlan, updatePlan, createPlan } from "../../storage/plans.ts";
import { listTrades, getTrade } from "../../storage/trades.ts";
import { getGordonContext, normalizeSymbol, validateToolOutput, type MastraExecutionContext } from "./types.ts";
import { reflectOnPlan, formatReflectionSummary } from "../reflection.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noExchange: { error: "Exchange client not connected. Please configure an active exchange." },
  noLLM: { error: "LLM client not connected." },
  noContext: { error: "Context not available." },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

const getActiveTrades = () => listTrades({ status: "OPEN" });

// ============================================================================
// Output Schemas (extracted for validation reuse)
// ============================================================================

const createPlanOutputSchema = z.object({
  success: z.boolean().optional(),
  plan: PlanSchema.optional(),
  summary: z.string().optional(),
  error: z.string().optional(),
  reflection: z.object({
    isValid: z.boolean(),
    issues: z.array(z.string()),
    suggestions: z.array(z.string()),
    confidence: z.number(),
  }).optional(),
  warnings: z.array(z.string()).optional(),
});

const executePlanOutputSchema = z.object({
  success: z.boolean(),
  trade: TradeSchema.optional(),
  orderCount: z.number().optional(),
  error: z.string().optional(),
});

const closeTradeOutputSchema = z.object({
  success: z.boolean(),
  pnl: z.number().optional(),
  error: z.string().optional(),
});

const listPlansOutputSchema = z.object({
  count: z.number(),
  plans: z.array(z.object({
    id: z.string(),
    symbol: z.string(),
    strategy: z.string(),
    status: z.string(),
    allocation: z.number(),
    entry: z.union([z.number(), z.string()]),
    stopLoss: z.number(),
    createdAt: z.string(),
  })),
});

const approvePlanOutputSchema = z.object({
  success: z.boolean(),
  planId: z.string().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const armSystemOutputSchema = z.object({
  success: z.boolean(),
  mode: z.enum(["ARMED", "SAFE"]).optional(),
  armedUntil: z.string().optional().nullable(),
  message: z.string(),
  error: z.string().optional(),
});

const createGridPlanOutputSchema = z.object({
  success: z.boolean().optional(),
  planPreview: z.object({
    symbol: z.string(),
    strategy: z.string(),
    grid: z.object({
      levels: z.array(z.object({
        price: z.number(),
        percentOfAllocation: z.number(),
      })),
      distribution: z.enum(["pyramid", "equal"]),
      priceRange: z.object({
        high: z.number(),
        low: z.number(),
      }),
    }),
    stopLoss: z.number(),
    takeProfits: z.array(z.number()),
    allocation: z.object({
      amount: z.number(),
      percentOfPortfolio: z.number(),
    }),
    weightedEntry: z.number(),
  }).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
  reflection: z.object({
    isValid: z.boolean(),
    issues: z.array(z.string()),
    suggestions: z.array(z.string()),
    confidence: z.number(),
  }).optional(),
  warnings: z.array(z.string()).optional(),
});

const setTrailingStopOutputSchema = z.object({
  success: z.boolean(),
  trailingStop: z.object({
    id: z.string(),
    tradeId: z.string(),
    symbol: z.string(),
    type: z.enum(["percentage", "atr"]),
    trailDistance: z.number(),
    activationPrice: z.number().optional(),
    isActive: z.boolean(),
    currentStopPrice: z.number(),
    highestPrice: z.number(),
  }).optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const updateTrailingStopOutputSchema = z.object({
  success: z.boolean(),
  updated: z.boolean().optional(),
  previousStopPrice: z.number().optional(),
  newStopPrice: z.number().optional(),
  highestPrice: z.number().optional(),
  shouldTrigger: z.boolean().optional(),
  currentPrice: z.number().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

const closePartialPositionOutputSchema = z.object({
  success: z.boolean(),
  closedQuantity: z.number().optional(),
  remainingQuantity: z.number().optional(),
  exitPrice: z.number().optional(),
  pnl: z.number().optional(),
  message: z.string().optional(),
  error: z.string().optional(),
});

// ============================================================================
// Plan Generation Tool
// ============================================================================

export const createPlanTool = createTool({
  id: "create_plan",
  description:
    "Create a trading plan for a specific coin based on analysis. " +
    "Use this when the user wants to trade a coin, e.g., 'buy BTC' or 'create plan for ETH'",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    riskLevel: z
      .enum(["low", "medium", "high"])
      .default("medium")
      .describe("Risk tolerance"),
    allocationPercent: z
      .number()
      .min(0.01)
      .max(0.5)
      .default(0.1)
      .describe("Percent of portfolio to allocate"),
    strategyId: z
      .enum([
        "support_bounce",
        "bollinger_bounce",
        "sma_crossover",
        "volume_surge",
        "vwap_bounce",
        "consolidation_pop",
        "adx_trend",
        "ema_rsi_crossover",
        "relative_strength",
        "engulfing_pattern",
      ])
      .optional()
      .describe("Specific strategy to use (auto-detected if not specified)"),
  }),
  outputSchema: createPlanOutputSchema,
  execute: async ({ symbol, riskLevel, allocationPercent, strategyId }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange || !ctx?.llm) {
      return validateToolOutput(createPlanOutputSchema, { error: "Exchange or LLM client not connected." }, { toolName: "create_plan" });
    }

    // Normalize symbol
    const normalizedSymbol = normalizeSymbol(symbol);

    // Get detailed analysis first
    const analysis = await analyze(ctx.exchange, normalizedSymbol, {
      timeframes: ["1h", "4h", "1d"],
    });

    // Calculate allocation
    const maxAllocationPercent = allocationPercent ?? ctx.config.preferences.maxAllocationPerTrade;
    const maxAllocation = ctx.portfolioValue * maxAllocationPercent;

    // Generate plan using AI
    const plan = await generatePlan(ctx.llm, {
      analysis,
      preferences: {
        riskLevel: riskLevel ?? "medium",
        maxAllocation,
        cashReservePercent: ctx.config.preferences.cashReservePercent,
      },
      portfolioValue: ctx.portfolioValue,
    });

    // Perform reflection on the generated plan
    const reflectionResult = await reflectOnPlan(plan, ctx, { skipLLM: false });

    // Build result with reflection information
    const baseSummary = `Created ${plan.strategy} plan for ${plan.symbol}: Entry at ${plan.entry.price ?? "market"}, Stop at ${plan.stopLoss.price}, ${plan.takeProfit.length} TP levels. Allocation: ${plan.allocation.amount} USDT (${(plan.allocation.percentOfPortfolio * 100).toFixed(1)}%)`;

    const reflectionSummary = formatReflectionSummary(reflectionResult);

    const result = {
      success: reflectionResult.isValid,
      plan,
      summary: reflectionResult.isValid
        ? `${baseSummary}\n\nReflection: ${reflectionSummary}`
        : `${baseSummary}\n\nWARNING - ${reflectionSummary}`,
      reflection: {
        isValid: reflectionResult.isValid,
        issues: reflectionResult.issues,
        suggestions: reflectionResult.suggestions,
        confidence: reflectionResult.confidence,
      },
      warnings: reflectionResult.issues.length > 0 ? reflectionResult.issues : undefined,
    };

    return validateToolOutput(createPlanOutputSchema, result, { toolName: "create_plan" });
  },
});

// ============================================================================
// Plan Execution Tool
// Note: needsApproval removed - handle via guardrails in Mastra
// ============================================================================

export const executePlanTool = createTool({
  id: "execute_plan",
  description:
    "Execute an approved trading plan by placing orders on the active exchange. " +
    "IMPORTANT: This places real orders with real money. Only use after user confirms the plan.",
  inputSchema: z.object({
    planId: z.string().describe("The ID of the plan to execute"),
  }),
  outputSchema: executePlanOutputSchema,
  execute: async ({ planId }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(executePlanOutputSchema, { ...errors.noExchange, success: false }, { toolName: "execute_plan" });
    }

    const plan = getPlan(planId);
    if (!plan) {
      return validateToolOutput(executePlanOutputSchema, { success: false, error: `Plan not found: ${planId}` }, { toolName: "execute_plan" });
    }

    if (ctx.config.mode !== "ARMED") {
      return validateToolOutput(executePlanOutputSchema, {
        success: false,
        error: "Cannot execute: System is in SAFE mode. User must arm the system first.",
      }, { toolName: "execute_plan" });
    }

    // Risk gate: evaluate the plan's order against risk kernel
    try {
      const { evaluateOrderRisk } = await import("./risk-gate.ts");
      const riskResult = await evaluateOrderRisk(
        {
          symbol: plan.symbol,
          side: "BUY", // Plans are typically buy entries
          type: plan.entry.type === "market" ? "MARKET" : "LIMIT",
          quantity: plan.allocation.amount / (plan.entry.price || 1),
          price: plan.entry.price ?? undefined,
        },
        ctx,
        "executor"
      );
      if (!riskResult.approved) {
        return validateToolOutput(executePlanOutputSchema, {
          success: false,
          error: `Risk kernel rejected this trade: ${riskResult.reason}`,
        }, { toolName: "execute_plan" });
      }
    } catch (riskErr) {
      return validateToolOutput(
        executePlanOutputSchema,
        {
          success: false,
          error: `Risk gate evaluation failed: ${riskErr instanceof Error ? riskErr.message : String(riskErr)}`,
        },
        { toolName: "execute_plan" },
      );
    }

    const result = await executePlan(ctx.exchange, plan, ctx.config, {
      totalValue: ctx.portfolioValue,
      availableCash: ctx.availableCash,
      openPositions: getActiveTrades().length,
    });

    if (result.success && result.trade) {
      return validateToolOutput(executePlanOutputSchema, {
        success: true,
        trade: result.trade,
        orderCount: result.orders.length,
      }, { toolName: "execute_plan" });
    }

    return validateToolOutput(executePlanOutputSchema, {
      success: false,
      error: result.error,
    }, { toolName: "execute_plan" });
  },
});

// ============================================================================
// Close Trade Tool
// Note: needsApproval removed - handle via guardrails in Mastra
// ============================================================================

export const closeTradeTool = createTool({
  id: "close_trade",
  description:
    "Close an open trade by selling all remaining position. " +
    "Use when user wants to exit a trade early, e.g., 'close my BTC trade'",
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the trade to close"),
    reason: z
      .enum(["MANUAL", "STOP", "TP1", "TP2", "TP3"])
      .default("MANUAL")
      .describe("Reason for closing"),
  }),
  outputSchema: closeTradeOutputSchema,
  execute: async ({ tradeId, reason }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(closeTradeOutputSchema, { ...errors.noExchange, success: false }, { toolName: "close_trade" });
    }

    const trade = getTrade(tradeId);
    if (!trade) {
      return validateToolOutput(closeTradeOutputSchema, { success: false, error: `Trade not found: ${tradeId}` }, { toolName: "close_trade" });
    }

    const result = await closeTrade(ctx.exchange, trade, reason ?? "MANUAL");

    return validateToolOutput(closeTradeOutputSchema, {
      success: result.success,
      pnl: result.pnl,
      error: result.error,
    }, { toolName: "close_trade" });
  },
});

// ============================================================================
// List Plans Tool
// ============================================================================

export const listPlansTool = createTool({
  id: "list_plans",
  description:
    "List all trading plans, optionally filtered by status. " +
    "Use when user asks 'show my plans' or 'what plans do I have?'",
  inputSchema: z.object({
    status: z
      .enum(["DRAFT", "APPROVED", "EXECUTING", "CLOSED", "CANCELLED", "ALL"])
      .default("ALL")
      .describe("Filter by status (ALL for no filter)"),
    limit: z.number().min(1).max(50).default(10).describe("Max plans to return"),
  }),
  outputSchema: listPlansOutputSchema,
  execute: async ({ status, limit }) => {
    let plans = listPlans();

    if (status && status !== "ALL") {
      plans = plans.filter((p) => p.status === status);
    }

    plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    const result = {
      count: plans.length,
      plans: plans.slice(0, limit ?? 10).map((p) => ({
        id: p.id,
        symbol: p.symbol,
        strategy: p.strategy,
        status: p.status,
        allocation: p.allocation.amount,
        entry: p.entry.price ?? "market",
        stopLoss: p.stopLoss.price,
        createdAt: p.createdAt,
      })),
    };

    return validateToolOutput(listPlansOutputSchema, result, { toolName: "list_plans" });
  },
});

// ============================================================================
// Approve Plan Tool
// ============================================================================

export const approvePlanTool = createTool({
  id: "approve_plan",
  description:
    "Approve a draft plan, marking it ready for execution. " +
    "Use when user says 'approve this plan' or 'looks good, approve it'",
  inputSchema: z.object({
    planId: z.string().describe("The ID of the plan to approve"),
  }),
  outputSchema: approvePlanOutputSchema,
  execute: async ({ planId }) => {
    const plan = getPlan(planId);
    if (!plan) {
      return validateToolOutput(approvePlanOutputSchema, { success: false, error: `Plan not found: ${planId}` }, { toolName: "approve_plan" });
    }

    if (plan.status !== "DRAFT") {
      return validateToolOutput(approvePlanOutputSchema, { success: false, error: `Plan is not in DRAFT status, current status: ${plan.status}` }, { toolName: "approve_plan" });
    }

    updatePlan(planId, { status: "APPROVED" });

    return validateToolOutput(approvePlanOutputSchema, {
      success: true,
      planId,
      message: "Plan approved. Ready for execution when system is armed.",
    }, { toolName: "approve_plan" });
  },
});

// ============================================================================
// Arm/Disarm System Tool
// Note: needsApproval removed - handle via guardrails in Mastra
// ============================================================================

export const armSystemTool = createTool({
  id: "arm_system",
  description:
    "Arm or disarm the trading system. When armed, Gordon can execute trades. " +
    "Use when user says 'arm' or 'enable trading' or 'disarm' or 'disable trading'",
  inputSchema: z.object({
    action: z.enum(["arm", "disarm"]).describe("Whether to arm or disarm"),
    hours: z
      .number()
      .min(1)
      .max(24)
      .default(24)
      .describe("Hours to stay armed (max: 24)"),
  }),
  outputSchema: armSystemOutputSchema,
  execute: async ({ action, hours }) => {
    const config = await loadConfig();

    if (action === "arm") {
      const armHours = Math.min(hours ?? 24, 24);
      const armedUntil = new Date(Date.now() + armHours * 60 * 60 * 1000).toISOString();

      await saveConfig({ ...config, mode: "ARMED", armedUntil });

      return validateToolOutput(armSystemOutputSchema, {
        success: true,
        mode: "ARMED" as const,
        armedUntil,
        message: `System armed for ${armHours} hours. Trading enabled.`,
      }, { toolName: "arm_system" });
    } else {
      await saveConfig({ ...config, mode: "SAFE", armedUntil: null });

      return validateToolOutput(armSystemOutputSchema, {
        success: true,
        mode: "SAFE" as const,
        armedUntil: null,
        message: "System disarmed. Trading disabled.",
      }, { toolName: "arm_system" });
    }
  },
});

// ============================================================================
// Create Grid Plan Tool
// ============================================================================

export const createGridPlanTool = createTool({
  id: "create_grid_plan",
  description: `Create a grid entry plan for a symbol. Grid entry places multiple buy orders at descending price levels across support zones.

Use grid entry when:
- Market is ranging or uncertain
- User wants to accumulate over a price range
- Multiple support levels are identified
- User says "grid", "layered entry", "spread buys"

Returns a grid plan for user approval.`,
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol, e.g., ETHUSDT"),
    allocation: z.number().optional().describe("Amount in USDT to allocate (uses default if not specified)"),
    numLevels: z.number().min(3).max(7).optional().describe("Number of grid levels (default: 5)"),
    distribution: z.enum(["pyramid", "equal"]).optional().describe("Allocation distribution (default: pyramid)"),
  }),
  outputSchema: createGridPlanOutputSchema,
  execute: async ({ symbol, allocation, numLevels, distribution }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(createGridPlanOutputSchema, { error: "Exchange client not connected. Please configure API keys." }, { toolName: "create_grid_plan" });
    }

    // Normalize symbol
    const normalizedSymbol = normalizeSymbol(symbol);

    // Analyze the symbol to get support/resistance levels
    const analysis = await analyze(ctx.exchange, normalizedSymbol, {
      timeframes: ["1h", "4h"],
    });

    if (analysis.supports.length === 0) {
      return validateToolOutput(createGridPlanOutputSchema, {
        success: false,
        error: `No support levels found for ${normalizedSymbol}. Cannot create grid plan.`,
      }, { toolName: "create_grid_plan" });
    }

    // Calculate allocation amount
    const defaultAllocationPercent = ctx.config.preferences.maxAllocationPerTrade;
    const allocationAmount = allocation ?? ctx.portfolioValue * defaultAllocationPercent;
    const percentOfPortfolio = allocationAmount / ctx.portfolioValue;

    // Calculate grid levels using grid-calculator
    const gridResult = calculateGridLevels({
      supports: analysis.supports,
      currentPrice: analysis.price,
      numLevels: numLevels ?? 5,
      distribution: distribution ?? "pyramid",
      allocation: allocationAmount,
    });

    // Extract take profits from resistance levels (first 2)
    const takeProfits = analysis.resistances
      .slice(0, 2)
      .map(r => r.price);

    // Build take profit levels with percentages
    const takeProfitLevels = takeProfits.map((price, i) => ({
      price,
      percentToSell: i === takeProfits.length - 1
        ? 1 - (takeProfits.length - 1) * 0.5 // Last TP gets remaining
        : 0.5, // First TP gets 50%
    }));

    // Create and persist the plan to the database
    const savedPlan = createPlan({
      symbol: normalizedSymbol,
      direction: "long" as const,
      strategy: "grid_entry" as const,
      allocation: {
        currency: "USDT" as const,
        amount: allocationAmount,
        percentOfPortfolio,
      },
      entry: {
        type: "limit" as const,
        price: gridResult.config.priceRange.high, // Highest grid level
      },
      dca: null,
      grid: gridResult.config,
      stopLoss: {
        price: gridResult.stopLossPrice,
      },
      takeProfit: takeProfitLevels,
      reasoning: `Grid entry plan with ${gridResult.levels.length} levels using ${distribution ?? "pyramid"} distribution. Price range: $${gridResult.config.priceRange.high.toFixed(2)} to $${gridResult.config.priceRange.low.toFixed(2)}. Weighted entry if all fill: $${gridResult.weightedEntryIfAllFill.toFixed(2)}`,
      status: "DRAFT" as const,
    });

    // Build plan preview for response
    const planPreview = {
      symbol: normalizedSymbol,
      strategy: "grid_entry",
      grid: gridResult.config,
      stopLoss: gridResult.stopLossPrice,
      takeProfits,
      allocation: {
        amount: allocationAmount,
        percentOfPortfolio,
      },
      weightedEntry: gridResult.weightedEntryIfAllFill,
    };

    // Perform reflection on the saved plan (rule-based only for grid plans since no LLM context)
    const reflectionResult = await reflectOnPlan(savedPlan, ctx, { skipLLM: true });

    const levelsSummary = gridResult.levels
      .map((l, i) => `L${i + 1}: $${l.price.toFixed(2)} (${(l.percentOfAllocation * 100).toFixed(1)}%)`)
      .join(", ");

    const baseMessage = `Grid plan created (ID: ${savedPlan.id}) for ${normalizedSymbol}: ${gridResult.levels.length} levels from $${gridResult.config.priceRange.high.toFixed(2)} to $${gridResult.config.priceRange.low.toFixed(2)}. ${levelsSummary}. Stop loss at $${gridResult.stopLossPrice.toFixed(2)}. Allocation: $${allocationAmount.toFixed(2)} (${(percentOfPortfolio * 100).toFixed(1)}% of portfolio). Use 'approve_plan' with ID ${savedPlan.id} to approve.`;

    const reflectionSummary = formatReflectionSummary(reflectionResult);

    const result = {
      success: reflectionResult.isValid,
      planPreview,
      message: reflectionResult.isValid
        ? `${baseMessage}\n\nReflection: ${reflectionSummary}`
        : `${baseMessage}\n\nWARNING - ${reflectionSummary}`,
      reflection: {
        isValid: reflectionResult.isValid,
        issues: reflectionResult.issues,
        suggestions: reflectionResult.suggestions,
        confidence: reflectionResult.confidence,
      },
      warnings: reflectionResult.issues.length > 0 ? reflectionResult.issues : undefined,
    };

    return validateToolOutput(createGridPlanOutputSchema, result, { toolName: "create_grid_plan" });
  },
});

// ============================================================================
// Trailing Stop Tools
// ============================================================================

export const setTrailingStopTool = createTool({
  id: "set_trailing_stop",
  description: `Set a trailing stop for an open trade. The trailing stop will adjust upward as price rises, locking in profits.

Use when:
- User wants to protect profits on an open trade
- User says "set trailing stop", "add trailing stop", "protect profits"
- User wants dynamic stop loss that follows price

Supports:
- Percentage-based trailing (e.g., 3% below high)
- ATR-based trailing (e.g., 2x ATR below high)
- Optional activation price (trailing starts after this price)`,
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the trade to set trailing stop for"),
    type: z.enum(["percentage", "atr"]).default("percentage").describe("Type of trailing: 'percentage' or 'atr'"),
    trailDistance: z.number().describe("Trail distance - percentage (e.g., 0.03 for 3%) or ATR multiplier (e.g., 2.0)"),
    activationPrice: z.number().optional().describe("Price at which trailing stop activates (optional, immediate if not set)"),
  }),
  outputSchema: setTrailingStopOutputSchema,
  execute: async ({ tradeId, type, trailDistance, activationPrice }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(setTrailingStopOutputSchema, {
        success: false,
        error: "Exchange client not connected.",
      }, { toolName: "set_trailing_stop" });
    }

    // Get the trade
    const trade = getTrade(tradeId);
    if (!trade) {
      return validateToolOutput(setTrailingStopOutputSchema, {
        success: false,
        error: `Trade not found: ${tradeId}`,
      }, { toolName: "set_trailing_stop" });
    }

    if (trade.status === "CLOSED") {
      return validateToolOutput(setTrailingStopOutputSchema, {
        success: false,
        error: "Cannot set trailing stop on a closed trade.",
      }, { toolName: "set_trailing_stop" });
    }

    // Get current price for initial high
    const currentPrice = await ctx.exchange.getPrice(trade.symbol);

    // Get trailing stop tracker
    const tracker = getTrailingStopTracker();

    // Check if trailing stop already exists
    const existing = tracker.getTrailingStop(tradeId);
    if (existing) {
      return validateToolOutput(setTrailingStopOutputSchema, {
        success: false,
        error: `Trailing stop already exists for trade ${tradeId}. Use update_trailing_stop to modify it.`,
      }, { toolName: "set_trailing_stop" });
    }

    // Add trailing stop
    const trailingStop = tracker.addTrailingStop({
      tradeId,
      symbol: trade.symbol,
      type: type ?? "percentage",
      trailDistance,
      activationPrice,
      initialHighPrice: currentPrice,
    });

    const result = {
      success: true,
      trailingStop: {
        id: trailingStop.id,
        tradeId: trailingStop.tradeId,
        symbol: trailingStop.symbol,
        type: trailingStop.type,
        trailDistance: trailingStop.trailDistance,
        activationPrice: trailingStop.activationPrice,
        isActive: trailingStop.isActive,
        currentStopPrice: trailingStop.currentStopPrice,
        highestPrice: trailingStop.highestPrice,
      },
      message: `Trailing stop set for ${trade.symbol}: ${type === "atr" ? `${trailDistance}x ATR` : `${(trailDistance * 100).toFixed(1)}%`} trail${activationPrice ? ` (activates at $${activationPrice})` : " (active immediately)"}`,
    };

    return validateToolOutput(setTrailingStopOutputSchema, result, { toolName: "set_trailing_stop" });
  },
});

export const updateTrailingStopTool = createTool({
  id: "update_trailing_stop",
  description: `Update and check status of a trailing stop. Returns current stop price, highest price, and whether stop should trigger.

Use when:
- User asks to check trailing stop status
- User wants to modify trailing stop parameters
- Part of monitor cycle to update all trailing stops`,
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the trade with trailing stop"),
    newTrailDistance: z.number().optional().describe("New trail distance (optional, updates if provided)"),
  }),
  outputSchema: updateTrailingStopOutputSchema,
  execute: async ({ tradeId, newTrailDistance }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(updateTrailingStopOutputSchema, {
        success: false,
        error: "Exchange client not connected.",
      }, { toolName: "update_trailing_stop" });
    }

    const tracker = getTrailingStopTracker();
    const trailingStop = tracker.getTrailingStop(tradeId);

    if (!trailingStop) {
      return validateToolOutput(updateTrailingStopOutputSchema, {
        success: false,
        error: `No trailing stop found for trade: ${tradeId}`,
      }, { toolName: "update_trailing_stop" });
    }

    // Update trail distance if provided
    if (newTrailDistance !== undefined) {
      // We need to access the internal state - for now just note this limitation
      // In production, we'd add a method to TrailingStopTracker for this
    }

    // Update the trailing stop with current price
    try {
      const updateResult = await tracker.updateTrailingStop(ctx.exchange, tradeId);

      const result = {
        success: true,
        updated: updateResult.updated,
        previousStopPrice: updateResult.previousStopPrice,
        newStopPrice: updateResult.newStopPrice,
        highestPrice: updateResult.highestPrice,
        shouldTrigger: updateResult.shouldTrigger,
        currentPrice: updateResult.currentPrice,
        message: updateResult.shouldTrigger
          ? `ALERT: Trailing stop triggered! Current price $${updateResult.currentPrice.toFixed(2)} is below stop $${updateResult.newStopPrice.toFixed(2)}`
          : updateResult.updated
            ? `Trailing stop updated: New stop at $${updateResult.newStopPrice.toFixed(2)} (highest: $${updateResult.highestPrice.toFixed(2)})`
            : `Trailing stop unchanged: Stop at $${updateResult.newStopPrice.toFixed(2)}, current price $${updateResult.currentPrice.toFixed(2)}`,
      };

      return validateToolOutput(updateTrailingStopOutputSchema, result, { toolName: "update_trailing_stop" });
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : "Unknown error";
      return validateToolOutput(updateTrailingStopOutputSchema, {
        success: false,
        error: errorMessage,
      }, { toolName: "update_trailing_stop" });
    }
  },
});

// ============================================================================
// Partial Position Close Tool
// ============================================================================

export const closePartialPositionTool = createTool({
  id: "close_partial_position",
  description: `Close a portion of an open position. Supports tier-based exits like TP1 (50%), TP2 (30%), TP3 (20%).

Use when:
- User wants to take partial profits
- User says "close half", "take some profits", "sell 30%"
- Tier-based take profit execution`,
  inputSchema: z.object({
    tradeId: z.string().describe("The ID of the trade to partially close"),
    percentage: z.number().min(0.01).max(1).describe("Percentage of remaining position to close (0.01 to 1.0)"),
    reason: z.enum(["TP1", "TP2", "TP3", "MANUAL"]).default("MANUAL").describe("Reason for partial close"),
  }),
  outputSchema: closePartialPositionOutputSchema,
  execute: async ({ tradeId, percentage, reason }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(closePartialPositionOutputSchema, {
        success: false,
        error: "Exchange client not connected.",
      }, { toolName: "close_partial_position" });
    }

    const closeResult = await closePartialPosition(
      ctx.exchange,
      tradeId,
      percentage,
      reason ?? "MANUAL"
    );

    if (closeResult.success) {
      const result = {
        success: true,
        closedQuantity: closeResult.closedQuantity,
        remainingQuantity: closeResult.remainingQuantity,
        exitPrice: closeResult.exitPrice,
        pnl: closeResult.pnl,
        message: `Closed ${(percentage * 100).toFixed(0)}% of position (${closeResult.closedQuantity.toFixed(6)} units) at $${closeResult.exitPrice.toFixed(2)}. PnL: $${closeResult.pnl.toFixed(2)}. Remaining: ${closeResult.remainingQuantity.toFixed(6)} units.`,
      };
      return validateToolOutput(closePartialPositionOutputSchema, result, { toolName: "close_partial_position" });
    }

    return validateToolOutput(closePartialPositionOutputSchema, {
      success: false,
      error: closeResult.error,
    }, { toolName: "close_partial_position" });
  },
});

// ============================================================================
// Algorithmic Execution Tool
// ============================================================================

import { ExecutionSessionManager } from "../../../core/execution/session-manager.ts";
import { parseExecutionIntent, describeIntent } from "../../../core/execution/intent-parser.ts";

const executeWithAlgorithmOutputSchema = z.object({
  success: z.boolean(),
  sessionId: z.string().optional(),
  algorithm: z.string().optional(),
  description: z.string().optional(),
  slicesTotal: z.number().optional(),
  estimatedDuration: z.string().optional(),
  error: z.string().optional(),
});

export const executeWithAlgorithmTool = createTool({
  id: "execute_with_algorithm",
  description:
    "Execute a large order using an algorithmic execution strategy (TWAP, VWAP, or Iceberg). " +
    "Use when the user wants to buy/sell slowly, minimize market impact, hide order size, " +
    "or explicitly requests TWAP/VWAP/Iceberg. Examples: 'buy 1 BTC slowly over 4 hours', " +
    "'accumulate ETH matching volume', 'sell without moving the market'.",
  inputSchema: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]).describe("Order side"),
    quantity: z.number().describe("Total quantity to execute"),
    algorithm: z.enum(["TWAP", "VWAP", "ICEBERG"]).optional().describe("Execution algorithm (auto-detected if not specified)"),
    description: z.string().optional().describe("Natural language description for algorithm detection (e.g., 'slowly over 4 hours')"),
    durationMs: z.number().optional().describe("Duration in milliseconds for TWAP/VWAP"),
  }),
  outputSchema: executeWithAlgorithmOutputSchema,
  execute: async ({ symbol, side, quantity, algorithm, description, durationMs }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.exchange) {
      return validateToolOutput(executeWithAlgorithmOutputSchema, {
        success: false,
        error: "Exchange client not connected.",
      }, { toolName: "execute_with_algorithm" });
    }

    if (ctx.config?.mode !== "ARMED") {
      return validateToolOutput(executeWithAlgorithmOutputSchema, {
        success: false,
        error: "System must be ARMED to execute algorithmic orders.",
      }, { toolName: "execute_with_algorithm" });
    }

    // Normalize symbol
    const normalizedSymbol = normalizeSymbol(symbol);

    // Build execution intent
    const intent = parseExecutionIntent(
      description ?? algorithm ?? "slowly",
      normalizedSymbol,
      side,
      quantity,
    );

    // Override algorithm if explicitly specified
    if (algorithm) {
      intent.algorithm = algorithm;
    }

    // Override duration if specified
    if (durationMs && "durationMs" in intent.config) {
      (intent.config as { durationMs: number }).durationMs = durationMs;
    }

    try {
      const manager = ExecutionSessionManager.getInstance();
      const session = await manager.startSession(intent, ctx.exchange);

      const desc = describeIntent(intent);
      const durationHours = "durationMs" in intent.config
        ? ((intent.config as { durationMs: number }).durationMs / (60 * 60 * 1000)).toFixed(1) + "h"
        : "N/A";

      return validateToolOutput(executeWithAlgorithmOutputSchema, {
        success: true,
        sessionId: session.sessionId,
        algorithm: intent.algorithm,
        description: desc,
        slicesTotal: session.slicesTotal,
        estimatedDuration: durationHours,
      }, { toolName: "execute_with_algorithm" });
    } catch (err) {
      return validateToolOutput(executeWithAlgorithmOutputSchema, {
        success: false,
        error: `Algorithmic execution failed: ${(err as Error).message}`,
      }, { toolName: "execute_with_algorithm" });
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Trading tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const tradingTools = {
  create_plan: createPlanTool,
  execute_plan: executePlanTool,
  close_trade: closeTradeTool,
  list_plans: listPlansTool,
  approve_plan: approvePlanTool,
  arm_system: armSystemTool,
  create_grid_plan: createGridPlanTool,
  set_trailing_stop: setTrailingStopTool,
  update_trailing_stop: updateTrailingStopTool,
  close_partial_position: closePartialPositionTool,
  execute_with_algorithm: executeWithAlgorithmTool,
};
