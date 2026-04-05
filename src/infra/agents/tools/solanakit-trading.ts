/**
 * Solana Agent Kit — Trading & Transfer Tools
 * Mastra createTool() wrappers for Jupiter swaps, transfers, limit orders, and staking
 *
 * Tools:
 * - solana_trade: Swap tokens via Jupiter DEX aggregation
 * - solana_transfer: Transfer SOL or SPL tokens
 * - solana_create_limit_order: Place a Jupiter limit order
 * - solana_cancel_limit_orders: Cancel Jupiter limit orders
 * - solana_get_open_limit_orders: View open limit orders
 * - solana_get_limit_order_history: View limit order history
 * - solana_stake_jup: Liquid stake SOL for jupSOL
 * - solana_request_faucet: Request devnet/testnet SOL
 * - solana_launch_pumpfun: Launch a token on PumpFun
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
// Jupiter Swap
// ============================================================================

export const solanaTradeTool = createTool({
  id: "solana_trade",
  description:
    "Swap tokens on Solana via Jupiter DEX aggregation (routes through Raydium, Orca, etc. for best price). " +
    "Native SOL mint: So11111111111111111111111111111111111111112. " +
    "USDC mint: EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v. " +
    "IMPORTANT: Always confirm the swap details with the user. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    outputMint: z
      .string()
      .describe("Mint address of the token to buy"),
    inputAmount: z
      .number()
      .describe("Amount of input token to sell (in human-readable units)"),
    inputMint: z
      .string()
      .optional()
      .describe("Mint address of the token to sell. Defaults to native SOL if omitted."),
    slippageBps: z
      .number()
      .optional()
      .describe("Max slippage in basis points (100 = 1%). Default: 300"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ outputMint, inputAmount, inputMint, slippageBps }) =>
    safeExecuteAction("TRADE", {
      outputMint,
      inputAmount,
      ...(inputMint ? { inputMint } : {}),
      ...(slippageBps !== undefined ? { slippageBps } : {}),
    }),
});

// ============================================================================
// Transfers
// ============================================================================

export const solanaTransferTool = createTool({
  id: "solana_transfer",
  description:
    "Transfer SOL or SPL tokens to another Solana address. " +
    "If no mint is provided, transfers native SOL. " +
    "IMPORTANT: Always confirm the amount and destination with the user. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    to: z
      .string()
      .describe("Destination Solana address (base58)"),
    amount: z
      .number()
      .describe("Amount to transfer (in human-readable units, e.g., 1.5 for 1.5 SOL)"),
    mint: z
      .string()
      .optional()
      .describe("SPL token mint address. Omit for native SOL transfer."),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ to, amount, mint }) =>
    safeExecuteAction("TRANSFER", { to, amount, ...(mint ? { mint } : {}) }),
});

// ============================================================================
// Jupiter Limit Orders
// ============================================================================

export const solanaCreateLimitOrderTool = createTool({
  id: "solana_create_limit_order",
  description:
    "Create a limit order on Jupiter. Specify input/output mints and amounts. " +
    "The order stays open until filled or cancelled. " +
    "IMPORTANT: Confirm order details with the user. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    inputMint: z
      .string()
      .describe("Mint address of the token to sell"),
    outputMint: z
      .string()
      .describe("Mint address of the token to buy"),
    makingAmount: z
      .string()
      .describe("Amount of input token to sell (as string, in base units)"),
    takingAmount: z
      .string()
      .describe("Amount of output token expected (as string, in base units)"),
    expiredAt: z
      .string()
      .optional()
      .describe("Expiration timestamp (ISO string). Optional — no expiry if omitted."),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ inputMint, outputMint, makingAmount, takingAmount, expiredAt }) =>
    safeExecuteAction("CREATE_LIMIT_ORDER", {
      inputMint,
      outputMint,
      params: {
        makingAmount,
        takingAmount,
        ...(expiredAt ? { expiredAt } : {}),
      },
    }),
});

export const solanaCancelLimitOrdersTool = createTool({
  id: "solana_cancel_limit_orders",
  description:
    "Cancel one or more Jupiter limit orders by their public keys. " +
    "Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    orders: z
      .array(z.string())
      .describe("Array of order public keys to cancel"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ orders }) =>
    safeExecuteAction("CANCEL_LIMIT_ORDERS", { orders }),
});

export const solanaGetOpenLimitOrdersTool = createTool({
  id: "solana_get_open_limit_orders",
  description:
    "Get all open Jupiter limit orders for Gordon's wallet. " +
    "Use when user asks about pending or open orders on Solana.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("GET_OPEN_LIMIT_ORDERS"),
});

export const solanaGetLimitOrderHistoryTool = createTool({
  id: "solana_get_limit_order_history",
  description:
    "Get the Jupiter limit order history for Gordon's wallet. " +
    "Shows filled, cancelled, and expired orders.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("GET_LIMIT_ORDER_HISTORY"),
});

// ============================================================================
// Staking
// ============================================================================

export const solanaStakeJupTool = createTool({
  id: "solana_stake_jup",
  description:
    "Liquid stake SOL for jupSOL via Jupiter's staking protocol. " +
    "jupSOL earns staking rewards while remaining liquid and usable in DeFi. " +
    "IMPORTANT: Confirm amount with the user. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    amount: z
      .number()
      .describe("Amount of SOL to stake (e.g., 1.0 for 1 SOL)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount }) =>
    safeExecuteAction("STAKE_WITH_JUPITER", { amount }),
});

// ============================================================================
// Faucet
// ============================================================================

export const solanaRequestFaucetTool = createTool({
  id: "solana_request_faucet",
  description:
    "Request SOL from the Solana faucet. Only works on devnet/testnet. " +
    "Use when user needs test SOL for development.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("REQUEST_FUNDS"),
});

// ============================================================================
// PumpFun
// ============================================================================

export const solanaLaunchPumpfunTool = createTool({
  id: "solana_launch_pumpfun",
  description:
    "Launch a new token on Pump.fun with customizable metadata and initial liquidity. " +
    "Creates a new SPL token with bonding curve mechanics. " +
    "IMPORTANT: This creates a real token with real SOL. Confirm all details. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    tokenName: z
      .string()
      .describe("Token name (max 32 chars)"),
    tokenTicker: z
      .string()
      .describe("Token ticker/symbol (2-10 chars)"),
    description: z
      .string()
      .describe("Token description (max 1000 chars)"),
    imageUrl: z
      .string()
      .describe("URL to token image"),
    initialLiquiditySOL: z
      .number()
      .optional()
      .describe("Initial liquidity in SOL (default: 0.0001)"),
    twitter: z
      .string()
      .optional()
      .describe("Twitter/X URL"),
    telegram: z
      .string()
      .optional()
      .describe("Telegram URL"),
    website: z
      .string()
      .optional()
      .describe("Website URL"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ tokenName, tokenTicker, description, imageUrl, initialLiquiditySOL, twitter, telegram, website }) =>
    safeExecuteAction("LAUNCH_PUMPFUN_TOKEN", {
      tokenName,
      tokenTicker,
      description,
      imageUrl,
      ...(initialLiquiditySOL !== undefined ? { initialLiquiditySOL } : {}),
      ...(twitter ? { twitter } : {}),
      ...(telegram ? { telegram } : {}),
      ...(website ? { website } : {}),
    }),
});

// ============================================================================
// Export
// ============================================================================

export const solanaKitTradingTools = {
  solana_trade: solanaTradeTool,
  solana_transfer: solanaTransferTool,
  solana_create_limit_order: solanaCreateLimitOrderTool,
  solana_cancel_limit_orders: solanaCancelLimitOrdersTool,
  solana_get_open_limit_orders: solanaGetOpenLimitOrdersTool,
  solana_get_limit_order_history: solanaGetLimitOrderHistoryTool,
  solana_stake_jup: solanaStakeJupTool,
  solana_request_faucet: solanaRequestFaucetTool,
  solana_launch_pumpfun: solanaLaunchPumpfunTool,
};
