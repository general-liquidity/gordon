/**
 * Solana Agent Kit Integration
 *
 * Provides Solana ecosystem capabilities via native adapter:
 * - Wallet management (address, SOL balance, token balances)
 * - Jupiter DEX swaps with slippage control
 * - Jupiter limit orders (create, cancel, view)
 * - SOL and SPL token transfers
 * - PumpFun token launches
 * - Pyth oracle price feeds
 * - Token rugcheck analysis
 * - Mayan cross-chain swaps
 * - Compressed airdrops (ZK compression)
 * - Jupiter liquid staking (jupSOL)
 *
 * This module is additive — it does NOT modify the existing exchange
 * adapter layer or Mastra agent system.
 */

// Types
export * from "./types.ts";

// Provider (SolanaAgentKit singleton + action execution)
export {
  isSolanaKitConfigured,
  getSolanaKit,
  executeAction,
  getAvailableActionNames,
} from "./provider.ts";
