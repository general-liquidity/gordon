/**
 * CDP AgentKit Integration
 *
 * Provides onchain execution capabilities via Coinbase Developer Platform:
 * - Wallet management (CDP Server Wallet on Base)
 * - Native ETH transfers
 * - ERC20 token operations (balance, transfer)
 * - ETH wrapping/unwrapping (WETH)
 * - Testnet faucet
 *
 * This module is additive — it does NOT modify the existing exchange
 * adapter layer or Mastra agent system.
 */

// Types
export * from "./types.ts";

// Provider (AgentKit singleton + action execution)
export {
  isAgentKitConfigured,
  getAgentKit,
  getAction,
  executeAction,
  getAvailableActionNames,
} from "./provider.ts";
