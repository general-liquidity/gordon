/**
 * V4 Plan + Execution Tools — 6 typed tools.
 *
 *   - create_plan   → Plan (typed entry/exit/stop/size + rationale)
 *   - verify_plan   → VerifyResult (risk classifier + permission)
 *   - approve_plan  → ApprovalResult (rationale-required override path)
 *   - execute_plan  → ExecutionResult (dispatches Executor)
 *   - cancel        → CancelResult (orders or positions)
 *   - backtest      → BacktestResult
 *
 * Each tool is regulatory-critical state mutation — per-tool permission
 * scoping + audit specificity outweighs schema-cost savings.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import { getGordonContext, type MastraExecutionContext } from "../types.ts";
import { createPlan as dbCreatePlan, getPlan as dbGetPlan } from "../../../storage/entities/plans.ts";
import {
  approvePlanTool as legacyApprovePlan,
  executePlanTool as legacyExecutePlan,
  closeTradeTool as legacyCloseTrade,
  closePartialPositionTool as legacyClosePartial,
} from "../trading/trading.ts";
import { checkRiskTool as legacyCheckRisk } from "../trading/risk-gate.ts";
import { runBacktestTool as legacyRunBacktest } from "../strategy/backtest/backtest.ts";
import { auditLog } from "../../../platform/audit/index.ts";

/** Same shape as analytics.ts withPortfolioOverride — wrap the
 *  RequestContext so reads of portfolioValue / availableCash return the
 *  override. Duplicated here to keep V4 files self-contained; the
 *  alternative is a shared utility, which we'll extract if a third
 *  caller appears. */
function verifyPlanPortfolioProxy(
  execContext: MastraExecutionContext | undefined,
  overrideUsd: number,
): MastraExecutionContext | undefined {
  if (!execContext?.requestContext) return execContext;
  const original = execContext.requestContext;
  const proxied = new Proxy(original, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return (key: string) => {
          if (key === "portfolioValue" || key === "availableCash") return overrideUsd;
          return Reflect.get(target, "get").call(target, key);
        };
      }
      return Reflect.get(target, prop, receiver);
    },
  });
  return { ...execContext, requestContext: proxied };
}

// ============================================================================
// create_plan
// ============================================================================

export const createPlanTool = createTool({
  id: "create_plan",
  description: [
    "Create a trading Plan: structured spec for an intended trade with",
    "entry, exit, stop, size, rationale. Plans go through verify → approve",
    "→ execute lifecycle. A Plan is the unit of intent — not an order yet.",
    "",
    "After create_plan, call verify_plan to run risk + constitution gates.",
    "Only Plans that pass verify_plan should be approved + executed.",
  ].join("\n"),
  inputSchema: z.object({
    symbol: z.string(),
    side: z.enum(["buy", "sell"]),
    entryPrice: z.number().positive().optional().describe("Limit entry; omit for market."),
    stopLossPrice: z.number().positive(),
    takeProfitPrice: z.number().positive().optional(),
    sizeUsd: z.number().positive(),
    venue: z.string().optional(),
    rationale: z.string().min(10).describe("Why this trade — min 10 chars for audit."),
    strategySlot: z.string().optional().describe("Strategy slot ID if part of an active strategy."),
    strategy: z
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
        "grid_entry",
      ])
      .optional()
      .describe("Strategy taxonomy for audit + adherence. Defaults to 'support_bounce' when unset; pick the closest match."),
    timeHorizonHours: z.number().positive().optional(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    planId: z.string().optional(),
    plan: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: {
      symbol: string;
      side: "buy" | "sell";
      entryPrice?: number;
      stopLossPrice: number;
      takeProfitPrice?: number;
      sizeUsd: number;
      venue?: string;
      rationale: string;
      strategySlot?: string;
      strategy?:
        | "support_bounce"
        | "bollinger_bounce"
        | "sma_crossover"
        | "volume_surge"
        | "vwap_bounce"
        | "consolidation_pop"
        | "adx_trend"
        | "ema_rsi_crossover"
        | "relative_strength"
        | "engulfing_pattern"
        | "grid_entry";
      timeHorizonHours?: number;
    },
    execContext?: MastraExecutionContext,
  ) => {
    try {
      const ctx = getGordonContext(execContext);
      const portfolioValue = Math.max(ctx?.portfolioValue ?? args.sizeUsd, args.sizeUsd);
      const allocationPercent = args.sizeUsd / portfolioValue;
      // Map V4 explicit spec to the Plan shape stored in SQLite. Direction
      // collapses sell→long with inverted stop semantics handled downstream;
      // strategy defaults to support_bounce since V4 plans are operator-spec'd
      // not strategy-driven (the strategy slot is metadata, not generator).
      const plan = dbCreatePlan({
        symbol: args.symbol,
        direction: args.side === "buy" ? "long" : "short",
        strategy: args.strategy ?? "support_bounce",
        allocation: {
          currency: "USDT",
          amount: args.sizeUsd,
          percentOfPortfolio: allocationPercent,
        },
        entry: {
          type: args.entryPrice ? "limit" : "market",
          price: args.entryPrice ?? null,
        },
        dca: null,
        grid: null,
        stopLoss: { price: args.stopLossPrice },
        takeProfit: args.takeProfitPrice
          ? [{ price: args.takeProfitPrice, percentToSell: 1 }]
          : [],
        reasoning: args.rationale,
        status: "DRAFT",
        expiresAt: args.timeHorizonHours
          ? new Date(Date.now() + args.timeHorizonHours * 60 * 60 * 1000).toISOString()
          : undefined,
      });

      auditLog.record(
        "operator",
        "CREATE_PLAN" as Parameters<typeof auditLog.record>[1],
        { ...args },
        "SUCCESS",
        { resultDetails: args.rationale, planId: plan.id },
      );

      return { success: true, planId: plan.id, plan };
    } catch (err) {
      return {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// verify_plan
// ============================================================================

export const verifyPlanTool = createTool({
  id: "verify_plan",
  description: [
    "Run the safety stack on a Plan: 11-dim risk classifier + permission",
    "engine + venue/account feasibility. Returns approve / conditional /",
    "reject + structured reasons.",
    "",
    "MANDATORY before approve_plan + execute_plan. Plans that haven't been",
    "verified should never reach execution.",
  ].join("\n"),
  inputSchema: z.object({
    planId: z.string(),
    portfolioOverrideUsd: z
      .number()
      .positive()
      .optional()
      .describe(
        "If set, evaluate risk against this hypothetical portfolio value instead of the live exchange balance. Use for 'verify the plan on a $X account' reasoning without switching modes.",
      ),
  }),
  outputSchema: z.object({
    planId: z.string(),
    verdict: z.enum(["approve", "conditional", "reject"]),
    riskTier: z.enum(["low", "medium", "high", "critical"]),
    constitutionViolations: z.array(z.unknown()),
    recommendation: z.string(),
    summary: z.string(),
  }),
  execute: async (
    args: { planId: string; portfolioOverrideUsd?: number },
    execContext?: MastraExecutionContext,
  ) => {
    const plan = dbGetPlan(args.planId);
    if (!plan) {
      return {
        planId: args.planId,
        verdict: "reject" as const,
        riskTier: "critical" as const,
        constitutionViolations: [],
        recommendation: "block",
        summary: `Plan not found: ${args.planId}`,
      };
    }
    const ctx = getGordonContext(execContext);
    const quantity =
      plan.allocation.amount /
      Math.max(plan.entry.price ?? (await ctx?.exchange?.getPrice(plan.symbol).catch(() => 1)) ?? 1, 1e-9);
    // When the operator asked for a hypothetical-portfolio evaluation,
    // shadow the live ctx.portfolioValue / availableCash via the same
    // proxy compute_risk uses.
    const proxiedExecContext = args.portfolioOverrideUsd
      ? verifyPlanPortfolioProxy(execContext, args.portfolioOverrideUsd)
      : execContext;
    const result = (await (legacyCheckRisk.execute as any)(
      {
        symbol: plan.symbol,
        side: plan.direction === "long" ? "BUY" : "SELL",
        type: plan.entry.type === "limit" ? "LIMIT" : "MARKET",
        quantity,
        price: plan.entry.price,
        stopLoss: plan.stopLoss.price,
        takeProfit: plan.takeProfit.map((tp: { price: number }) => tp.price),
      },
      proxiedExecContext,
    )) as {
      approved?: boolean;
      reason?: string;
      warnings?: string[];
      error?: string;
    };

    const approved = result.approved === true;
    const warnings = result.warnings ?? [];
    const verdict: "approve" | "conditional" | "reject" = result.error
      ? "reject"
      : approved
        ? warnings.length === 0
          ? "approve"
          : "conditional"
        : "reject";
    const tier: "low" | "medium" | "high" | "critical" = result.error
      ? "critical"
      : approved
        ? warnings.length === 0
          ? "low"
          : "medium"
        : "high";

    return {
      planId: args.planId,
      verdict,
      riskTier: tier,
      constitutionViolations: warnings as unknown[],
      recommendation:
        verdict === "approve" ? "auto_approve" : verdict === "conditional" ? "prompt_user" : "block",
      summary: result.reason ?? result.error ?? "Verify complete.",
    };
  },
});

// ============================================================================
// approve_plan
// ============================================================================

export const approvePlanTool = createTool({
  id: "approve_plan",
  description: [
    "Approve a Plan for execution. Transitions Plan state DRAFT → APPROVED.",
    "Required: rationale (≥10 chars) explaining WHY the operator approved",
    "this particular Plan, especially when verify_plan returned conditional",
    "or reject (override path — operator takes responsibility).",
    "",
    "When approving despite a non-auto-approve verify_plan verdict, this",
    "tool ALSO writes a RULE_OVERRIDE audit event for adherence reporting.",
  ].join("\n"),
  inputSchema: z.object({
    planId: z.string(),
    rationale: z.string().min(10),
    overrideVerifyVerdict: z
      .boolean()
      .optional()
      .describe("Set true when approving despite verify_plan returning conditional/reject."),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    planId: z.string(),
    auditId: z.string().optional(),
    overrideRecorded: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { planId: string; rationale: string; overrideVerifyVerdict?: boolean },
    execContext?: MastraExecutionContext,
  ) => {
    try {
      const result = (await (legacyApprovePlan.execute as any)(
        { planId: args.planId },
        execContext,
      )) as { success?: boolean; error?: string };

      if (args.overrideVerifyVerdict) {
        auditLog.record(
          "operator",
          "RULE_OVERRIDE" as Parameters<typeof auditLog.record>[1],
          { planId: args.planId, scope: "verify_plan", rationale: args.rationale },
          "SUCCESS",
          { resultDetails: `Override approve_plan: ${args.rationale}`, planId: args.planId },
        );
      }

      return {
        success: Boolean(result.success ?? !result.error),
        planId: args.planId,
        overrideRecorded: args.overrideVerifyVerdict ?? false,
        error: result.error,
      };
    } catch (err) {
      return {
        success: false,
        planId: args.planId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// execute_plan
// ============================================================================

export const executePlanTool = createTool({
  id: "execute_plan",
  description: [
    "Execute an APPROVED Plan: dispatch Executor which places the actual",
    "venue-specific orders (place_market_order, place_limit_order,",
    "place_bracket_order, etc.).",
    "",
    "Audit log captures the full Plan → Verify → Approve → Execute chain",
    "for provenance.",
    "",
    "Plan must be in APPROVED state. Calling on a DRAFT plan returns an error.",
  ].join("\n"),
  inputSchema: z.object({
    planId: z.string(),
    rationale: z
      .string()
      .min(10)
      .describe(
        "One-sentence reason this execution is correct right now (e.g. 'User confirmed plan, BTC broke entry trigger at 100050').",
      ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    planId: z.string(),
    orders: z.array(z.unknown()).optional(),
    executionResult: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { planId: string; rationale: string },
    execContext?: MastraExecutionContext,
  ) => {
    try {
      const result = (await (legacyExecutePlan.execute as any)(
        { planId: args.planId, rationale: args.rationale },
        execContext,
      )) as {
        success?: boolean;
        error?: string;
        orders?: unknown[];
      };
      return {
        success: Boolean(result.success ?? !result.error),
        planId: args.planId,
        orders: result.orders ?? [],
        executionResult: result,
        error: result.error,
      };
    } catch (err) {
      return {
        success: false,
        planId: args.planId,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// cancel
// ============================================================================

export const cancelTool = createTool({
  id: "cancel",
  description: [
    "Cancel orders or close positions. One tool for both — pick via target.",
    "",
    "target values:",
    "  - 'order'        — cancel a specific open order by ID (requires id + symbol)",
    "  - 'all_orders'   — cancel ALL open orders for symbol (emergency)",
    "  - 'position'     — close a specific trade/position (market exit, requires tradeId in id)",
    "  - 'partial'      — partial position close (specify percentPct + tradeId in id)",
    "",
    "Required: reason (≥10 chars) for audit trail.",
  ].join("\n"),
  inputSchema: z
    .object({
      target: z.enum(["order", "all_orders", "position", "partial"]),
      id: z.string().optional().describe("Order or trade ID for single-target operations."),
      symbol: z.string().optional().describe("Required for 'order' and 'all_orders' targets."),
      percentPct: z.number().min(1).max(99).optional().describe("Percent to close for 'partial' target."),
      reason: z.string().min(10),
    })
    .refine(
      (v) => v.target !== "all_orders" || typeof v.symbol === "string",
      { message: "`symbol` is required when target='all_orders'.", path: ["symbol"] },
    )
    .refine(
      (v) => v.target !== "order" || (typeof v.id === "string" && typeof v.symbol === "string"),
      { message: "`id` and `symbol` are both required when target='order'.", path: ["id"] },
    )
    .refine(
      (v) => (v.target !== "position" && v.target !== "partial") || typeof v.id === "string",
      { message: "`id` (tradeId) is required when target='position' or 'partial'.", path: ["id"] },
    )
    .refine(
      (v) => v.target !== "partial" || typeof v.percentPct === "number",
      { message: "`percentPct` is required when target='partial'.", path: ["percentPct"] },
    ),
  outputSchema: z.object({
    success: z.boolean(),
    target: z.string(),
    cancelled: z.array(z.unknown()).optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: {
      target: "order" | "all_orders" | "position" | "partial";
      id?: string;
      symbol?: string;
      percentPct?: number;
      reason: string;
    },
    execContext?: MastraExecutionContext,
  ) => {
    const ctx = getGordonContext(execContext);
    try {
      switch (args.target) {
        case "order": {
          if (!ctx?.exchange) return { success: false, target: args.target, error: "No exchange connected." };
          if (!args.id || !args.symbol) {
            return { success: false, target: args.target, error: "Both `id` and `symbol` are required for target='order'." };
          }
          await ctx.exchange.cancelOrder(args.symbol, args.id);
          auditLog.record(
            "operator",
            "CANCEL_ORDER" as Parameters<typeof auditLog.record>[1],
            { orderId: args.id, symbol: args.symbol, reason: args.reason },
            "SUCCESS",
            { resultDetails: args.reason },
          );
          return { success: true, target: "order", cancelled: [{ orderId: args.id, symbol: args.symbol }] };
        }
        case "all_orders": {
          if (!ctx?.exchange) return { success: false, target: args.target, error: "No exchange connected." };
          if (!args.symbol) {
            return { success: false, target: args.target, error: "`symbol` is required for target='all_orders'." };
          }
          const cancelled = await ctx.exchange.cancelAllOrders(args.symbol);
          auditLog.record(
            "operator",
            "CANCEL_ALL_ORDERS" as Parameters<typeof auditLog.record>[1],
            { symbol: args.symbol, reason: args.reason, count: cancelled.length },
            "SUCCESS",
            { resultDetails: args.reason },
          );
          return { success: true, target: "all_orders", cancelled };
        }
        case "position": {
          if (!args.id) return { success: false, target: args.target, error: "`id` (tradeId) required." };
          const r = (await (legacyCloseTrade.execute as any)(
            { tradeId: args.id, reason: "MANUAL" },
            execContext,
          )) as { success?: boolean; error?: string; pnl?: number };
          return {
            success: Boolean(r.success),
            target: "position",
            cancelled: r.success ? [{ tradeId: args.id, pnl: r.pnl }] : [],
            error: r.error,
          };
        }
        case "partial": {
          if (!args.id) return { success: false, target: args.target, error: "`id` (tradeId) required." };
          if (!args.percentPct)
            return { success: false, target: args.target, error: "`percentPct` required for partial close." };
          const r = (await (legacyClosePartial.execute as any)(
            { tradeId: args.id, percentage: args.percentPct / 100, reason: "MANUAL" },
            execContext,
          )) as { success?: boolean; error?: string };
          return {
            success: Boolean(r.success),
            target: "partial",
            cancelled: r.success ? [{ tradeId: args.id, percent: args.percentPct }] : [],
            error: r.error,
          };
        }
      }
    } catch (err) {
      return {
        success: false,
        target: args.target,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
});

// ============================================================================
// backtest
// ============================================================================

export const backtestTool = createTool({
  id: "backtest",
  description: [
    "Run a backtest on a strategy spec. Returns key metrics (Sharpe, Sortino,",
    "max drawdown, win rate, profit factor).",
    "",
    "Two ways to bound the window — pick one:",
    "  - Calendar: pass startDate + endDate as ISO strings (e.g. '2024-01-01').",
    "    Preserves exact calendar alignment, useful for regime-specific or",
    "    walk-forward windows tied to real dates.",
    "  - Day-count: pass `days` (default 90). Simpler, but loses calendar",
    "    fidelity (e.g. can't isolate Q1-2024 cleanly).",
    "",
    "Calendar args take precedence when both are present.",
    "",
    "This is the ATOMIC backtest primitive — for comparison across strategies,",
    "parameter optimization, regime-conditional analysis, use the",
    "`backtest-validate` skill which composes multiple backtest calls.",
  ].join("\n"),
  inputSchema: z.object({
    strategyId: z.string().describe("Strategy slot ID or playbook name (e.g. 'support_bounce')."),
    symbol: z.string(),
    timeframe: z.enum(["15m", "30m", "1h", "4h", "1d"]).optional(),
    startDate: z.string().optional().describe("ISO date — supersedes `days` when provided."),
    endDate: z.string().optional(),
    days: z.number().int().positive().optional().describe("Lookback days when start/end omitted. Default 90."),
    initialCapitalUsd: z.number().positive().optional().describe("Default 10000."),
    market: z.enum(["auto", "crypto", "stocks"]).optional().describe("Default 'auto'."),
  }),
  outputSchema: z.object({
    metrics: z.unknown(),
    equityCurve: z.array(z.number()).optional(),
    trades: z.array(z.unknown()).optional(),
    summary: z.string(),
  }),
  execute: async (
    args: {
      strategyId: string;
      symbol: string;
      timeframe?: string;
      startDate?: string;
      endDate?: string;
      days?: number;
      initialCapitalUsd?: number;
      market?: "auto" | "crypto" | "stocks";
    },
    execContext?: MastraExecutionContext,
  ) => {
    // Calendar dates take precedence over day count when both could resolve.
    // The legacy runBacktestTool now accepts startTime/endTime epoch-ms; pass
    // them through to preserve calendar fidelity (walk-forward windows that
    // depend on exact dates need this).
    const hasCalendarRange = Boolean(args.startDate && args.endDate);
    const result = (await (legacyRunBacktest.execute as any)(
      {
        symbol: args.symbol,
        strategyId: args.strategyId,
        market: args.market ?? "auto",
        timeframe: args.timeframe ?? "4h",
        days: hasCalendarRange ? undefined : args.days ?? 90,
        ...(hasCalendarRange && {
          startTime: new Date(args.startDate as string).getTime(),
          endTime: new Date(args.endDate as string).getTime(),
        }),
        initialCapital: args.initialCapitalUsd ?? 10000,
        commission: 0.001,
      },
      execContext,
    )) as {
      result?: unknown;
      summary?: string;
      formattedSummary?: string;
      error?: string;
    };

    return {
      metrics: result.result ?? {},
      summary: result.summary ?? result.formattedSummary ?? result.error ?? "Backtest complete.",
    };
  },
});

export const planTools = {
  create_plan: createPlanTool,
  verify_plan: verifyPlanTool,
  approve_plan: approvePlanTool,
  execute_plan: executePlanTool,
  cancel: cancelTool,
  backtest: backtestTool,
};
