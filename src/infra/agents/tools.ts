/**
 * Agent Tools
 * Wraps Gordon's core functionality as tools for the OpenAI Agents SDK
 */

import { tool, type RunContext } from "@openai/agents";
import { z } from "zod";

import { scan } from "../../core/scanner.ts";
import { analyze } from "../../core/analyzer.ts";
import { generatePlan } from "../../core/planner.ts";
import { executePlan, cancelTrade, closeTrade } from "../../core/executor.ts";
import { validatePlan } from "../../core/validator.ts";
import { runMonitorCycle, type MonitorResult } from "../../core/monitor.ts";
import { explain, getPresetExplanation } from "../../core/explainer.ts";
import { loadConfig, saveConfig } from "../storage/config.ts";
import { listPlans, getPlan, updatePlan } from "../storage/plans.ts";
import { listTrades, getTrade } from "../storage/trades.ts";

import type { GordonContext } from "./types.ts";

// Helper functions
const getAllPlans = () => listPlans();
const getActiveTrades = () => listTrades({ status: "OPEN" });

// Preset topics for explanations
const PRESET_TOPICS = ["rsi", "macd", "support", "resistance", "stop_loss", "take_profit", "dca", "risk_reward"];

// ============================================================================
// Market Scanning Tool
// ============================================================================

export const scanMarketTool = tool({
  name: "scan_market",
  description:
    "Scan the market for trading opportunities. Finds coins near support with bullish signals. " +
    "Use this when the user wants to find trading opportunities or asks 'what should I buy?'",
  parameters: z.object({
    topN: z
      .number()
      .min(10)
      .max(200)
      .optional()
      .describe("Number of top coins by volume to scan (default: 50)"),
    timeframes: z
      .array(z.string())
      .optional()
      .describe("Timeframes to analyze (default: ['1h', '4h'])"),
  }),
  async execute({ topN, timeframes }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    const result = await scan(ctx.binance, { topN, timeframes });

    // Return a summarized result for the LLM
    return {
      timestamp: result.timestamp,
      coinsScanned: result.coins.length,
      opportunities: result.coins
        .filter((c) => c.setupDetected)
        .slice(0, 10)
        .map((c) => ({
          symbol: c.symbol,
          price: c.price,
          change24h: c.change24h,
          setupConfidence: c.setupConfidence,
          bias: c.bias,
          risk: c.risk,
        })),
    };
  },
});

// ============================================================================
// Coin Analysis Tool
// ============================================================================

export const analyzeCoinTool = tool({
  name: "analyze_coin",
  description:
    "Perform deep analysis on a specific coin/trading pair. " +
    "Use this when the user asks about a specific coin like 'analyze BTC' or 'what about ETH?'",
  parameters: z.object({
    symbol: z
      .string()
      .describe("Trading pair symbol (e.g., 'BTCUSDT', 'ETHUSDT')"),
    timeframes: z
      .array(z.string())
      .optional()
      .describe("Timeframes to analyze (default: ['1h', '4h', '1d'])"),
  }),
  async execute({ symbol, timeframes }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    // Normalize symbol (add USDT if not present)
    const normalizedSymbol = symbol.toUpperCase().endsWith("USDT")
      ? symbol.toUpperCase()
      : `${symbol.toUpperCase()}USDT`;

    const result = await analyze(ctx.binance, normalizedSymbol, {
      timeframes: timeframes ?? ["1h", "4h", "1d"],
    });

    return {
      symbol: result.symbol,
      price: result.price,
      trend: result.trend,
      setupDetected: result.setupDetected,
      setupConfidence: result.setupConfidence,
      supports: result.supports.slice(0, 3).map((s) => ({
        price: s.price,
        strength: s.strength,
      })),
      resistances: result.resistances.slice(0, 3).map((r) => ({
        price: r.price,
        strength: r.strength,
      })),
      indicators: {
        rsi: result.indicators.rsi,
        macdState: result.macdState,
        volumeTrend: result.volumeTrend,
      },
      recommendation:
        result.setupDetected && result.setupConfidence >= 0.6
          ? "Good setup detected - consider creating a plan"
          : result.setupDetected
            ? "Weak setup detected - wait for better entry"
            : "No setup detected - keep watching",
    };
  },
});

// ============================================================================
// Plan Generation Tool
// ============================================================================

export const createPlanTool = tool({
  name: "create_plan",
  description:
    "Create a trading plan for a specific coin based on analysis. " +
    "Use this when the user wants to trade a coin, e.g., 'buy BTC' or 'create plan for ETH'",
  parameters: z.object({
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTCUSDT')"),
    riskLevel: z
      .enum(["low", "medium", "high"])
      .optional()
      .describe("Risk tolerance (default: from user preferences)"),
    allocationPercent: z
      .number()
      .min(0.01)
      .max(0.5)
      .optional()
      .describe("Percent of portfolio to allocate (default: from user preferences)"),
  }),
  async execute(
    { symbol, riskLevel, allocationPercent },
    runContext: RunContext<GordonContext> | undefined
  ) {
    const ctx = runContext?.context;
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
// Plan Execution Tool (Requires Approval)
// ============================================================================

export const executePlanTool = tool({
  name: "execute_plan",
  description:
    "Execute an approved trading plan by placing orders on Binance. " +
    "IMPORTANT: This places real orders with real money. Only use after user confirms the plan.",
  parameters: z.object({
    planId: z.string().describe("The ID of the plan to execute"),
  }),
  needsApproval: true, // This requires human approval before execution
  async execute({ planId }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    // Get the plan
    const plan = getPlan(planId);
    if (!plan) {
      return { error: `Plan not found: ${planId}` };
    }

    // Check mode
    if (ctx.config.mode !== "ARMED") {
      return {
        error: "Cannot execute: System is in SAFE mode. User must arm the system first.",
      };
    }

    // Execute the plan
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
// Position Monitor Tool
// ============================================================================

export const checkPositionsTool = tool({
  name: "check_positions",
  description:
    "Check the status of all open positions and detect any alerts or anomalies. " +
    "Use this when the user asks 'how are my trades?' or 'check positions'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    const result: MonitorResult = await runMonitorCycle(ctx.binance);

    // Transform the result into a more user-friendly format
    const totalUnrealizedPnl = result.updates.reduce((sum, u) => sum + u.unrealizedPnl, 0);
    const positions = result.updates.map((p) => ({
      symbol: p.trade.symbol,
      status: p.status,
      unrealizedPnl: p.unrealizedPnl,
      unrealizedPnlPercent: p.unrealizedPnlPercent,
    }));

    return {
      openTrades: result.updates.length,
      totalUnrealizedPnl,
      totalUnrealizedPnlPercent: ctx.portfolioValue > 0 ? (totalUnrealizedPnl / ctx.portfolioValue) * 100 : 0,
      positions,
      alerts: result.alerts.map((a) => a.message),
    };
  },
});

// ============================================================================
// Close Trade Tool (Requires Approval)
// ============================================================================

export const closeTradeTool = tool({
  name: "close_trade",
  description:
    "Close an open trade by selling all remaining position. " +
    "Use when user wants to exit a trade early, e.g., 'close my BTC trade'",
  parameters: z.object({
    tradeId: z.string().describe("The ID of the trade to close"),
    reason: z
      .enum(["MANUAL", "STOP", "TP1", "TP2", "TP3"])
      .optional()
      .describe("Reason for closing (default: MANUAL)"),
  }),
  needsApproval: true,
  async execute({ tradeId, reason }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    const trade = getTrade(tradeId);
    if (!trade) {
      return { error: `Trade not found: ${tradeId}` };
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
// Explain Tool
// ============================================================================

export const explainTool = tool({
  name: "explain",
  description:
    "Explain a trading concept, term, or strategy in simple terms. " +
    "Use when the user asks 'what is X?' or 'explain Y' or needs help understanding something",
  parameters: z.object({
    topic: z.string().describe("The topic to explain"),
    additionalContext: z
      .string()
      .optional()
      .describe("Additional context for the explanation"),
  }),
  async execute({ topic, additionalContext }, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.llm) {
      return { error: "LLM client not connected." };
    }

    // Check if it's a preset topic
    const presetExplanation = getPresetExplanation(topic);
    if (presetExplanation) {
      return { explanation: presetExplanation, topic };
    }

    // Custom explanation using AI
    const explanation = await explain(ctx.llm, topic, { topic: additionalContext });
    return { explanation, topic };
  },
});

// ============================================================================
// Arm/Disarm System Tool
// ============================================================================

export const armSystemTool = tool({
  name: "arm_system",
  description:
    "Arm or disarm the trading system. When armed, Gordon can execute trades. " +
    "Use when user says 'arm' or 'enable trading' or 'disarm' or 'disable trading'",
  parameters: z.object({
    action: z.enum(["arm", "disarm"]).describe("Whether to arm or disarm"),
    hours: z
      .number()
      .min(1)
      .max(24)
      .optional()
      .describe("Hours to stay armed (default: 24, max: 24)"),
  }),
  needsApproval: true,
  async execute({ action, hours }) {
    const config = await loadConfig();

    if (action === "arm") {
      const armHours = Math.min(hours ?? 24, 24);
      const armedUntil = new Date(Date.now() + armHours * 60 * 60 * 1000).toISOString();

      await saveConfig({ ...config, mode: "ARMED", armedUntil });

      return {
        success: true,
        mode: "ARMED",
        armedUntil,
        message: `System armed for ${armHours} hours. Trading enabled.`,
      };
    } else {
      await saveConfig({ ...config, mode: "SAFE", armedUntil: null });

      return {
        success: true,
        mode: "SAFE",
        message: "System disarmed. Trading disabled.",
      };
    }
  },
});

// ============================================================================
// Get Portfolio Tool
// ============================================================================

export const getPortfolioTool = tool({
  name: "get_portfolio",
  description:
    "Get the current portfolio value and balances from Binance. " +
    "Use when user asks 'what's my balance?' or 'how much do I have?'",
  parameters: z.object({}),
  async execute(_: Record<string, never>, runContext: RunContext<GordonContext> | undefined) {
    const ctx = runContext?.context;
    if (!ctx?.binance) {
      return { error: "Binance client not connected. Please configure API keys." };
    }

    const accountInfo = await ctx.binance.getAccountInfo();
    const balances = accountInfo.balances;

    // Calculate total value in USDT
    let totalValue = 0;
    const holdings: Array<{ asset: string; free: number; locked: number; usdtValue: number }> = [];

    for (const balance of balances) {
      const free = parseFloat(balance.free);
      const locked = parseFloat(balance.locked);
      const total = free + locked;

      if (total > 0) {
        let usdtValue = 0;

        if (balance.asset === "USDT") {
          usdtValue = total;
        } else {
          try {
            const price = await ctx.binance.getPrice(`${balance.asset}USDT`);
            usdtValue = total * price;
          } catch {
            // Skip assets without USDT pair
            continue;
          }
        }

        if (usdtValue > 1) {
          // Only include assets worth more than $1
          holdings.push({
            asset: balance.asset,
            free,
            locked,
            usdtValue,
          });
          totalValue += usdtValue;
        }
      }
    }

    // Sort by value
    holdings.sort((a, b) => b.usdtValue - a.usdtValue);

    return {
      totalValue,
      holdings: holdings.slice(0, 10), // Top 10 holdings
      openTrades: getActiveTrades().length,
    };
  },
});

// ============================================================================
// List Plans Tool
// ============================================================================

export const listPlansTool = tool({
  name: "list_plans",
  description:
    "List all trading plans, optionally filtered by status. " +
    "Use when user asks 'show my plans' or 'what plans do I have?'",
  parameters: z.object({
    status: z
      .enum(["DRAFT", "APPROVED", "EXECUTING", "CLOSED", "CANCELLED"])
      .optional()
      .describe("Filter by status"),
    limit: z.number().min(1).max(50).optional().describe("Max plans to return (default: 10)"),
  }),
  async execute({ status, limit }) {
    let plans = getAllPlans();

    if (status) {
      plans = plans.filter((p) => p.status === status);
    }

    // Sort by creation date (newest first)
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

export const approvePlanTool = tool({
  name: "approve_plan",
  description:
    "Approve a draft plan, marking it ready for execution. " +
    "Use when user says 'approve this plan' or 'looks good, approve it'",
  parameters: z.object({
    planId: z.string().describe("The ID of the plan to approve"),
  }),
  async execute({ planId }) {
    const plan = getPlan(planId);
    if (!plan) {
      return { error: `Plan not found: ${planId}` };
    }

    if (plan.status !== "DRAFT") {
      return { error: `Plan is not in DRAFT status, current status: ${plan.status}` };
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
// Export all tools
// ============================================================================

export const allTools = [
  scanMarketTool,
  analyzeCoinTool,
  createPlanTool,
  executePlanTool,
  checkPositionsTool,
  closeTradeTool,
  explainTool,
  armSystemTool,
  getPortfolioTool,
  listPlansTool,
  approvePlanTool,
];
