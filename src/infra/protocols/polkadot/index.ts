/**
 * Polkadot Agent Kit Integration
 *
 * Provides Polkadot ecosystem capabilities:
 * - Balance checks across 12+ chains
 * - Native DOT/KSM transfers
 * - XCM cross-chain transfers
 * - Nomination pool staking (join, bond, unbond, claim rewards)
 * - DEX swaps via Hydration
 * - Liquid staking via Bifrost (vDOT)
 * - Identity registration on People Chain
 *
 * This module is additive — it does NOT modify the existing exchange
 * adapter layer or Mastra agent system.
 */

// Types
export * from "./types.ts";

// Provider (PolkadotAgentKit singleton + action execution)
export {
  isPolkadotKitConfigured,
  getPolkadotKit,
  getAction,
  executeAction,
  getAvailableActionNames,
} from "./provider.ts";
