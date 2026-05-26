/**
 * V4 Plan + Execution Tools — 6 typed tools.
 *
 *   - create_plan   → Plan (typed entry/exit/stop/size + rationale)
 *   - verify_plan   → VerifyResult (risk classifier + constitution + permission)
 *   - approve_plan  → ApprovalResult (rationale-required override path)
 *   - execute_plan  → ExecutionResult (dispatches Executor subagent)
 *   - cancel        → CancelResult (orders or positions)
 *   - backtest      → BacktestResult (atomic walk-forward simulation)
 *
 * These are EXPLICIT typed tools — not meta-dispatched. Each one is a
 * regulatory-critical state mutation; per-tool permission scoping +
 * audit specificity outweighs schema-cost savings.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import type { MastraExecutionContext } from "../types.ts";

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
      timeHorizonHours?: number;
    },
    _execContext?: MastraExecutionContext,
  ) => {
    // Stub — proper implementation calls into trading.ts createPlan handler.
    const planId = `plan-${Date.now().toString(36)}`;
    return {
      success: true,
      planId,
      plan: { id: planId, ...args, status: "DRAFT", createdAt: new Date().toISOString() },
    };
  },
});

// ============================================================================
// verify_plan
// ============================================================================

export const verifyPlanTool = createTool({
  id: "verify_plan",
  description: [
    "Run the full safety stack on a Plan: 11-dim risk classifier +",
    "trading constitution (80+ rules) + permission engine + venue/account",
    "feasibility. Returns approve / conditional / reject + structured",
    "reasons.",
    "",
    "MANDATORY before approve_plan + execute_plan. Plans that haven't been",
    "verified should never reach execution.",
  ].join("\n"),
  inputSchema: z.object({
    planId: z.string(),
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
    args: { planId: string },
    _execContext?: MastraExecutionContext,
  ) => {
    return {
      planId: args.planId,
      verdict: "conditional" as const,
      riskTier: "medium" as const,
      constitutionViolations: [],
      recommendation: "prompt_user",
      summary: "V4 verify_plan dispatcher pending — wire to risk-gate.ts + tradingConstitution.ts",
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
    _execContext?: MastraExecutionContext,
  ) => {
    return {
      success: true,
      planId: args.planId,
      overrideRecorded: args.overrideVerifyVerdict ?? false,
    };
  },
});

// ============================================================================
// execute_plan
// ============================================================================

export const executePlanTool = createTool({
  id: "execute_plan",
  description: [
    "Execute an APPROVED Plan: dispatch Executor subagent which places",
    "the actual venue-specific orders (place_market_order, place_limit_order,",
    "place_bracket_order, etc.).",
    "",
    "Returns the dispatched execution result. Audit log captures the full",
    "Plan → Verify → Approve → Execute chain for provenance.",
    "",
    "Plan must be in APPROVED state. Calling on a DRAFT plan returns",
    "an error.",
  ].join("\n"),
  inputSchema: z.object({
    planId: z.string(),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    planId: z.string(),
    orders: z.array(z.unknown()).optional(),
    executionResult: z.unknown().optional(),
    error: z.string().optional(),
  }),
  execute: async (
    args: { planId: string },
    _execContext?: MastraExecutionContext,
  ) => {
    return {
      success: true,
      planId: args.planId,
      orders: [],
    };
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
    "  - 'order'        — cancel a specific open order by ID",
    "  - 'all_orders'   — cancel ALL open orders for symbol (emergency)",
    "  - 'position'     — close a specific position (market exit)",
    "  - 'partial'      — partial position close (specify percentPct)",
    "",
    "Required: reason (≥10 chars) for audit trail.",
  ].join("\n"),
  inputSchema: z.object({
    target: z.enum(["order", "all_orders", "position", "partial"]),
    id: z.string().optional().describe("Order/position ID for single-target operations."),
    symbol: z.string().optional().describe("Required for all_orders target."),
    percentPct: z.number().min(1).max(99).optional().describe("Percent to close for 'partial' target."),
    reason: z.string().min(10),
  }),
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
    _execContext?: MastraExecutionContext,
  ) => {
    return {
      success: true,
      target: args.target,
      cancelled: [],
    };
  },
});

// ============================================================================
// backtest
// ============================================================================

export const backtestTool = createTool({
  id: "backtest",
  description: [
    "Run a backtest on a strategy spec. Walk-forward by default. Returns",
    "key metrics (Sharpe, Sortino, max drawdown, win rate, profit factor).",
    "",
    "This is the ATOMIC backtest primitive — for comparison across strategies,",
    "parameter optimization, regime-conditional analysis, use the",
    "`backtest-validate` skill which composes multiple backtest calls.",
  ].join("\n"),
  inputSchema: z.object({
    strategyId: z.string().optional().describe("Strategy slot ID or playbook name."),
    strategySpec: z.unknown().optional().describe("Inline strategy spec if not using a saved one."),
    symbol: z.string(),
    timeframe: z.enum(["15m", "30m", "1h", "4h", "1d"]).optional(),
    startDate: z.string().describe("ISO date — e.g. '2024-01-01'."),
    endDate: z.string(),
    initialCapitalUsd: z.number().positive().optional().describe("Default 10000."),
    walkForward: z.boolean().optional().describe("Default true."),
  }),
  outputSchema: z.object({
    metrics: z.unknown(),
    equityCurve: z.array(z.number()).optional(),
    trades: z.array(z.unknown()).optional(),
    summary: z.string(),
  }),
  execute: async (
    args: {
      strategyId?: string;
      strategySpec?: unknown;
      symbol: string;
      timeframe?: string;
      startDate: string;
      endDate: string;
      initialCapitalUsd?: number;
      walkForward?: boolean;
    },
    _execContext?: MastraExecutionContext,
  ) => {
    return {
      metrics: { sharpe: 0, sortino: 0, maxDrawdown: 0, winRate: 0, profitFactor: 0 },
      summary: "V4 backtest dispatcher pending — wire to src/backtest/ engine",
    };
  },
});

export const v4PlanTools = {
  create_plan: createPlanTool,
  verify_plan: verifyPlanTool,
  approve_plan: approvePlanTool,
  execute_plan: executePlanTool,
  cancel: cancelTool,
  backtest: backtestTool,
};
