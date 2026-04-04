/**
 * Polkadot Agent Kit — DeFi & Utility Tools
 * Mastra createTool() wrappers for swap, liquid staking, identity, and chain init
 *
 * Tools:
 * - polkadot_swap_tokens: DEX swap via Hydration (HydraDX)
 * - polkadot_mint_vdot: Liquid staking via Bifrost (DOT → vDOT)
 * - polkadot_register_identity: Register on-chain identity on People Chain
 * - polkadot_initialize_chain: Initialize connection to a specific chain
 *
 * All tools gracefully handle the case where Polkadot keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isPolkadotKitConfigured } from "../../protocols/polkadot/index.ts";
import type { PolkadotKitActionResult } from "../../protocols/polkadot/index.ts";

// ============================================================================
// Helper
// ============================================================================

async function safeExecuteAction(
  actionName: string,
  args: Record<string, unknown> = {},
): Promise<PolkadotKitActionResult> {
  if (!isPolkadotKitConfigured()) {
    return {
      success: false,
      result: "",
      action: actionName,
      error: "Polkadot Agent Kit not configured. Set POLKADOT_PRIVATE_KEY or POLKADOT_MNEMONIC environment variable.",
    };
  }

  try {
    const result = await executeAction(actionName, args);
    return { success: true, result, action: actionName };
  } catch (error) {
    return {
      success: false,
      result: "",
      action: actionName,
      error: `Polkadot action "${actionName}" failed: ${(error as Error).message}`,
    };
  }
}

const polkadotResultSchema = z.object({
  success: z.boolean(),
  result: z.string(),
  action: z.string(),
  error: z.string().optional(),
});

// ============================================================================
// DEX Swap (Hydration)
// ============================================================================

export const polkadotSwapTokensTool = createTool({
  id: "polkadot_swap_tokens",
  description:
    "Swap tokens on Hydration DEX (formerly HydraDX), the largest DEX in the Polkadot ecosystem. " +
    "Supports DOT, USDT, USDC, HDX, WETH, WBTC, and other assets listed on Hydration. " +
    "IMPORTANT: Always confirm the swap details (tokens, amount, slippage) with the user. " +
    "Requires ARMED mode.",
  inputSchema: z.object({
    chain: z
      .string()
      .default("hydra")
      .describe("Chain ID (typically 'hydra' for Hydration DEX)"),
    token_in: z
      .string()
      .describe("Input token symbol or asset ID (e.g., 'DOT', 'USDT', 'HDX')"),
    token_out: z
      .string()
      .describe("Output token symbol or asset ID (e.g., 'USDC', 'WETH')"),
    amount: z
      .string()
      .describe("Amount of input token to swap (e.g., '10' for 10 DOT)"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, token_in, token_out, amount }) =>
    safeExecuteAction("swap_tokens", { chain, token_in, token_out, amount }),
});

// ============================================================================
// Liquid Staking (Bifrost vDOT)
// ============================================================================

export const polkadotMintVdotTool = createTool({
  id: "polkadot_mint_vdot",
  description:
    "Mint vDOT (voucher DOT) via Bifrost liquid staking. vDOT represents staked DOT " +
    "that earns staking rewards while remaining liquid and usable in DeFi. " +
    "Unlike nomination pool staking, vDOT has no unbonding period — you can swap it back instantly. " +
    "IMPORTANT: Confirm amount with the user. Requires ARMED mode.",
  inputSchema: z.object({
    amount: z
      .string()
      .describe("Amount of DOT to stake for vDOT (e.g., '10' for 10 DOT)"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ amount }) =>
    safeExecuteAction("mint_vdot", { amount }),
});

// ============================================================================
// Identity Registration
// ============================================================================

export const polkadotRegisterIdentityTool = createTool({
  id: "polkadot_register_identity",
  description:
    "Register an on-chain identity on the Polkadot People Chain. " +
    "Sets a human-readable display name for your account visible across the ecosystem. " +
    "Identity registration requires a small deposit that is refunded when cleared. " +
    "Requires ARMED mode.",
  inputSchema: z.object({
    chain: z
      .string()
      .default("west_people")
      .describe("People Chain ID (e.g., 'west_people' for Westend testnet, 'paseo_people' for Paseo testnet)"),
    display_name: z
      .string()
      .describe("Display name to register (e.g., 'Gordon Trading Bot')"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, display_name }) =>
    safeExecuteAction("register_identity", { chain, display_name }),
});

// ============================================================================
// Chain Initialization
// ============================================================================

export const polkadotInitializeChainTool = createTool({
  id: "polkadot_initialize_chain",
  description:
    "Initialize a connection to a specific Polkadot ecosystem chain. " +
    "Useful when you need to explicitly connect to a chain before performing operations. " +
    "Most tools auto-initialize, but this can be used to pre-warm a connection.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID to initialize (e.g., 'polkadot', 'kusama', 'hydra', 'bifrost_polkadot')"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain }) =>
    safeExecuteAction("initialize_chain_api", { chain }),
});

// ============================================================================
// Export as Mastra tool object
// ============================================================================

export const polkadotKitDefiTools = {
  polkadot_swap_tokens: polkadotSwapTokensTool,
  polkadot_mint_vdot: polkadotMintVdotTool,
  polkadot_register_identity: polkadotRegisterIdentityTool,
  polkadot_initialize_chain: polkadotInitializeChainTool,
};
