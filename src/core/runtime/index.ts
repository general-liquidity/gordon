/**
 * Strategy Runtime Module
 *
 * Composable strategy runtime that manages multiple playbooks running
 * simultaneously with portfolio-level risk coordination and capital allocation.
 *
 * Usage:
 * ```ts
 * import { strategyRuntime } from "./index.ts";
 *
 * // Set total capital
 * strategyRuntime.setTotalCapital(10000);
 *
 * // Deploy a strategy
 * const slot = strategyRuntime.deployStrategy("momentum-breakout", {
 *   allocated_percent: 30,
 *   max_positions: 3,
 * });
 *
 * // Approve a trade
 * const { approved, reasons } = strategyRuntime.approveTradeForSlot(
 *   slot.slot_id,
 *   { symbol: "BTC/USDT", side: "long", size_usd: 500 }
 * );
 *
 * // Get portfolio overview
 * console.log(strategyRuntime.formatPortfolioSummary());
 * ```
 */

// Types
export {
  StrategySlotSchema,
  PortfolioStateSchema,
  AllocationStrategySchema,
  PortfolioRiskConfigSchema,
  SlotTradeRecordSchema,
  PortfolioSnapshotSchema,
  DEFAULT_PORTFOLIO_RISK_CONFIG,
  type StrategySlot,
  type SlotStatus,
  type PortfolioState,
  type AllocationStrategy,
  type RebalanceAction,
  type AutoAction,
  type PortfolioRiskConfig,
  type SlotTradeRecord,
  type PortfolioSnapshot,
} from "./types.ts";

// Engine
export { StrategyRuntime } from "./engine.ts";

// Allocator
export { CapitalAllocator } from "./allocator.ts";

// Coordinator
export { PortfolioCoordinator } from "./coordinator.ts";

// Store
export {
  RuntimeStore,
  getRuntimeStore,
  resetRuntimeStore,
  initRuntimeTables,
} from "./store.ts";

// ============================================================================
// Singleton Instance
// ============================================================================

import { StrategyRuntime } from "./engine.ts";

/**
 * Default Strategy Runtime singleton.
 * Import this for all runtime operations.
 */
export const strategyRuntime = StrategyRuntime.getInstance();
