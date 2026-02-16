/**
 * Strategy Runtime Engine
 *
 * The main runtime that manages all strategy slots. Provides the
 * central API for deploying, pausing, resuming, and stopping strategies,
 * approving trades, recording results, and running health checks.
 *
 * Singleton pattern -- use StrategyRuntime.getInstance().
 *
 * This is the "Kubernetes for trading strategies" -- each playbook
 * is a workload, the runtime is the orchestrator.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import { playbookRegistry } from "../playbooks/registry.ts";
import { CapitalAllocator } from "./allocator.ts";
import { PortfolioCoordinator } from "./coordinator.ts";
import { RuntimeStore, getRuntimeStore } from "./store.ts";
import type {
  StrategySlot,
  PortfolioState,
  AllocationStrategy,
  RebalanceAction,
  AutoAction,
  PortfolioRiskConfig,
} from "./types.ts";

const logger = createModuleLogger("strategy-runtime");

// ============================================================================
// Strategy Runtime Engine
// ============================================================================

export class StrategyRuntime {
  private static instance: StrategyRuntime;

  private store: RuntimeStore;
  private allocator: CapitalAllocator;
  private coordinator: PortfolioCoordinator;
  private totalCapital: number;

  private constructor(config?: Partial<PortfolioRiskConfig>) {
    this.store = getRuntimeStore();
    this.allocator = new CapitalAllocator();
    this.coordinator = new PortfolioCoordinator(config);
    this.totalCapital = 0;
    logger.debug("Strategy runtime initialized");
  }

  /**
   * Get the singleton instance of the Strategy Runtime.
   */
  static getInstance(config?: Partial<PortfolioRiskConfig>): StrategyRuntime {
    if (!StrategyRuntime.instance) {
      StrategyRuntime.instance = new StrategyRuntime(config);
    }
    return StrategyRuntime.instance;
  }

  /**
   * Reset the singleton (for testing).
   */
  static resetInstance(): void {
    StrategyRuntime.instance = undefined as unknown as StrategyRuntime;
  }

  // ==========================================================================
  // Slot Management
  // ==========================================================================

  /**
   * Deploy a playbook as a running strategy slot.
   *
   * @param playbookName - Name/ID of the playbook from the registry
   * @param options - Optional overrides for the slot
   * @returns The newly created StrategySlot
   */
  deployStrategy(
    playbookName: string,
    options?: {
      allocated_percent?: number;
      max_positions?: number;
      max_daily_trades?: number;
      max_loss_percent?: number;
    }
  ): StrategySlot {
    // Verify playbook exists
    const playbook = playbookRegistry.get(playbookName);
    if (!playbook) {
      throw new Error(
        `Playbook "${playbookName}" not found. Available: ${playbookRegistry.getIds().join(", ") || "none"}`
      );
    }

    // Check for duplicate active deployment
    const existing = this.store.findSlotByPlaybook(playbookName);
    if (existing && (existing.status === "active" || existing.status === "paused")) {
      throw new Error(
        `Playbook "${playbookName}" is already deployed (slot: ${existing.slot_id}, status: ${existing.status}). ` +
          `Stop or drain it before redeploying.`
      );
    }

    const allocatedPercent = options?.allocated_percent ?? 20; // default 20%
    const allocatedCapital = (allocatedPercent / 100) * this.totalCapital;

    const slot: StrategySlot = {
      slot_id: crypto.randomUUID(),
      playbook_name: playbookName,
      allocated_capital: allocatedCapital,
      allocated_percent: allocatedPercent,
      used_capital: 0,
      available_capital: allocatedCapital,
      status: "active",
      max_positions: options?.max_positions ?? 3,
      max_daily_trades: options?.max_daily_trades ?? 10,
      max_loss_percent: options?.max_loss_percent ?? 10,
      total_pnl: 0,
      total_trades: 0,
      winning_trades: 0,
      current_drawdown_percent: 0,
      peak_equity: allocatedCapital,
      allowed_regimes: [],
      started_at: new Date().toISOString(),
    };

    this.store.saveSlot(slot);

    logger.info("Strategy deployed", {
      slot_id: slot.slot_id,
      playbook: playbookName,
      allocated_percent: allocatedPercent,
      allocated_capital: allocatedCapital,
    });

    return slot;
  }

  /**
   * Pause a strategy slot. Existing positions are maintained but no new trades.
   */
  pauseStrategy(slotId: string, reason?: string): void {
    const slot = this.getSlotOrThrow(slotId);

    if (slot.status !== "active" && slot.status !== "cooldown") {
      throw new Error(
        `Cannot pause slot ${slotId} in status "${slot.status}". Must be active or cooldown.`
      );
    }

    slot.status = "paused";
    slot.paused_at = new Date().toISOString();
    this.store.saveSlot(slot);

    logger.info("Strategy paused", { slot_id: slotId, reason });
  }

  /**
   * Resume a paused or cooldown strategy slot.
   */
  resumeStrategy(slotId: string): void {
    const slot = this.getSlotOrThrow(slotId);

    if (slot.status !== "paused" && slot.status !== "cooldown") {
      throw new Error(
        `Cannot resume slot ${slotId} in status "${slot.status}". Must be paused or cooldown.`
      );
    }

    slot.status = "active";
    slot.paused_at = undefined;
    this.store.saveSlot(slot);

    logger.info("Strategy resumed", { slot_id: slotId });
  }

  /**
   * Stop a strategy slot. Transitions to draining (close positions), then stopped.
   * If no positions are open, goes directly to stopped.
   */
  stopStrategy(slotId: string): void {
    const slot = this.getSlotOrThrow(slotId);

    if (slot.status === "stopped") {
      logger.debug("Slot already stopped", { slot_id: slotId });
      return;
    }

    if (slot.used_capital > 0) {
      slot.status = "draining";
      logger.info("Strategy draining (has open positions)", { slot_id: slotId });
    } else {
      slot.status = "stopped";
      logger.info("Strategy stopped", { slot_id: slotId });
    }

    this.store.saveSlot(slot);
  }

  // ==========================================================================
  // State Queries
  // ==========================================================================

  /**
   * Build the current portfolio state from all slots.
   */
  getPortfolioState(): PortfolioState {
    const allSlots = this.store.loadAllSlots();
    const activeSlots = allSlots.filter(
      (s) => s.status !== "stopped"
    );

    const allocatedCapital = activeSlots.reduce(
      (sum, s) => sum + s.allocated_capital,
      0
    );
    const deployedCapital = activeSlots.reduce(
      (sum, s) => sum + s.used_capital,
      0
    );
    const totalPnl = activeSlots.reduce((sum, s) => sum + s.total_pnl, 0);
    const totalOpenPositions = 0; // Would be computed from position manager

    // Portfolio drawdown
    const portfolioEquity = this.totalCapital + totalPnl;
    const portfolioDrawdown =
      this.totalCapital > 0
        ? Math.max(0, ((this.totalCapital - portfolioEquity) / this.totalCapital) * 100)
        : 0;

    // Peak drawdown (simplified -- track from slot peaks)
    const peakEquitySum = activeSlots.reduce(
      (sum, s) => sum + s.peak_equity,
      0
    );
    const currentEquitySum = activeSlots.reduce(
      (sum, s) => sum + (s.allocated_capital + s.total_pnl),
      0
    );
    const portfolioMaxDrawdown =
      peakEquitySum > 0
        ? Math.max(0, ((peakEquitySum - currentEquitySum) / peakEquitySum) * 100)
        : 0;

    return {
      total_capital: this.totalCapital,
      allocated_capital: allocatedCapital,
      unallocated_capital: Math.max(0, this.totalCapital - allocatedCapital),
      deployed_capital: deployedCapital,
      total_open_positions: totalOpenPositions,
      total_pnl: totalPnl,
      slots: allSlots,
      portfolio_drawdown_percent: portfolioDrawdown,
      portfolio_max_drawdown_percent: portfolioMaxDrawdown,
      correlation_risk: 0, // Would be computed from position correlations
      last_updated: new Date().toISOString(),
    };
  }

  /**
   * Get a single slot by ID.
   */
  getSlot(slotId: string): StrategySlot | null {
    return this.store.loadSlot(slotId);
  }

  /**
   * Get all active (non-stopped) slots.
   */
  getActiveSlots(): StrategySlot[] {
    const all = this.store.loadAllSlots();
    return all.filter(
      (s) => s.status === "active" || s.status === "paused" || s.status === "cooldown"
    );
  }

  // ==========================================================================
  // Trade Approval
  // ==========================================================================

  /**
   * Approve a trade for a specific slot.
   * Called by the executor agent before placing orders.
   * Runs both slot-level and portfolio-level checks.
   *
   * @param slotId - The slot requesting the trade
   * @param trade - The proposed trade details
   * @returns Approval result with reasons
   */
  approveTradeForSlot(
    slotId: string,
    trade: {
      symbol: string;
      side: "long" | "short";
      size_usd: number;
    }
  ): { approved: boolean; reasons: string[] } {
    const reasons: string[] = [];

    // Load slot
    const slot = this.store.loadSlot(slotId);
    if (!slot) {
      return { approved: false, reasons: [`Slot ${slotId} not found`] };
    }

    // Slot-level checks
    const canTrade = this.allocator.canTrade(slot, trade.size_usd);
    if (!canTrade.allowed) {
      reasons.push(canTrade.reason ?? "Slot-level check failed");
    }

    // Daily trade limit
    const todayCount = this.store.countTodaysTrades(slotId);
    if (todayCount >= slot.max_daily_trades) {
      reasons.push(
        `Daily trade limit reached: ${todayCount}/${slot.max_daily_trades}`
      );
    }

    // Portfolio-level checks
    const portfolioState = this.getPortfolioState();
    const portfolioCheck = this.coordinator.evaluatePortfolioRisk(
      portfolioState,
      {
        slot_id: slotId,
        symbol: trade.symbol,
        side: trade.side,
        size_usd: trade.size_usd,
      }
    );

    if (!portfolioCheck.allowed) {
      reasons.push(...portfolioCheck.reasons);
    }

    const approved = reasons.length === 0;

    logger.debug("Trade approval result", {
      slot_id: slotId,
      symbol: trade.symbol,
      approved,
      reasons,
    });

    return { approved, reasons };
  }

  // ==========================================================================
  // Trade Recording
  // ==========================================================================

  /**
   * Record a trade result for a slot.
   * Called after a trade completes (win or loss).
   *
   * @param slotId - The slot that executed the trade
   * @param result - The trade outcome
   */
  recordTradeResult(
    slotId: string,
    result: { pnl: number; fees: number }
  ): void {
    const slot = this.getSlotOrThrow(slotId);

    // Update slot performance
    slot.total_pnl += result.pnl;
    slot.total_trades += 1;
    if (result.pnl > 0) {
      slot.winning_trades += 1;
    }
    slot.last_trade_at = new Date().toISOString();

    // Update peak equity and drawdown
    const currentEquity = slot.allocated_capital + slot.total_pnl;
    if (currentEquity > slot.peak_equity) {
      slot.peak_equity = currentEquity;
    }
    slot.current_drawdown_percent =
      slot.peak_equity > 0
        ? Math.max(0, ((slot.peak_equity - currentEquity) / slot.peak_equity) * 100)
        : 0;

    // Update available capital
    slot.available_capital = Math.max(
      0,
      slot.allocated_capital + slot.total_pnl - slot.used_capital
    );

    // Auto-cooldown if max loss breached
    if (slot.current_drawdown_percent >= slot.max_loss_percent && slot.status === "active") {
      slot.status = "cooldown";
      slot.paused_at = new Date().toISOString();
      logger.warn("Slot auto-cooldown: max loss breached", {
        slot_id: slotId,
        drawdown: slot.current_drawdown_percent,
        max_loss: slot.max_loss_percent,
      });
    }

    // If draining and no more used capital, transition to stopped
    if (slot.status === "draining" && slot.used_capital <= 0) {
      slot.status = "stopped";
      logger.info("Slot drain complete, now stopped", { slot_id: slotId });
    }

    this.store.saveSlot(slot);

    logger.debug("Trade result recorded", {
      slot_id: slotId,
      pnl: result.pnl,
      total_pnl: slot.total_pnl,
      total_trades: slot.total_trades,
      win_rate:
        slot.total_trades > 0
          ? ((slot.winning_trades / slot.total_trades) * 100).toFixed(1) + "%"
          : "N/A",
    });
  }

  // ==========================================================================
  // Rebalancing
  // ==========================================================================

  /**
   * Rebalance capital across all active slots.
   *
   * @param strategy - Allocation strategy (defaults to equal_weight)
   * @returns Array of rebalance actions taken
   */
  rebalance(strategy?: AllocationStrategy): RebalanceAction[] {
    const effectiveStrategy = strategy ?? "equal_weight";
    const activeSlots = this.getActiveSlots();

    if (activeSlots.length === 0) {
      logger.debug("No active slots to rebalance");
      return [];
    }

    const actions = this.allocator.rebalance(
      activeSlots,
      this.totalCapital,
      effectiveStrategy
    );

    // Apply the rebalance actions
    for (const action of actions) {
      if (action.action === "unchanged") continue;

      const slot = this.store.loadSlot(action.slot_id);
      if (!slot) continue;

      slot.allocated_capital = action.to_amount;
      slot.allocated_percent =
        this.totalCapital > 0
          ? (action.to_amount / this.totalCapital) * 100
          : 0;
      slot.available_capital = Math.max(
        0,
        slot.allocated_capital + slot.total_pnl - slot.used_capital
      );

      this.store.saveSlot(slot);
    }

    logger.info("Portfolio rebalanced", {
      strategy: effectiveStrategy,
      slots: actions.length,
      changes: actions.filter((a) => a.action !== "unchanged").length,
    });

    return actions;
  }

  // ==========================================================================
  // Health Check
  // ==========================================================================

  /**
   * Run a health check across all slots and the portfolio.
   * Returns any auto-actions that should be taken.
   */
  runHealthCheck(): AutoAction[] {
    const state = this.getPortfolioState();
    const actions = this.coordinator.checkAutoActions(state);

    // Apply critical auto-actions
    for (const action of actions) {
      if (action.severity !== "critical") continue;

      if (action.type === "pause_all") {
        const activeSlots = this.getActiveSlots();
        for (const slot of activeSlots) {
          if (slot.status === "active") {
            slot.status = "paused";
            slot.paused_at = new Date().toISOString();
            this.store.saveSlot(slot);
          }
        }
        logger.warn("ALL strategies paused by health check", {
          reason: action.reason,
        });
      } else if (action.type === "pause_slot" && action.slot_id) {
        const slot = this.store.loadSlot(action.slot_id);
        if (slot && slot.status === "active") {
          slot.status = "cooldown";
          slot.paused_at = new Date().toISOString();
          this.store.saveSlot(slot);
          logger.warn("Strategy slot paused by health check", {
            slot_id: action.slot_id,
            reason: action.reason,
          });
        }
      } else if (action.type === "drain_slot" && action.slot_id) {
        const slot = this.store.loadSlot(action.slot_id);
        if (slot && slot.status !== "stopped" && slot.status !== "draining") {
          slot.status = "draining";
          this.store.saveSlot(slot);
          logger.warn("Strategy slot draining by health check", {
            slot_id: action.slot_id,
            reason: action.reason,
          });
        }
      }
    }

    return actions;
  }

  // ==========================================================================
  // Capital Management
  // ==========================================================================

  /**
   * Set the total portfolio capital (from exchange balance).
   * Updates all slot allocations proportionally.
   */
  setTotalCapital(amount: number): void {
    const oldCapital = this.totalCapital;
    this.totalCapital = amount;

    // Update slot allocations based on their allocated_percent
    const allSlots = this.store.loadAllSlots();
    for (const slot of allSlots) {
      if (slot.status === "stopped") continue;
      slot.allocated_capital = (slot.allocated_percent / 100) * amount;
      slot.available_capital = Math.max(
        0,
        slot.allocated_capital + slot.total_pnl - slot.used_capital
      );
      this.store.saveSlot(slot);
    }

    logger.info("Total capital updated", {
      from: oldCapital,
      to: amount,
      activeSlots: allSlots.filter((s) => s.status !== "stopped").length,
    });
  }

  // ==========================================================================
  // Display Formatting
  // ==========================================================================

  /**
   * Format a portfolio summary for terminal display.
   */
  formatPortfolioSummary(): string {
    const state = this.getPortfolioState();
    const lines: string[] = [];

    lines.push("=== Portfolio Summary ===");
    lines.push(`Total Capital:      $${state.total_capital.toFixed(2)}`);
    lines.push(`Allocated:          $${state.allocated_capital.toFixed(2)} (${state.total_capital > 0 ? ((state.allocated_capital / state.total_capital) * 100).toFixed(1) : 0}%)`);
    lines.push(`Unallocated:        $${state.unallocated_capital.toFixed(2)}`);
    lines.push(`Deployed:           $${state.deployed_capital.toFixed(2)}`);
    lines.push(`Total PnL:          $${state.total_pnl.toFixed(2)}`);
    lines.push(`Portfolio DD:       ${state.portfolio_drawdown_percent.toFixed(1)}%`);
    lines.push(`Correlation Risk:   ${state.correlation_risk.toFixed(2)}`);
    lines.push("");

    const activeSlots = state.slots.filter((s) => s.status !== "stopped");
    if (activeSlots.length === 0) {
      lines.push("No active strategy slots.");
    } else {
      lines.push(`Active Slots (${activeSlots.length}):`);
      lines.push("---");
      for (const slot of activeSlots) {
        const winRate =
          slot.total_trades > 0
            ? ((slot.winning_trades / slot.total_trades) * 100).toFixed(0)
            : "N/A";
        const statusIcon = slot.status === "active" ? "[ON]" : `[${slot.status.toUpperCase()}]`;
        lines.push(
          `  ${statusIcon} ${slot.playbook_name}  |  $${slot.allocated_capital.toFixed(0)} (${slot.allocated_percent.toFixed(0)}%)  |  PnL: $${slot.total_pnl.toFixed(2)}  |  Trades: ${slot.total_trades}  |  Win: ${winRate}%  |  DD: ${slot.current_drawdown_percent.toFixed(1)}%`
        );
      }
    }

    return lines.join("\n");
  }

  /**
   * Format detail view for a single slot.
   */
  formatSlotDetail(slotId: string): string {
    const slot = this.store.loadSlot(slotId);
    if (!slot) return `Slot ${slotId} not found.`;

    const winRate =
      slot.total_trades > 0
        ? ((slot.winning_trades / slot.total_trades) * 100).toFixed(1)
        : "N/A";

    const lines: string[] = [];
    lines.push(`=== Strategy Slot: ${slot.playbook_name} ===`);
    lines.push(`Slot ID:            ${slot.slot_id}`);
    lines.push(`Status:             ${slot.status.toUpperCase()}`);
    lines.push(`Started:            ${slot.started_at}`);
    if (slot.paused_at) {
      lines.push(`Paused:             ${slot.paused_at}`);
    }
    lines.push("");
    lines.push("--- Capital ---");
    lines.push(`Allocated:          $${slot.allocated_capital.toFixed(2)} (${slot.allocated_percent.toFixed(1)}%)`);
    lines.push(`Used:               $${slot.used_capital.toFixed(2)}`);
    lines.push(`Available:          $${slot.available_capital.toFixed(2)}`);
    lines.push("");
    lines.push("--- Performance ---");
    lines.push(`Total PnL:          $${slot.total_pnl.toFixed(2)}`);
    lines.push(`Total Trades:       ${slot.total_trades}`);
    lines.push(`Winning Trades:     ${slot.winning_trades}`);
    lines.push(`Win Rate:           ${winRate}%`);
    lines.push(`Current Drawdown:   ${slot.current_drawdown_percent.toFixed(1)}%`);
    lines.push(`Peak Equity:        $${slot.peak_equity.toFixed(2)}`);
    lines.push("");
    lines.push("--- Constraints ---");
    lines.push(`Max Positions:      ${slot.max_positions}`);
    lines.push(`Max Daily Trades:   ${slot.max_daily_trades}`);
    lines.push(`Max Loss:           ${slot.max_loss_percent}%`);
    if (slot.allowed_regimes.length > 0) {
      lines.push(`Allowed Regimes:    ${slot.allowed_regimes.join(", ")}`);
    }
    if (slot.last_trade_at) {
      lines.push(`Last Trade:         ${slot.last_trade_at}`);
    }

    return lines.join("\n");
  }

  // ==========================================================================
  // Snapshot
  // ==========================================================================

  /**
   * Take a portfolio snapshot for historical tracking.
   */
  takeSnapshot(): void {
    const state = this.getPortfolioState();
    const activeSlots = state.slots.filter((s) => s.status !== "stopped");

    this.store.saveSnapshot({
      id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      total_capital: state.total_capital,
      allocated_capital: state.allocated_capital,
      deployed_capital: state.deployed_capital,
      total_pnl: state.total_pnl,
      portfolio_drawdown_percent: state.portfolio_drawdown_percent,
      active_slots: activeSlots.length,
      total_open_positions: state.total_open_positions,
      snapshot_at: new Date().toISOString(),
    });

    logger.debug("Portfolio snapshot taken");
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Get a slot by ID, throwing if not found.
   */
  private getSlotOrThrow(slotId: string): StrategySlot {
    const slot = this.store.loadSlot(slotId);
    if (!slot) {
      throw new Error(`Strategy slot ${slotId} not found`);
    }
    return slot;
  }
}
