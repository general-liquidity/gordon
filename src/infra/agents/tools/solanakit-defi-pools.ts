/**
 * Solana Agent Kit — DeFi Liquidity Pool Tools
 * Mastra createTool() wrappers for Orca, Raydium, Meteora, and Manifest
 *
 * Tools:
 * - solana_orca_fetch_positions: Get Orca LP positions
 * - solana_orca_open_centered: Open centered Orca LP position
 * - solana_orca_open_single_sided: Open single-sided Orca LP position
 * - solana_orca_close_position: Close an Orca LP position
 * - solana_orca_create_clmm: Create Orca CLMM pool
 * - solana_orca_create_whirlpool: Create single-sided Orca Whirlpool
 * - solana_raydium_create_clmm: Create Raydium CLMM pool
 * - solana_raydium_create_cpmm: Create Raydium CPMM pool
 * - solana_meteora_create_dlmm: Create Meteora DLMM pool
 * - solana_manifest_limit_order: Place limit order on Manifest
 * - solana_manifest_cancel_orders: Cancel all Manifest orders
 * - solana_manifest_withdraw: Withdraw all from Manifest market
 *
 * All tools gracefully handle the case where Solana keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isSolanaKitConfigured } from "../../protocols/solana/index.ts";
import type { SolanaKitActionResult } from "../../protocols/solana/index.ts";

// ============================================================================
// Helper
// ============================================================================

async function safeExecuteAction(
  actionName: string,
  args: Record<string, unknown> = {},
): Promise<SolanaKitActionResult> {
  if (!isSolanaKitConfigured()) {
    return {
      success: false,
      result: "",
      action: actionName,
      error: "Solana Agent Kit not configured. Set SOLANA_PRIVATE_KEY and SOLANA_RPC_URL environment variables.",
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
      error: `Solana action "${actionName}" failed: ${(error as Error).message}`,
    };
  }
}

const solanaResultSchema = z.object({
  success: z.boolean(),
  result: z.string(),
  action: z.string(),
  error: z.string().optional(),
});

// ============================================================================
// Orca Whirlpool LP
// ============================================================================

export const solanaOrcaFetchPositionsTool = createTool({
  id: "solana_orca_fetch_positions",
  description: "Get all Orca Whirlpool LP positions for the wallet.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("ORCA_FETCH_POSITIONS"),
});

export const solanaOrcaOpenCenteredTool = createTool({
  id: "solana_orca_open_centered",
  description:
    "Open a centered liquidity position on an Orca Whirlpool. " +
    "Places liquidity symmetrically around the current price. Requires ARMED mode.",
  inputSchema: z.object({
    whirlpoolAddress: z.string().describe("Whirlpool pool address"),
    priceOffsetBps: z.number().describe("Price offset from center in basis points"),
    inputTokenMint: z.string().describe("Mint address of the token to deposit"),
    inputAmount: z.number().describe("Amount to deposit"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ whirlpoolAddress, priceOffsetBps, inputTokenMint, inputAmount }) =>
    safeExecuteAction("ORCA_OPEN_CENTERED_POSITION_WITH_LIQUIDITY", {
      whirlpoolAddress, priceOffsetBps, inputTokenMint, inputAmount,
    }),
});

export const solanaOrcaOpenSingleSidedTool = createTool({
  id: "solana_orca_open_single_sided",
  description:
    "Open a single-sided liquidity position on an Orca Whirlpool. Requires ARMED mode.",
  inputSchema: z.object({
    whirlpoolAddress: z.string().describe("Whirlpool pool address"),
    distanceFromCurrentPriceBps: z.number().describe("Distance from current price in bps"),
    widthBps: z.number().describe("Position width in basis points"),
    inputTokenMint: z.string().describe("Mint address of the token to deposit"),
    inputAmount: z.number().describe("Amount to deposit"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ whirlpoolAddress, distanceFromCurrentPriceBps, widthBps, inputTokenMint, inputAmount }) =>
    safeExecuteAction("ORCA_OPEN_SINGLE_SIDED_POSITION", {
      whirlpoolAddress, distanceFromCurrentPriceBps, widthBps, inputTokenMint, inputAmount,
    }),
});

export const solanaOrcaClosePositionTool = createTool({
  id: "solana_orca_close_position",
  description: "Close an Orca Whirlpool LP position and withdraw liquidity. Requires ARMED mode.",
  inputSchema: z.object({
    positionMintAddress: z.string().describe("Position mint address (NFT representing the LP position)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ positionMintAddress }) =>
    safeExecuteAction("ORCA_CLOSE_POSITION", { positionMintAddress }),
});

export const solanaOrcaCreateClmmTool = createTool({
  id: "solana_orca_create_clmm",
  description:
    "Create a new Orca CLMM (Concentrated Liquidity Market Maker) pool. Requires ARMED mode.",
  inputSchema: z.object({
    mintDeploy: z.string().describe("Deployed token mint address"),
    mintPair: z.string().describe("Paired token mint address"),
    initialPrice: z.number().describe("Initial pool price"),
    feeTier: z.number().describe("Fee tier in basis points (e.g., 64 for 0.64%)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ mintDeploy, mintPair, initialPrice, feeTier }) =>
    safeExecuteAction("ORCA_CREATE_CLMM", { mintDeploy, mintPair, initialPrice, feeTier }),
});

export const solanaOrcaCreateWhirlpoolTool = createTool({
  id: "solana_orca_create_whirlpool",
  description:
    "Create a single-sided Orca Whirlpool with initial deposit. Requires ARMED mode.",
  inputSchema: z.object({
    depositTokenAmount: z.number().describe("Amount of deposit token"),
    depositTokenMint: z.string().describe("Deposit token mint address"),
    otherTokenMint: z.string().describe("Other token mint address"),
    initialPrice: z.number().describe("Initial price of deposit token in other token"),
    maxPrice: z.number().describe("Maximum price for the range"),
    feeTierBps: z.number().describe("Fee tier in basis points"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ depositTokenAmount, depositTokenMint, otherTokenMint, initialPrice, maxPrice, feeTierBps }) =>
    safeExecuteAction("CREATE_ORCA_SINGLE_SIDED_WHIRLPOOL", {
      depositTokenAmount, depositTokenMint, otherTokenMint, initialPrice, maxPrice, feeTierBps,
    }),
});

// ============================================================================
// Raydium Pools
// ============================================================================

export const solanaRaydiumCreateClmmTool = createTool({
  id: "solana_raydium_create_clmm",
  description: "Create a Raydium CLMM concentrated liquidity pool. Requires ARMED mode.",
  inputSchema: z.object({
    mint1: z.string().describe("First token mint address"),
    mint2: z.string().describe("Second token mint address"),
    configId: z.string().describe("Pool configuration ID"),
    initialPrice: z.number().describe("Initial pool price"),
    startTime: z.number().describe("Pool start time (Unix timestamp)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ mint1, mint2, configId, initialPrice, startTime }) =>
    safeExecuteAction("RAYDIUM_CREATE_CLMM", { mint1, mint2, configId, initialPrice, startTime }),
});

export const solanaRaydiumCreateCpmmTool = createTool({
  id: "solana_raydium_create_cpmm",
  description: "Create a Raydium CPMM (constant product AMM) pool. Requires ARMED mode.",
  inputSchema: z.object({
    mintA: z.string().describe("Token A mint address"),
    mintB: z.string().describe("Token B mint address"),
    configId: z.string().describe("Pool configuration ID"),
    mintAAmount: z.string().describe("Token A initial amount (as string, in base units)"),
    mintBAmount: z.string().describe("Token B initial amount (as string, in base units)"),
    startTime: z.number().describe("Pool start time (Unix timestamp)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ mintA, mintB, configId, mintAAmount, mintBAmount, startTime }) =>
    safeExecuteAction("RAYDIUM_CREATE_CPMM", { mintA, mintB, configId, mintAAmount, mintBAmount, startTime }),
});

// ============================================================================
// Meteora Pools
// ============================================================================

export const solanaMeteoraCreateDlmmTool = createTool({
  id: "solana_meteora_create_dlmm",
  description: "Create a Meteora DLMM (Dynamic Liquidity Market Maker) pool. Requires ARMED mode.",
  inputSchema: z.object({
    binStep: z.number().describe("Bin step size"),
    tokenAMint: z.string().describe("Token A mint address"),
    tokenBMint: z.string().describe("Token B mint address"),
    initialPrice: z.number().describe("Initial price"),
    feeBps: z.number().describe("Fee in basis points"),
    activationType: z.string().describe("Activation type"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ binStep, tokenAMint, tokenBMint, initialPrice, feeBps, activationType }) =>
    safeExecuteAction("CREATE_METEORA_DLMM_POOL", {
      binStep, tokenAMint, tokenBMint, initialPrice, feeBps, activationType,
    }),
});

// ============================================================================
// Manifest DEX
// ============================================================================

export const solanaManifestLimitOrderTool = createTool({
  id: "solana_manifest_limit_order",
  description:
    "Place a limit order on Manifest DEX (Solana's on-chain orderbook). Requires ARMED mode.",
  inputSchema: z.object({
    marketId: z.string().describe("Manifest market public key"),
    quantity: z.number().describe("Order quantity"),
    side: z.string().describe("Order side: 'buy' or 'sell'"),
    price: z.number().describe("Limit price"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ marketId, quantity, side, price }) =>
    safeExecuteAction("PLACE_MANIFEST_LIMIT_ORDER", { marketId, quantity, side, price }),
});

export const solanaManifestCancelOrdersTool = createTool({
  id: "solana_manifest_cancel_orders",
  description: "Cancel all open orders on a Manifest DEX market. Requires ARMED mode.",
  inputSchema: z.object({
    marketId: z.string().describe("Manifest market public key"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ marketId }) =>
    safeExecuteAction("CANCEL_ALL_MANIFEST_ORDERS", { marketId }),
});

export const solanaManifestWithdrawTool = createTool({
  id: "solana_manifest_withdraw",
  description: "Withdraw all funds from a Manifest DEX market. Requires ARMED mode.",
  inputSchema: z.object({
    marketId: z.string().describe("Manifest market public key"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ marketId }) =>
    safeExecuteAction("WITHDRAW_ALL_MANIFEST_FUNDS", { marketId }),
});

// ============================================================================
// Export
// ============================================================================

export const solanaKitDefiPoolsTools = {
  solana_orca_fetch_positions: solanaOrcaFetchPositionsTool,
  solana_orca_open_centered: solanaOrcaOpenCenteredTool,
  solana_orca_open_single_sided: solanaOrcaOpenSingleSidedTool,
  solana_orca_close_position: solanaOrcaClosePositionTool,
  solana_orca_create_clmm: solanaOrcaCreateClmmTool,
  solana_orca_create_whirlpool: solanaOrcaCreateWhirlpoolTool,
  solana_raydium_create_clmm: solanaRaydiumCreateClmmTool,
  solana_raydium_create_cpmm: solanaRaydiumCreateCpmmTool,
  solana_meteora_create_dlmm: solanaMeteoraCreateDlmmTool,
  solana_manifest_limit_order: solanaManifestLimitOrderTool,
  solana_manifest_cancel_orders: solanaManifestCancelOrdersTool,
  solana_manifest_withdraw: solanaManifestWithdrawTool,
};
