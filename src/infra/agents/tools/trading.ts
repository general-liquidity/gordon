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
import { executePlan, closeTrade } from "../../../core/executor.ts";
import { analyze } from "../../../core/analyzer.ts";
import { calculateGridLevels } from "../../../core/grid-calculator.ts";
import { PlanSchema } from "../../../types/plan.ts";
import { TradeSchema } from "../../../types/trade.ts";
import { loadConfig, saveConfig } from "../../storage/config.ts";
import { listPlans, getPlan, updatePlan, createPlan } from "../../storage/plans.ts";
import { listTrades, getTrade } from "../../storage/trades.ts";
import { getGordonContext, type MastraExecutionContext } from "./types.ts";

// ============================================================================
// Error Messages
// ============================================================================

const errors = {
  noBinance: { error: "Binance client not connected. Please configure API keys." },
  noLLM: { error: "LLM client not connected." },
  noContext: { error: "Context not available." },
} as const;

// ============================================================================
// Helper Functions
// ============================================================================

const getActiveTrades = () => listTrades({ status: "OPEN" });

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
  outputSchema: z.object({
    success: z.boolean().optional(),
    plan: PlanSchema.optional(),
    summary: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ symbol, riskLevel, allocationPercent, strategyId }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance || !ctx?.llm) {
      return { error: "Binance or LLM client not connected." };
    }

    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    // Get detailed analysis first
    const analysis = await analyze(ctx.binance, normalizedSymbol, {
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

    return {
      success: true,
      plan,
      summary: `Created ${plan.strategy} plan for ${plan.symbol}: Entry at ${plan.entry.price ?? "market"}, Stop at ${plan.stopLoss.price}, ${plan.takeProfit.length} TP levels. Allocation: ${plan.allocation.amount} USDT (${(plan.allocation.percentOfPortfolio * 100).toFixed(1)}%)`,
    };
  },
});

// ============================================================================
// Plan Execution Tool
// Note: needsApproval removed - handle via guardrails in Mastra
// ============================================================================

export const executePlanTool = createTool({
  id: "execute_plan",
  description:
    "Execute an approved trading plan by placing orders on Binance. " +
    "IMPORTANT: This places real orders with real money. Only use after user confirms the plan.",
  inputSchema: z.object({
    planId: z.string().describe("The ID of the plan to execute"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    trade: TradeSchema.optional(),
    orderCount: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ planId }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const plan = getPlan(planId);
    if (!plan) {
      return { success: false, error: `Plan not found: ${planId}` };
    }

    if (ctx.config.mode !== "ARMED") {
      return {
        success: false,
        error: "Cannot execute: System is in SAFE mode. User must arm the system first.",
      };
    }

    const result = await executePlan(ctx.binance, plan, ctx.config, {
      totalValue: ctx.portfolioValue,
      availableCash: ctx.availableCash,
      openPositions: getActiveTrades().length,
    });

    if (result.success && result.trade) {
      return {
        success: true,
        trade: result.trade,
        orderCount: result.orders.length,
      };
    }

    return {
      success: false,
      error: result.error,
    };
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
  outputSchema: z.object({
    success: z.boolean(),
    pnl: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ tradeId, reason }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return errors.noBinance;
    }

    const trade = getTrade(tradeId);
    if (!trade) {
      return { success: false, error: `Trade not found: ${tradeId}` };
    }

    const result = await closeTrade(ctx.binance, trade, reason ?? "MANUAL");

    return {
      success: result.success,
      pnl: result.pnl,
      error: result.error,
    };
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
  outputSchema: z.object({
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
  }),
  execute: async ({ status, limit }) => {
    let plans = listPlans();

    if (status && status !== "ALL") {
      plans = plans.filter((p) => p.status === status);
    }

    plans.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    return {
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
  outputSchema: z.object({
    success: z.boolean(),
    planId: z.string().optional(),
    message: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ planId }) => {
    const plan = getPlan(planId);
    if (!plan) {
      return { success: false, error: `Plan not found: ${planId}` };
    }

    if (plan.status !== "DRAFT") {
      return { success: false, error: `Plan is not in DRAFT status, current status: ${plan.status}` };
    }

    updatePlan(planId, { status: "APPROVED" });

    return {
      success: true,
      planId,
      message: "Plan approved. Ready for execution when system is armed.",
    };
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
  outputSchema: z.object({
    success: z.boolean(),
    mode: z.enum(["ARMED", "SAFE"]).optional(),
    armedUntil: z.string().optional().nullable(),
    message: z.string(),
    error: z.string().optional(),
  }),
  execute: async ({ action, hours }) => {
    const config = await loadConfig();

    if (action === "arm") {
      const armHours = Math.min(hours ?? 24, 24);
      const armedUntil = new Date(Date.now() + armHours * 60 * 60 * 1000).toISOString();

      await saveConfig({ ...config, mode: "ARMED", armedUntil });

      return {
        success: true,
        mode: "ARMED" as const,
        armedUntil,
        message: `System armed for ${armHours} hours. Trading enabled.`,
      };
    } else {
      await saveConfig({ ...config, mode: "SAFE", armedUntil: null });

      return {
        success: true,
        mode: "SAFE" as const,
        armedUntil: null,
        message: "System disarmed. Trading disabled.",
      };
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
  outputSchema: z.object({
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
  }),
  execute: async ({ symbol, allocation, numLevels, distribution }, execContext: MastraExecutionContext) => {
    const ctx = getGordonContext(execContext);
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    // Normalize symbol
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    // Analyze the symbol to get support/resistance levels
    const analysis = await analyze(ctx.binance, normalizedSymbol, {
      timeframes: ["1h", "4h"],
    });

    if (analysis.supports.length === 0) {
      return {
        success: false,
        error: `No support levels found for ${normalizedSymbol}. Cannot create grid plan.`,
      };
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

    const levelsSummary = gridResult.levels
      .map((l, i) => `L${i + 1}: $${l.price.toFixed(2)} (${(l.percentOfAllocation * 100).toFixed(1)}%)`)
      .join(", ");

    return {
      success: true,
      planPreview,
      message: `Grid plan created (ID: ${savedPlan.id}) for ${normalizedSymbol}: ${gridResult.levels.length} levels from $${gridResult.config.priceRange.high.toFixed(2)} to $${gridResult.config.priceRange.low.toFixed(2)}. ${levelsSummary}. Stop loss at $${gridResult.stopLossPrice.toFixed(2)}. Allocation: $${allocationAmount.toFixed(2)} (${(percentOfPortfolio * 100).toFixed(1)}% of portfolio). Use 'approve_plan' with ID ${savedPlan.id} to approve.`,
    };
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
};
