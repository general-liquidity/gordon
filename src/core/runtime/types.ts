/**
 * Strategy Runtime Types
 *
 * Core types for the composable strategy runtime that manages
 * multiple playbooks running simultaneously with portfolio-level
 * risk coordination and capital allocation.
 *
 * Think of it as "Kubernetes for trading strategies" -- each
 * playbook is a workload, the runtime is the orchestrator.
 */

import { z } from "zod";

// ============================================================================
// Strategy Slot
// ============================================================================

/**
 * A "strategy slot" is a running instance of a playbook with allocated capital.
 * Each slot tracks its own performance, constraints, and lifecycle status.
 */
export const StrategySlotSchema = z.object({
  slot_id: z.string().uuid(),
  playbook_name: z.string(),

  // Capital allocation
  allocated_capital: z.number(),       // USD allocated to this strategy
  allocated_percent: z.number(),       // % of total portfolio
  used_capital: z.number(),            // currently deployed in positions
  available_capital: z.number(),       // allocated - used

  // Status
  status: z.enum([
    "active",     // accepting new trades
    "paused",     // not accepting new trades, existing positions maintained
    "cooldown",   // temporarily paused after hitting a limit
    "draining",   // closing existing positions, no new trades
    "stopped",    // fully stopped, no positions
  ]),

  // Constraints (override playbook defaults if set)
  max_positions: z.number(),
  max_daily_trades: z.number(),
  max_loss_percent: z.number(),        // max loss before auto-pause

  // Performance tracking (live)
  total_pnl: z.number(),
  total_trades: z.number(),
  winning_trades: z.number(),
  current_drawdown_percent: z.number(),
  peak_equity: z.number(),

  // Regime filter
  allowed_regimes: z.array(z.string()), // from playbook or override

  // Genome tracking (strategy evolution)
  genome_id: z.string().uuid().optional(),

  // Timing
  started_at: z.string().datetime(),
  paused_at: z.string().datetime().optional(),
  paused_reason: z.enum(["user", "regime", "cooldown", "health_check"]).optional(),
  last_trade_at: z.string().datetime().optional(),
});

export type StrategySlot = z.infer<typeof StrategySlotSchema>;

// ============================================================================
// Strategy Slot Status
// ============================================================================

export type SlotStatus = StrategySlot["status"];

// ============================================================================
// Portfolio State
// ============================================================================

/**
 * Portfolio-level view aggregating all running strategy slots.
 */
export const PortfolioStateSchema = z.object({
  total_capital: z.number(),
  allocated_capital: z.number(),     // sum of all slot allocations
  unallocated_capital: z.number(),   // total - allocated
  deployed_capital: z.number(),      // actually in positions

  total_open_positions: z.number(),
  total_pnl: z.number(),

  slots: z.array(StrategySlotSchema),

  // Portfolio-level risk
  portfolio_drawdown_percent: z.number(),
  portfolio_max_drawdown_percent: z.number(),
  correlation_risk: z.number(),      // 0-1, how correlated are active positions

  last_updated: z.string().datetime(),
});

export type PortfolioState = z.infer<typeof PortfolioStateSchema>;

// ============================================================================
// Allocation Strategy
// ============================================================================

/**
 * How capital is distributed across strategy slots.
 */
export const AllocationStrategySchema = z.enum([
  "equal_weight",   // split equally among active slots
  "risk_parity",    // allocate inversely to volatility
  "performance",    // allocate more to better-performing slots
  "fixed",          // manual fixed allocations
]);

export type AllocationStrategy = z.infer<typeof AllocationStrategySchema>;

// ============================================================================
// Rebalance Action
// ============================================================================

/**
 * Describes a capital rebalance action for a single slot.
 */
export interface RebalanceAction {
  slot_id: string;
  action: "increase" | "decrease" | "unchanged";
  from_amount: number;
  to_amount: number;
  reason: string;
}

// ============================================================================
// Auto Action
// ============================================================================

/**
 * Automatic portfolio-level action triggered by health checks.
 */
export interface AutoAction {
  type: "pause_slot" | "drain_slot" | "pause_all" | "rebalance";
  slot_id?: string;
  reason: string;
  severity: "warning" | "critical";
}

// ============================================================================
// Portfolio Risk Config
// ============================================================================

/**
 * Portfolio-level risk thresholds used by the coordinator.
 */
export const PortfolioRiskConfigSchema = z.object({
  max_total_exposure_percent: z.number().min(0).max(200).default(80),
  max_portfolio_drawdown_percent: z.number().min(0).max(100).default(20),
  max_direction_bias_percent: z.number().min(50).max(100).default(70),
  max_single_asset_concentration_percent: z.number().min(0).max(100).default(30),
  max_correlation_risk: z.number().min(0).max(1).default(0.7),
});

export type PortfolioRiskConfig = z.infer<typeof PortfolioRiskConfigSchema>;

export const DEFAULT_PORTFOLIO_RISK_CONFIG: PortfolioRiskConfig = {
  max_total_exposure_percent: 80,
  max_portfolio_drawdown_percent: 20,
  max_direction_bias_percent: 70,
  max_single_asset_concentration_percent: 30,
  max_correlation_risk: 0.7,
};

// ============================================================================
// Slot Trade Record
// ============================================================================

/**
 * A trade attributed to a specific strategy slot.
 */
export const SlotTradeRecordSchema = z.object({
  id: z.string(),
  slot_id: z.string().uuid(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  size_usd: z.number(),
  pnl: z.number(),
  fees: z.number(),
  opened_at: z.string().datetime(),
  closed_at: z.string().datetime().optional(),
});

export type SlotTradeRecord = z.infer<typeof SlotTradeRecordSchema>;

// ============================================================================
// Portfolio Snapshot
// ============================================================================

/**
 * Periodic snapshot of portfolio state for historical tracking.
 */
export const PortfolioSnapshotSchema = z.object({
  id: z.string(),
  total_capital: z.number(),
  allocated_capital: z.number(),
  deployed_capital: z.number(),
  total_pnl: z.number(),
  portfolio_drawdown_percent: z.number(),
  active_slots: z.number(),
  total_open_positions: z.number(),
  snapshot_at: z.string().datetime(),
});

export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>;
