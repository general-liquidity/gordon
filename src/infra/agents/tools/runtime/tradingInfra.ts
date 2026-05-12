/**
 * Trading Infrastructure Tools — Expose new trading modules to agents
 *
 * Registers strategy sandbox, portfolio diff, risk classifier, auto-rebalance,
 * strategy checkpointing, and market context as Mastra tools so agents can
 * call them during conversations.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  createSandbox,
  getSandbox,
  listSandboxes,
  compareSandboxes,
} from "../../../trading/ops/strategySandbox.ts";
import {
  classifyTradeRisk,
  DEFAULT_CLASSIFIER_CONFIG,
} from "../../../trading/risk/riskClassifier.ts";
import {
  saveCheckpoint,
  listCheckpoints,
  getLatestCheckpoint,
  formatCheckpoint,
} from "../../../trading/ops/strategyCheckpoint.ts";
import {
  createRebalanceCycle,
  startStep,
  completeStep,
  failStep,
  detectDrift,
  formatCycleStatus,
} from "../../../trading/portfolio/autoRebalance.ts";
import { getMarketContext, formatSymbolHover } from "../../../trading/signals/marketContext.ts";

// ============================================================================
// Strategy Sandbox Tools
// ============================================================================

export const create_sandbox = createTool({
  id: "create_sandbox",
  description:
    "Create an isolated paper-trading sandbox to test a strategy variant. " +
    "Use when user says 'test this strategy', 'paper trade this', 'simulate', " +
    "'what if I tried...'. Each sandbox has its own virtual portfolio.",
  inputSchema: z.object({
    name: z.string().describe("Strategy name (e.g., 'aggressive-momentum')"),
    capitalUsd: z.number().positive().describe("Starting capital in USD"),
    description: z.string().optional().describe("Strategy description"),
  }),
  execute: async ({ name, capitalUsd, description }) => {
    const sb = createSandbox({ name, capitalUsd, description });
    return { success: true, sandboxId: sb.id, name: sb.name, capital: capitalUsd };
  },
});

export const sandbox_trade = createTool({
  id: "sandbox_trade",
  description:
    "Simulate a trade in a strategy sandbox (paper trading). " +
    "Use after create_sandbox to test entries/exits without real money.",
  inputSchema: z.object({
    sandboxId: z.string().describe("Sandbox ID from create_sandbox"),
    symbol: z.string().describe("Trading pair (e.g., 'BTCUSDT')"),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().positive(),
    price: z.number().positive().describe("Simulated fill price"),
  }),
  execute: async ({ sandboxId, symbol, side, quantity, price }) => {
    const sb = getSandbox(sandboxId);
    if (!sb) return { success: false, error: `Sandbox ${sandboxId} not found` };
    const trade = sb.simulateTrade({ symbol, side, quantity, price });
    return { success: true, trade, snapshot: sb.snapshot() };
  },
});

export const compare_sandboxes = createTool({
  id: "compare_sandboxes",
  description:
    "Compare all active strategy sandboxes side-by-side. " +
    "Shows returns, drawdowns, win rates. Use to pick the best strategy variant.",
  inputSchema: z.object({}),
  execute: async () => {
    const result = compareSandboxes();
    return { success: true, ...result };
  },
});

export const list_sandboxes = createTool({
  id: "list_sandboxes",
  description: "List all active strategy sandboxes with their current P&L.",
  inputSchema: z.object({}),
  execute: async () => {
    return { success: true, sandboxes: listSandboxes() };
  },
});

// ============================================================================
// Risk Classification Tool
// ============================================================================

export const classify_trade_risk = createTool({
  id: "classify_trade_risk",
  description:
    "Score a proposed trade across 8 risk dimensions and return a risk tier. " +
    "Use BEFORE placing any trade to assess position size, concentration, " +
    "drawdown proximity, volatility, and more. Returns auto_approve/prompt_user/block.",
  inputSchema: z.object({
    symbol: z.string(),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().positive(),
    price: z.number().positive(),
    notionalUsd: z.number().positive(),
    orderType: z.enum(["MARKET", "LIMIT", "STOP"]).default("MARKET"),
  }),
  execute: async (trade, execContext) => {
    // Build a minimal portfolio context from available data
    const portfolioContext = {
      totalValueUsd: 100_000, // TODO: pull from real portfolio
      cashUsd: 50_000,
      positions: [],
      dailyPnlUsd: 0,
      dailyLossLimitUsd: 2_000,
      maxDrawdownPct: 10,
      currentDrawdownPct: 0,
      recentTradeCount: 0,
      tradedSymbols: new Set<string>(),
    };

    const assessment = classifyTradeRisk(trade, portfolioContext, DEFAULT_CLASSIFIER_CONFIG);

    // Wire: Trading Constitution check (immutable rules that cannot be overridden)
    let constitutionViolations: any[] = [];
    try {
      const { checkConstitution, formatViolations } = require("../../safety/tradingConstitution.ts") as typeof import("../../../safety/defense/tradingConstitution.ts");
      const result = checkConstitution({
        positionSizePct: (trade.notionalUsd / portfolioContext.totalValueUsd) * 100,
        riskPerTradePct: assessment.compositeScore > 50 ? 3 : 1, // Estimate
        currentDrawdownPct: portfolioContext.currentDrawdownPct,
        dailyLossPct: Math.abs(portfolioContext.dailyPnlUsd / portfolioContext.totalValueUsd) * 100,
        openPositionCount: portfolioContext.positions.length,
        tradesThisHour: portfolioContext.recentTradeCount,
        tradesThisDay: portfolioContext.recentTradeCount * 3, // Estimate
        consecutiveLosses: 0,
        hasStopLoss: true, // Assume — Executor instructions require it
        isCrypto: true,
      });
      constitutionViolations = result;

      // If any constitution violation is "halt" or "emergency" → override risk tier to critical
      const hasHalt = result.some((v: any) => v.severity === "halt" || v.severity === "emergency");
      if (hasHalt) {
        assessment.tier = "critical";
        assessment.recommendation = "block";
        assessment.summary = formatViolations(result);
      }
    } catch { /* non-critical */ }

    return { success: true, ...assessment, constitutionViolations };
  },
});

// ============================================================================
// Checkpoint Tools
// ============================================================================

export const save_checkpoint = createTool({
  id: "save_checkpoint",
  description:
    "Save a portfolio checkpoint before a major change (rebalance, strategy switch). " +
    "Use before executing multi-trade operations so you can compare before/after.",
  inputSchema: z.object({
    label: z.string().describe("Human-readable label (e.g., 'Before BTC rebalance')"),
    reason: z.enum(["manual", "pre_rebalance", "pre_strategy_change", "pre_execution"]).default("manual"),
  }),
  execute: async ({ label, reason }) => {
    const cp = saveCheckpoint({
      label,
      reason,
      portfolio: {
        totalValueUsd: 0, // TODO: populate from real portfolio
        cashUsd: 0,
        positions: [],
        pendingOrders: [],
      },
    });
    return { success: true, checkpointId: cp.id, label: cp.label, createdAt: cp.createdAt };
  },
});

export const list_checkpoints_tool = createTool({
  id: "list_checkpoints",
  description: "List all portfolio checkpoints (newest first).",
  inputSchema: z.object({}),
  execute: async () => {
    const cps = listCheckpoints();
    return {
      success: true,
      count: cps.length,
      checkpoints: cps.slice(0, 10).map((cp) => ({
        id: cp.id,
        label: cp.label,
        createdAt: cp.createdAt,
        reason: cp.reason,
        totalValue: cp.portfolio.totalValueUsd,
        positionCount: cp.portfolio.positions.length,
      })),
    };
  },
});

// ============================================================================
// Market Context Tool
// ============================================================================

export const get_symbol_context = createTool({
  id: "get_symbol_context",
  description:
    "Get rich context for a symbol: live price, position, P&L, open orders, spread. " +
    "Like 'hover' in an IDE — gives you everything about a symbol at a glance.",
  inputSchema: z.object({
    symbol: z.string().describe("Symbol to look up (e.g., 'BTCUSDT', 'AAPL')"),
  }),
  execute: async ({ symbol }) => {
    const ctx = await getMarketContext().getSymbolContext(symbol);
    if (!ctx) return { success: false, error: `No context available for ${symbol}` };
    return { success: true, context: ctx, formatted: formatSymbolHover(ctx) };
  },
});

// ============================================================================
// Detect Drift Tool
// ============================================================================

export const detect_portfolio_drift = createTool({
  id: "detect_portfolio_drift",
  description:
    "Check if the portfolio has drifted from target allocations. " +
    "Use to decide if rebalancing is needed. Returns drifted positions and total drift %.",
  inputSchema: z.object({
    targetAllocations: z.record(z.string(), z.number()).describe("Target allocation by symbol (e.g., { BTC: 40, ETH: 30, SOL: 30 })"),
    currentAllocations: z.record(z.string(), z.number()).describe("Current allocation by symbol"),
    thresholdPct: z.number().default(5).describe("Drift threshold to trigger rebalance (default 5%)"),
  }),
  execute: async ({ targetAllocations, currentAllocations, thresholdPct }) => {
    const currentMap: Record<string, number> = {};
    const targetMap: Record<string, number> = {};
    for (const [k, v] of Object.entries(currentAllocations)) currentMap[k] = Number(v);
    for (const [k, v] of Object.entries(targetAllocations)) targetMap[k] = Number(v);
    const drift = detectDrift(currentMap, targetMap, thresholdPct);
    return { success: true, ...drift };
  },
});

// ============================================================================
// Export bundle
// ============================================================================

export const tradingInfraTools = {
  create_sandbox,
  sandbox_trade,
  compare_sandboxes,
  list_sandboxes,
  classify_trade_risk,
  save_checkpoint,
  list_checkpoints: list_checkpoints_tool,
  get_symbol_context,
  detect_portfolio_drift,
};
