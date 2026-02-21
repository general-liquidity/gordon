/**
 * Solana Agent Kit Types
 * Configuration and type definitions for the Solana Agent Kit integration
 *
 * Solana Agent Kit provides Solana ecosystem capabilities:
 * wallet management, Jupiter swaps, SOL/SPL transfers, limit orders,
 * PumpFun token launches, Pyth price feeds, rugcheck, and more.
 *
 * This module is additive — it does NOT modify the existing exchange adapter layer
 * or the Mastra agent system. It adds Solana ecosystem capabilities alongside
 * Gordon's existing CEX adapters, Base L2, and Polkadot tools.
 */

// ============================================================================
// Environment Variable Names
// ============================================================================

/**
 * Environment variable names for Solana Agent Kit
 * All are optional — Solana features are disabled when not configured
 */
export const SOLANA_ENV_KEYS = {
  /** Solana wallet private key (base58-encoded) */
  PRIVATE_KEY: "SOLANA_PRIVATE_KEY",
  /** Solana RPC URL (e.g., Helius, QuickNode, or public) */
  RPC_URL: "SOLANA_RPC_URL",
  /** Helius API key (optional, for enhanced token data) */
  HELIUS_API_KEY: "HELIUS_API_KEY",
  /** Jupiter referral account (optional) */
  JUPITER_REFERRAL_ACCOUNT: "JUPITER_REFERRAL_ACCOUNT",
  /** Jupiter fee in basis points (optional) */
  JUPITER_FEE_BPS: "JUPITER_FEE_BPS",
} as const;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Solana Agent Kit configuration parsed from environment variables
 */
export interface SolanaKitConfig {
  privateKey: string;
  rpcUrl: string;
  heliusApiKey?: string;
}

// ============================================================================
// Result Types (structured responses for Mastra tools)
// ============================================================================

/**
 * Result from executing a Solana Agent Kit action
 * Actions return Record<string, any> — we wrap them with metadata
 */
export interface SolanaKitActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** The action's string response (JSON-stringified) */
  result: string;
  /** Action name that was executed */
  action: string;
  /** Error message if failed */
  error?: string;
}
