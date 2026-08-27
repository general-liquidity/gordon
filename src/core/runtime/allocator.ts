/**
 * Capital Allocator
 *
 * Manages how capital is distributed across strategy slots.
 * Supports four allocation strategies:
 *   - equal_weight: Split equally among active slots
 *   - risk_parity: Inverse volatility weighting (lower vol gets more capital)
 *   - performance: Sharpe-weighted (better risk-adjusted returns get more)
 *   - fixed: Use the slot's existing allocated_percent directly
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import type { StrategySlot, AllocationStrategy, RebalanceAction } from "./types.ts";

const logger = createModuleLogger("capital-allocator");

// ============================================================================
// Capital Allocator
// ============================================================================

export class CapitalAllocator {
  // ==========================================================================
  // Calculate Allocations
  // ==========================================================================

  /**
   * Calculate allocation for each slot given total capital and strategy.
   *
   * @param totalCapital - Total portfolio capital in USD
   * @param slots - Active strategy slots
   * @param strategy - Allocation strategy to use
   * @param performanceData - Optional performance data for risk_parity/performance strategies
   * @returns Map of slot_id to allocated USD amount
   */
  calculateAllocations(
    totalCapital: number,
    slots: StrategySlot[],
    strategy: AllocationStrategy,
    performanceData?: Record<string, { sharpe: number; volatility: number }>,
  ): Map<string, number> {
    const activeSlots = slots.filter(
      (s) => s.status === "active" || s.status === "paused" || s.status === "cooldown",
    );

    if (activeSlots.length === 0) {
      return new Map();
    }

    switch (strategy) {
      case "equal_weight":
        return this.equalWeight(totalCapital, activeSlots);
      case "risk_parity":
        return this.riskParity(totalCapital, activeSlots, performanceData);
      case "performance":
        return this.performanceBased(totalCapital, activeSlots, performanceData);
      case "fixed":
        return this.fixed(totalCapital, activeSlots);
      default: {
        logger.warn("Unknown allocation strategy, falling back to equal_weight", {
          strategy,
        });
        return this.equalWeight(totalCapital, activeSlots);
      }
    }
  }

  // ==========================================================================
  // Rebalance
  // ==========================================================================

  /**
   * Rebalance: adjust allocations based on current performance.
   * Returns a list of actions describing what should change.
   *
   * @param slots - Current strategy slots
   * @param totalCapital - Total portfolio capital
   * @param strategy - Allocation strategy to use
   * @returns Array of rebalance actions
   */
  rebalance(
    slots: StrategySlot[],
    totalCapital: number,
    strategy: AllocationStrategy,
  ): RebalanceAction[] {
    const targetAllocations = this.calculateAllocations(totalCapital, slots, strategy);
    const actions: RebalanceAction[] = [];

    for (const slot of slots) {
      const target = targetAllocations.get(slot.slot_id);
      if (target === undefined) {
        // Slot is draining/stopped -- no rebalance action needed
        continue;
      }

      const current = slot.allocated_capital;
      const diff = Math.abs(target - current);
      // Only rebalance if the difference is > 1% of total capital
      const threshold = totalCapital * 0.01;

      if (diff <= threshold) {
        actions.push({
          slot_id: slot.slot_id,
          action: "unchanged",
          from_amount: current,
          to_amount: current,
          reason: `Allocation within 1% threshold (current: $${current.toFixed(2)}, target: $${target.toFixed(2)})`,
        });
      } else if (target > current) {
        actions.push({
          slot_id: slot.slot_id,
          action: "increase",
          from_amount: current,
          to_amount: target,
          reason: `Increasing allocation by $${(target - current).toFixed(2)} (${strategy})`,
        });
      } else {
        actions.push({
          slot_id: slot.slot_id,
          action: "decrease",
          from_amount: current,
          to_amount: target,
          reason: `Decreasing allocation by $${(current - target).toFixed(2)} (${strategy})`,
        });
      }
    }

    return actions;
  }

  // ==========================================================================
  // Trade Feasibility
  // ==========================================================================

  /**
   * Check if a new trade fits within the slot's allocation.
   *
   * @param slot - The strategy slot
   * @param tradeSize - Proposed trade size in USD
   * @returns Whether the trade is allowed and reason if not
   */
  canTrade(slot: StrategySlot, tradeSize: number): { allowed: boolean; reason?: string } {
    // Check slot status
    if (slot.status !== "active") {
      return {
        allowed: false,
        reason: `Slot is ${slot.status}, not accepting new trades`,
      };
    }

    // Check available capital
    if (tradeSize > slot.available_capital) {
      return {
        allowed: false,
        reason: `Trade size $${tradeSize.toFixed(2)} exceeds available capital $${slot.available_capital.toFixed(2)}`,
      };
    }

    // Check max loss
    if (slot.current_drawdown_percent >= slot.max_loss_percent) {
      return {
        allowed: false,
        reason: `Slot drawdown ${slot.current_drawdown_percent.toFixed(1)}% has reached max loss limit ${slot.max_loss_percent}%`,
      };
    }

    return { allowed: true };
  }

  // ==========================================================================
  // Private: Allocation Strategies
  // ==========================================================================

  /**
   * Equal weight: divide total capital equally among active slots.
   */
  private equalWeight(totalCapital: number, slots: StrategySlot[]): Map<string, number> {
    const perSlot = totalCapital / slots.length;
    const allocations = new Map<string, number>();

    for (const slot of slots) {
      allocations.set(slot.slot_id, perSlot);
    }

    return allocations;
  }

  /**
   * Risk parity: allocate inversely to volatility.
   * Lower volatility strategies get more capital.
   * Falls back to equal weight if no performance data is available.
   */
  private riskParity(
    totalCapital: number,
    slots: StrategySlot[],
    performanceData?: Record<string, { sharpe: number; volatility: number }>,
  ): Map<string, number> {
    if (!performanceData) {
      logger.debug("No performance data for risk_parity, using equal_weight");
      return this.equalWeight(totalCapital, slots);
    }

    // Inverse volatility weights
    const weights: { slot: StrategySlot; weight: number }[] = [];
    let totalWeight = 0;

    for (const slot of slots) {
      const data = performanceData[slot.slot_id];
      if (!data || data.volatility <= 0) {
        // No data -- assign a default weight of 1
        weights.push({ slot, weight: 1 });
        totalWeight += 1;
      } else {
        const invVol = 1 / data.volatility;
        weights.push({ slot, weight: invVol });
        totalWeight += invVol;
      }
    }

    const allocations = new Map<string, number>();
    if (totalWeight <= 0) {
      return this.equalWeight(totalCapital, slots);
    }

    for (const { slot, weight } of weights) {
      const allocation = (weight / totalWeight) * totalCapital;
      allocations.set(slot.slot_id, allocation);
    }

    return allocations;
  }

  /**
   * Performance-based: allocate proportionally to Sharpe ratio.
   * Better risk-adjusted performance gets more capital.
   * Negative Sharpe ratios are clamped to a small positive minimum.
   * Falls back to equal weight if no performance data is available.
   */
  private performanceBased(
    totalCapital: number,
    slots: StrategySlot[],
    performanceData?: Record<string, { sharpe: number; volatility: number }>,
  ): Map<string, number> {
    if (!performanceData) {
      logger.debug("No performance data for performance strategy, using equal_weight");
      return this.equalWeight(totalCapital, slots);
    }

    const MIN_SHARPE_WEIGHT = 0.1;
    const weights: { slot: StrategySlot; weight: number }[] = [];
    let totalWeight = 0;

    for (const slot of slots) {
      const data = performanceData[slot.slot_id];
      const weight = data ? Math.max(data.sharpe, MIN_SHARPE_WEIGHT) : MIN_SHARPE_WEIGHT;
      weights.push({ slot, weight });
      totalWeight += weight;
    }

    const allocations = new Map<string, number>();
    if (totalWeight <= 0) {
      return this.equalWeight(totalCapital, slots);
    }

    for (const { slot, weight } of weights) {
      const allocation = (weight / totalWeight) * totalCapital;
      allocations.set(slot.slot_id, allocation);
    }

    return allocations;
  }

  /**
   * Fixed: use each slot's existing allocated_percent.
   * Percentages are normalized if they don't sum to 100%.
   */
  private fixed(totalCapital: number, slots: StrategySlot[]): Map<string, number> {
    const totalPercent = slots.reduce((sum, s) => sum + s.allocated_percent, 0);
    const allocations = new Map<string, number>();

    for (const slot of slots) {
      const normalizedPercent =
        totalPercent > 0 ? slot.allocated_percent / totalPercent : 1 / slots.length;
      allocations.set(slot.slot_id, normalizedPercent * totalCapital);
    }

    return allocations;
  }
}
