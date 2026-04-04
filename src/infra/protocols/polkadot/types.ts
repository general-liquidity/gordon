/**
 * Polkadot Agent Kit Types
 * Configuration and type definitions for the Polkadot Agent Kit integration
 *
 * Polkadot Agent Kit provides cross-chain capabilities on the Polkadot ecosystem:
 * balance checks, native transfers, XCM cross-chain transfers, nomination pool staking,
 * DEX swaps (Hydration), liquid staking (Bifrost vDOT), and identity registration.
 *
 * This module is additive — it does NOT modify the existing exchange adapter layer
 * or the Mastra agent system. It adds Polkadot ecosystem capabilities alongside
 * Gordon's existing CEX adapters and Base L2 tools.
 */

// ============================================================================
// Environment Variable Names
// ============================================================================

/**
 * Environment variable names for Polkadot Agent Kit
 * All are optional — Polkadot features are disabled when not configured
 */
export const POLKADOT_ENV_KEYS = {
  /** Polkadot account private key (hex-encoded, 0x...) */
  PRIVATE_KEY: "POLKADOT_PRIVATE_KEY",
  /** Polkadot account mnemonic (alternative to private key) */
  MNEMONIC: "POLKADOT_MNEMONIC",
  /** Key type: Sr25519 or Ed25519 (default: Ed25519) */
  KEY_TYPE: "POLKADOT_KEY_TYPE",
  /** Comma-separated chain IDs to connect to (default: all supported) */
  CHAINS: "POLKADOT_CHAINS",
} as const;

// ============================================================================
// Configuration Types
// ============================================================================

/**
 * Polkadot Agent Kit configuration parsed from environment variables
 */
export interface PolkadotKitConfig {
  privateKey?: string;
  mnemonic?: string;
  keyType: "Sr25519" | "Ed25519";
  chains?: string[];
}

// ============================================================================
// Result Types (structured responses for Mastra tools)
// ============================================================================

/**
 * Result from executing a Polkadot Agent Kit action
 * Actions return LLM-friendly strings — we wrap them with metadata
 */
export interface PolkadotKitActionResult {
  /** Whether the action succeeded */
  success: boolean;
  /** The action's string response (LLM-friendly) */
  result: string;
  /** Action name that was executed */
  action: string;
  /** Error message if failed */
  error?: string;
}
