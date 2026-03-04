/**
 * Polkadot Agent Kit — Asset Tools
 * Mastra createTool() wrappers for balance, transfer, and XCM actions
 *
 * Tools:
 * - polkadot_check_balance: Check DOT/KSM balance on any supported chain
 * - polkadot_transfer_native: Transfer native tokens on a Polkadot chain
 * - polkadot_xcm_transfer: Cross-chain transfer via XCM
 *
 * All tools gracefully handle the case where Polkadot keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isPolkadotKitConfigured } from "../../polkadotkit/index.ts";
import type { PolkadotKitActionResult } from "../../polkadotkit/index.ts";

// ============================================================================
// Helper
// ============================================================================

/**
 * Execute a Polkadot Agent Kit action with standardized error handling
 */
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

// ============================================================================
// Output schema (shared by all tools)
// ============================================================================

const polkadotResultSchema = z.object({
  success: z.boolean(),
  result: z.string(),
  action: z.string(),
  error: z.string().optional(),
});

// ============================================================================
// Balance Tools
// ============================================================================

/**
 * Check balance on a Polkadot ecosystem chain
 */
export const polkadotCheckBalanceTool = createTool({
  id: "polkadot_check_balance",
  description:
    "Check the native token balance (DOT, KSM, WND, etc.) on a Polkadot ecosystem chain. " +
    "Supported chains: polkadot, kusama, west (Westend testnet), paseo (testnet), " +
    "polkadot_asset_hub, kusama_asset_hub, west_asset_hub, paseo_asset_hub, " +
    "hydra (Hydration DEX), bifrost_polkadot. " +
    "Use when user asks about their Polkadot/DOT balance or Kusama/KSM balance.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID to check balance on (e.g., 'polkadot', 'kusama', 'west', 'hydra')"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain }) => safeExecuteAction("check_balance", { chain }),
});

// ============================================================================
// Transfer Tools
// ============================================================================

/**
 * Transfer native tokens on a Polkadot chain
 */
export const polkadotTransferNativeTool = createTool({
  id: "polkadot_transfer_native",
  description:
    "Transfer native tokens (DOT, KSM, WND, etc.) to another address on a Polkadot ecosystem chain. " +
    "IMPORTANT: Always confirm the amount and destination with the user before executing. " +
    "Requires ARMED mode for safety.",
  inputSchema: z.object({
    chain: z
      .string()
      .describe("Chain ID to transfer on (e.g., 'polkadot', 'kusama', 'west')"),
    to: z
      .string()
      .describe("Destination address (SS58 format, e.g., '5GrwvaEF5zXb26Fz9rcQpDWS57CtERHpNehXCPcNoHGKutQY')"),
    amount: z
      .string()
      .describe("Amount to transfer in human-readable units (e.g., '1.5' for 1.5 DOT)"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ chain, to, amount }) =>
    safeExecuteAction("transfer_native", { chain, to, amount }),
});

/**
 * Cross-chain transfer via XCM (Cross-Consensus Messaging)
 */
export const polkadotXcmTransferTool = createTool({
  id: "polkadot_xcm_transfer",
  description:
    "Transfer native tokens across Polkadot ecosystem chains using XCM (Cross-Consensus Messaging). " +
    "For example, transfer DOT from Polkadot relay chain to Polkadot Asset Hub, " +
    "or transfer tokens between parachains. " +
    "IMPORTANT: Always confirm the amount, source chain, destination chain, and address with the user. " +
    "Requires ARMED mode.",
  inputSchema: z.object({
    from_chain: z
      .string()
      .describe("Source chain ID (e.g., 'polkadot', 'polkadot_asset_hub')"),
    to_chain: z
      .string()
      .describe("Destination chain ID (e.g., 'polkadot_asset_hub', 'hydra')"),
    to: z
      .string()
      .describe("Destination address (SS58 format)"),
    amount: z
      .string()
      .describe("Amount to transfer in human-readable units"),
  }),
  outputSchema: polkadotResultSchema,
  execute: async ({ from_chain, to_chain, to, amount }) =>
    safeExecuteAction("xcm_transfer_native_asset", { from_chain, to_chain, to, amount }),
});

// ============================================================================
// Export as Mastra tool object
// ============================================================================

/**
 * Polkadot Agent Kit asset tools exported as an object for Mastra Agent
 */
export const polkadotKitAssetTools = {
  polkadot_check_balance: polkadotCheckBalanceTool,
  polkadot_transfer_native: polkadotTransferNativeTool,
  polkadot_xcm_transfer: polkadotXcmTransferTool,
};
