/**
 * CDP AgentKit Types
 * Configuration and type definitions for the AgentKit integration
 *
 * AgentKit is Coinbase's framework-agnostic toolkit for giving AI agents
 * onchain capabilities: wallet management, token transfers, DEX swaps, etc.
 *
 * This module is additive — it does NOT modify the exchange adapter layer
 * or the Mastra agent system. It adds onchain execution capabilities
 * alongside Gordon's existing 5 CEX adapters and Base L2 read tools.
 */

// ============================================================================
// Environment Variable Names
// ============================================================================

/**
 * Environment variable names for CDP AgentKit
 * All are optional — AgentKit features are disabled when not configured
 */
export const CDP_ENV_KEYS = {
  /** CDP API Key ID from https://portal.cdp.coinbase.com */
  API_KEY_ID: "CDP_API_KEY_ID",
  /** CDP API Key Secret */
  API_KEY_SECRET: "CDP_API_KEY_SECRET",
  /** CDP Wallet Secret (for key derivation) */
  WALLET_SECRET: "CDP_WALLET_SECRET",
  /** Network ID (default: base-sepolia for safety) */
  NETWORK_ID: "CDP_NETWORK_ID",
} as const;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * AgentKit configuration parsed from environment variables
 */
export interface AgentKitConfig {
  apiKeyId: string;
  apiKeySecret: string;
  walletSecret: string;
  networkId: string;
}

/**
 * Supported CDP network IDs for Base
 */
export type CdpNetworkId = "base" | "base-sepolia";

// ============================================================================
// Result Types (structured responses for Mastra tools)
// ============================================================================

/**
 * Result from executing an AgentKit action
 * Actions return LLM-friendly strings — we wrap them with metadata
 */
export interface AgentKitActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** The action's string response (LLM-friendly) */
  result: string;
  /** Action name that was executed */
  action: string;
  /** Error message if failed */
  error?: string;
}
