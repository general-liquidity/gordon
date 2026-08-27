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
import { buildClassifierPortfolioContext } from "../../../trading/risk/classifierPortfolio.ts";
import { getGordonContext } from "../types.ts";
import {
  saveCheckpoint,
  listCheckpoints,
  type PortfolioCheckpoint,
} from "../../../trading/ops/strategyCheckpoint.ts";
import { detectDrift } from "../../../trading/portfolio/autoRebalance.ts";
import { getMarketContext, formatSymbolHover } from "../../../trading/signals/marketContext.ts";
import {
  checkConstitution,
  formatViolations,
  type ConstitutionViolation,
} from "../../../safety/defense/tradingConstitution.ts";

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
    "Score a proposed trade across 13 risk dimensions and return a risk tier. " +
    "Use BEFORE placing any trade to assess position size, concentration, " +
    "drawdown proximity, volatility, regime transition, venue MEV exposure, and more. " +
    "Returns auto_approve/prompt_user/block. Pass venue (e.g. 'binance', 'ccxt:hyperliquid', " +
    "'ccxt:bybit', 'cow_swap') to surface venue-specific MEV/sniping exposure.",
  inputSchema: z.object({
    symbol: z.string(),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().positive(),
    price: z.number().positive(),
    notionalUsd: z
      .number()
      .positive()
      .optional()
      .describe("Optional display estimate; Gordon derives risk notional as quantity × price."),
    stopLossPrice: z
      .number()
      .positive()
      .optional()
      .describe("Protective stop price. Omission is a constitution violation."),
    orderType: z.enum(["MARKET", "LIMIT", "STOP"]).default("MARKET"),
    venue: z
      .string()
      .optional()
      .describe(
        "Venue id (native: 'binance', 'hyperliquid', etc.; CCXT: 'ccxt:bybit'; " +
          "MEV-protected: 'cow_swap'). When supplied, the 13th risk dimension (Venue MEV " +
          "Exposure) is included in the verdict.",
      ),
  }),
  execute: async (input, execContext) => {
    const { classifyVenue } =
      require("../../../trading/risk/venueMevExposure.ts") as typeof import("../../../trading/risk/venueMevExposure.ts");

    const ctx = getGordonContext(execContext);
    const portfolioContext = await buildClassifierPortfolioContext(ctx ?? undefined);
    const notionalUsd = input.quantity * input.price;
    const trade = { ...input, notionalUsd };
    if (trade.venue) {
      portfolioContext.venueMevExposure = classifyVenue(trade.venue);
    }

    const assessment = classifyTradeRisk(trade, portfolioContext, DEFAULT_CLASSIFIER_CONFIG);

    // Wire: Trading Constitution check (immutable rules that cannot be overridden).
    // The former dynamic import pointed at a nonexistent path and its catch
    // silently skipped this entire block. Derive the stop risk from the
    // proposal instead of assuming every order has a stop.
    const stopIsProtective =
      input.stopLossPrice !== undefined &&
      (input.side === "BUY"
        ? input.stopLossPrice < input.price
        : input.stopLossPrice > input.price);
    const stopDistancePct = stopIsProtective
      ? (Math.abs(input.price - input.stopLossPrice!) / input.price) * 100
      : undefined;
    const riskPerTradePct =
      stopIsProtective && portfolioContext.totalValueUsd > 0
        ? ((Math.abs(input.price - input.stopLossPrice!) * input.quantity) /
            portfolioContext.totalValueUsd) *
          100
        : 100;
    const constitutionViolations: ConstitutionViolation[] = checkConstitution({
      positionSizePct: (notionalUsd / portfolioContext.totalValueUsd) * 100,
      riskPerTradePct,
      currentDrawdownPct: portfolioContext.currentDrawdownPct,
      dailyLossPct: Math.abs(portfolioContext.dailyPnlUsd / portfolioContext.totalValueUsd) * 100,
      openPositionCount: portfolioContext.positions.length,
      tradesThisHour: portfolioContext.recentTradeCount,
      tradesThisDay: portfolioContext.todayTradeCount ?? portfolioContext.recentTradeCount,
      consecutiveLosses: 0,
      hasStopLoss: stopIsProtective,
      stopDistancePct,
      isCrypto: true,
    });

    const hasHalt = constitutionViolations.some(
      (violation) => violation.severity === "halt" || violation.severity === "emergency",
    );
    const hasBlock = constitutionViolations.some((violation) => violation.severity === "block");
    if (hasHalt || hasBlock) {
      assessment.tier = hasHalt ? "critical" : "high";
      assessment.recommendation = "block";
      assessment.summary = formatViolations(constitutionViolations);
    }

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
    reason: z
      .enum(["manual", "pre_rebalance", "pre_strategy_change", "pre_execution"])
      .default("manual"),
  }),
  execute: async ({ label, reason }, execContext) => {
    const ctx = getGordonContext(execContext);
    let totalValueUsd = ctx?.portfolioValue ?? 0;
    let cashUsd = ctx?.availableCash ?? 0;
    const positions: PortfolioCheckpoint["portfolio"]["positions"] = [];

    if (ctx?.broker) {
      try {
        const [account, brokerPositions] = await Promise.all([
          ctx.broker.getAccount(),
          ctx.broker.getPositions(),
        ]);
        totalValueUsd = account.portfolioValue;
        cashUsd = account.cash;
        for (const pos of brokerPositions) {
          const currentPrice = pos.qty > 0 ? pos.marketValue / pos.qty : pos.avgEntryPrice;
          positions.push({
            symbol: pos.symbol,
            side: pos.side,
            quantity: pos.qty,
            avgPrice: pos.avgEntryPrice,
            currentPrice,
            notionalUsd: pos.marketValue,
          });
        }
      } catch {
        // Fall back to context hints when broker snapshot fails.
      }
    } else if (ctx?.exchange) {
      try {
        const { PortfolioContextBuilder } = await import(
          "../../../../core/risk-kernel/portfolio-context.ts"
        );
        const portfolio = await new PortfolioContextBuilder().buildFromExchange(ctx.exchange);
        totalValueUsd = portfolio.totalEquity;
        cashUsd = portfolio.availableBalance;
        for (const pos of portfolio.openPositions) {
          const notionalUsd = Math.abs(pos.size * pos.currentPrice);
          positions.push({
            symbol: pos.symbol,
            side: pos.side,
            quantity: Math.abs(pos.size),
            avgPrice: pos.entryPrice,
            currentPrice: pos.currentPrice,
            notionalUsd,
          });
        }
      } catch {
        // Fall back to context hints when exchange snapshot fails.
      }
    }

    const cp = saveCheckpoint({
      label,
      reason,
      portfolio: {
        totalValueUsd,
        cashUsd,
        positions,
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
    targetAllocations: z
      .record(z.string(), z.number())
      .describe("Target allocation by symbol (e.g., { BTC: 40, ETH: 30, SOL: 30 })"),
    currentAllocations: z.record(z.string(), z.number()).describe("Current allocation by symbol"),
    thresholdPct: z
      .number()
      .default(5)
      .describe("Drift threshold to trigger rebalance (default 5%)"),
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
