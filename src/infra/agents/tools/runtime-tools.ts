/**
 * Runtime Tools (Mastra Format)
 *
 * Agent tools for interacting with the composable strategy runtime.
 * Allows agents to deploy/manage strategy slots, view portfolio state,
 * approve trades, and run health checks.
 *
 * All runtime operations are wrapped in try/catch -- runtime failures
 * should never crash agent execution.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { StrategyRuntime } from "../../../core/runtime/engine.ts";
import { AllocationStrategySchema } from "../../../core/runtime/types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("runtime-tools");

/**
 * Helper to get the runtime singleton.
 */
function getRuntime(): StrategyRuntime {
  return StrategyRuntime.getInstance();
}

// ============================================================================
// Deploy Strategy Tool
// ============================================================================

export const deployStrategyTool = createTool({
  id: "deploy_strategy",
  description:
    "Deploy a playbook as a running strategy with allocated capital. " +
    "Creates a new strategy slot that will accept trades based on the playbook's rules.",
  inputSchema: z.object({
    playbook_name: z
      .string()
      .describe("Name/ID of the playbook to deploy (e.g., 'momentum-breakout')"),
    allocated_percent: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Percentage of total portfolio to allocate (default: 20%)"),
    max_positions: z
      .number()
      .int()
      .min(1)
      .max(50)
      .optional()
      .describe("Maximum concurrent positions for this slot (default: 3)"),
    max_daily_trades: z
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum trades per day for this slot (default: 10)"),
    max_loss_percent: z
      .number()
      .min(1)
      .max(100)
      .optional()
      .describe("Maximum loss percentage before auto-pause (default: 10%)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    slot_id: z.string().optional(),
    playbook_name: z.string().optional(),
    allocated_capital: z.number().optional(),
    allocated_percent: z.number().optional(),
    status: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({
    playbook_name,
    allocated_percent,
    max_positions,
    max_daily_trades,
    max_loss_percent,
  }) => {
    try {
      const runtime = getRuntime();
      const slot = runtime.deployStrategy(playbook_name, {
        allocated_percent,
        max_positions,
        max_daily_trades,
        max_loss_percent,
      });

      return {
        success: true,
        slot_id: slot.slot_id,
        playbook_name: slot.playbook_name,
        allocated_capital: slot.allocated_capital,
        allocated_percent: slot.allocated_percent,
        status: slot.status,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("deploy_strategy failed", { error: message });
      return { success: false, error: message };
    }
  },
});

// ============================================================================
// List Running Strategies Tool
// ============================================================================

export const listRunningStrategiesTool = createTool({
  id: "list_running_strategies",
  description:
    "Show all active strategy slots with their performance metrics. " +
    "Returns a formatted portfolio overview with each slot's status, PnL, and allocation.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    summary: z.string(),
    slot_count: z.number(),
    total_pnl: z.number(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const runtime = getRuntime();
      const state = runtime.getPortfolioState();
      const summary = runtime.formatPortfolioSummary();

      return {
        summary,
        slot_count: state.slots.filter((s) => s.status !== "stopped").length,
        total_pnl: state.total_pnl,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("list_running_strategies failed", { error: message });
      return { summary: "", slot_count: 0, total_pnl: 0, error: message };
    }
  },
});

// ============================================================================
// Pause Strategy Tool
// ============================================================================

export const pauseStrategyTool = createTool({
  id: "pause_strategy",
  description:
    "Pause a running strategy slot. Existing positions are maintained but no new trades will be opened.",
  inputSchema: z.object({
    slot_id: z.string().describe("Strategy slot ID to pause"),
    reason: z
      .string()
      .optional()
      .describe("Reason for pausing (for logging)"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    slot_id: z.string(),
    new_status: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ slot_id, reason }) => {
    try {
      const runtime = getRuntime();
      runtime.pauseStrategy(slot_id, reason);
      const slot = runtime.getSlot(slot_id);

      return {
        success: true,
        slot_id,
        new_status: slot?.status ?? "paused",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("pause_strategy failed", { error: message });
      return { success: false, slot_id, error: message };
    }
  },
});

// ============================================================================
// Resume Strategy Tool
// ============================================================================

export const resumeStrategyTool = createTool({
  id: "resume_strategy",
  description:
    "Resume a paused or cooldown strategy slot. The slot will start accepting new trades again.",
  inputSchema: z.object({
    slot_id: z.string().describe("Strategy slot ID to resume"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    slot_id: z.string(),
    new_status: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ slot_id }) => {
    try {
      const runtime = getRuntime();
      runtime.resumeStrategy(slot_id);
      const slot = runtime.getSlot(slot_id);

      return {
        success: true,
        slot_id,
        new_status: slot?.status ?? "active",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("resume_strategy failed", { error: message });
      return { success: false, slot_id, error: message };
    }
  },
});

// ============================================================================
// Stop Strategy Tool
// ============================================================================

export const stopStrategyTool = createTool({
  id: "stop_strategy",
  description:
    "Stop a strategy slot. If the slot has open positions, it transitions to draining " +
    "(closes positions, no new trades). If no positions, it stops immediately.",
  inputSchema: z.object({
    slot_id: z.string().describe("Strategy slot ID to stop"),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    slot_id: z.string(),
    new_status: z.string().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ slot_id }) => {
    try {
      const runtime = getRuntime();
      runtime.stopStrategy(slot_id);
      const slot = runtime.getSlot(slot_id);

      return {
        success: true,
        slot_id,
        new_status: slot?.status ?? "stopped",
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("stop_strategy failed", { error: message });
      return { success: false, slot_id, error: message };
    }
  },
});

// ============================================================================
// Get Portfolio State Tool
// ============================================================================

export const getPortfolioStateTool = createTool({
  id: "get_portfolio_state",
  description:
    "Get the full portfolio view with risk metrics, capital allocation, " +
    "and all strategy slot details.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    summary: z.string(),
    total_capital: z.number(),
    allocated_capital: z.number(),
    unallocated_capital: z.number(),
    deployed_capital: z.number(),
    total_pnl: z.number(),
    portfolio_drawdown_percent: z.number(),
    active_slots: z.number(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const runtime = getRuntime();
      const state = runtime.getPortfolioState();
      const summary = runtime.formatPortfolioSummary();

      return {
        summary,
        total_capital: state.total_capital,
        allocated_capital: state.allocated_capital,
        unallocated_capital: state.unallocated_capital,
        deployed_capital: state.deployed_capital,
        total_pnl: state.total_pnl,
        portfolio_drawdown_percent: state.portfolio_drawdown_percent,
        active_slots: state.slots.filter((s) => s.status !== "stopped").length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("get_portfolio_state failed", { error: message });
      return {
        summary: "",
        total_capital: 0,
        allocated_capital: 0,
        unallocated_capital: 0,
        deployed_capital: 0,
        total_pnl: 0,
        portfolio_drawdown_percent: 0,
        active_slots: 0,
        error: message,
      };
    }
  },
});

// ============================================================================
// Rebalance Portfolio Tool
// ============================================================================

export const rebalancePortfolioTool = createTool({
  id: "rebalance_portfolio",
  description:
    "Trigger capital rebalancing across all active strategy slots. " +
    "Adjusts allocations based on the chosen strategy (equal_weight, risk_parity, performance, fixed).",
  inputSchema: z.object({
    strategy: AllocationStrategySchema.optional().describe(
      "Allocation strategy: equal_weight, risk_parity, performance, or fixed (default: equal_weight)"
    ),
  }),
  outputSchema: z.object({
    success: z.boolean(),
    actions: z.array(
      z.object({
        slot_id: z.string(),
        action: z.string(),
        from_amount: z.number(),
        to_amount: z.number(),
        reason: z.string(),
      })
    ),
    changes: z.number(),
    error: z.string().optional(),
  }),
  execute: async ({ strategy }) => {
    try {
      const runtime = getRuntime();
      const actions = runtime.rebalance(strategy);

      return {
        success: true,
        actions: actions.map((a) => ({
          slot_id: a.slot_id,
          action: a.action,
          from_amount: a.from_amount,
          to_amount: a.to_amount,
          reason: a.reason,
        })),
        changes: actions.filter((a) => a.action !== "unchanged").length,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("rebalance_portfolio failed", { error: message });
      return { success: false, actions: [], changes: 0, error: message };
    }
  },
});

// ============================================================================
// Check Portfolio Health Tool
// ============================================================================

export const checkPortfolioHealthTool = createTool({
  id: "check_portfolio_health",
  description:
    "Run a health check across all strategy slots and the portfolio. " +
    "Returns any warnings or auto-actions taken (e.g., pausing slots that breached limits).",
  inputSchema: z.object({}),
  outputSchema: z.object({
    healthy: z.boolean(),
    actions: z.array(
      z.object({
        type: z.string(),
        slot_id: z.string().optional(),
        reason: z.string(),
        severity: z.string(),
      })
    ),
    warnings: z.number(),
    critical: z.number(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const runtime = getRuntime();
      const actions = runtime.runHealthCheck();

      const warnings = actions.filter((a) => a.severity === "warning").length;
      const critical = actions.filter((a) => a.severity === "critical").length;

      return {
        healthy: actions.length === 0,
        actions: actions.map((a) => ({
          type: a.type,
          slot_id: a.slot_id,
          reason: a.reason,
          severity: a.severity,
        })),
        warnings,
        critical,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("check_portfolio_health failed", { error: message });
      return {
        healthy: false,
        actions: [],
        warnings: 0,
        critical: 0,
        error: message,
      };
    }
  },
});

// ============================================================================
// Approve Strategy Trade Tool
// ============================================================================

export const approveStrategyTradeTool = createTool({
  id: "approve_strategy_trade",
  description:
    "Check if a proposed trade is allowed by the runtime. " +
    "Runs both slot-level checks (capital, daily limits) and portfolio-level checks " +
    "(exposure, drawdown, concentration). Called by the Executor agent before placing orders.",
  inputSchema: z.object({
    slot_id: z.string().describe("Strategy slot ID requesting the trade"),
    symbol: z.string().describe("Trading pair symbol (e.g., 'BTC/USDT')"),
    side: z
      .enum(["long", "short"])
      .describe("Trade direction"),
    size_usd: z
      .number()
      .positive()
      .describe("Trade size in USD"),
  }),
  outputSchema: z.object({
    approved: z.boolean(),
    reasons: z.array(z.string()),
    error: z.string().optional(),
  }),
  execute: async ({ slot_id, symbol, side, size_usd }) => {
    try {
      const runtime = getRuntime();
      const result = runtime.approveTradeForSlot(slot_id, {
        symbol,
        side,
        size_usd,
      });

      return {
        approved: result.approved,
        reasons: result.reasons,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error("approve_strategy_trade failed", { error: message });
      return { approved: false, reasons: [message], error: message };
    }
  },
});

// ============================================================================
// Export as Object (Mastra format)
// ============================================================================

/**
 * Runtime tools exported as an object for Mastra Agent.
 * This is the format expected by Mastra's Agent class.
 */
export const runtimeTools = {
  deploy_strategy: deployStrategyTool,
  list_running_strategies: listRunningStrategiesTool,
  pause_strategy: pauseStrategyTool,
  resume_strategy: resumeStrategyTool,
  stop_strategy: stopStrategyTool,
  get_portfolio_state: getPortfolioStateTool,
  rebalance_portfolio: rebalancePortfolioTool,
  check_portfolio_health: checkPortfolioHealthTool,
  approve_strategy_trade: approveStrategyTradeTool,
};
