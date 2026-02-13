/**
 * Base L2 Chain Integration
 *
 * Provides access to:
 * - Base Onchain Registry API (trending apps, featured projects)
 * - Base chain data via public RPC (gas prices, balances, blocks)
 * - Base network configuration and token addresses
 *
 * This module is additive — it does NOT modify the existing exchange
 * adapter layer. Base is an L2 chain, not a CEX. It adds onchain
 * capabilities alongside Gordon's existing 5 exchange adapters.
 */

// Types
export * from "./types.ts";

// Registry API client
export {
  getRegistryEntries,
  getRegistryFeatured,
  formatRegistryEntry,
  getTrendingBaseEntries,
  getActiveBaseEntries,
} from "./registry.ts";

// Chain data client
export {
  getBaseGasPrice,
  getLatestBlock,
  getBaseBalance,
  verifyBaseChainId,
  getBaseTokenBalance,
} from "./chain.ts";
