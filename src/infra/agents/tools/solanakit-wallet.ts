/**
 * Solana Agent Kit — Wallet & Data Tools
 * Mastra createTool() wrappers for wallet, balance, price, and data actions
 *
 * Tools:
 * - solana_wallet_address: Get wallet address
 * - solana_balance: Get SOL or token balance
 * - solana_token_balances: Get all token balances
 * - solana_fetch_price: Get token price via Jupiter
 * - solana_pyth_price: Get token price via Pyth oracle
 * - solana_get_token_data: Get token metadata
 * - solana_rugcheck: Check if a token is a rug pull
 * - solana_get_tps: Get Solana network TPS
 *
 * All tools gracefully handle the case where Solana keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isSolanaKitConfigured } from "../../solanakit/index.ts";
import type { SolanaKitActionResult } from "../../solanakit/index.ts";

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
// Wallet Tools
// ============================================================================

export const solanaWalletAddressTool = createTool({
  id: "solana_wallet_address",
  description:
    "Get Gordon's Solana wallet address. " +
    "Use when user asks 'what's my Solana address' or 'my SOL wallet'.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("WALLET_ADDRESS"),
});

export const solanaBalanceTool = createTool({
  id: "solana_balance",
  description:
    "Get the SOL balance or a specific SPL token balance of Gordon's Solana wallet. " +
    "If no tokenAddress is provided, returns SOL balance. " +
    "Use when user asks about their SOL balance or a specific Solana token balance.",
  inputSchema: z.object({
    tokenAddress: z
      .string()
      .optional()
      .describe("SPL token mint address. Omit for native SOL balance."),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ tokenAddress }) =>
    safeExecuteAction("BALANCE_ACTION", tokenAddress ? { tokenAddress } : {}),
});

export const solanaTokenBalancesTool = createTool({
  id: "solana_token_balances",
  description:
    "Get all SPL token balances in Gordon's Solana wallet. " +
    "Shows every token held with amounts. " +
    "Use when user asks 'what tokens do I have on Solana' or 'show my Solana portfolio'.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("TOKEN_BALANCE_ACTION"),
});

// ============================================================================
// Price & Data Tools
// ============================================================================

export const solanaFetchPriceTool = createTool({
  id: "solana_fetch_price",
  description:
    "Fetch the current price of a Solana token in USDC using Jupiter API. " +
    "Requires the token's mint address. " +
    "Use when user asks about a Solana token price.",
  inputSchema: z.object({
    tokenAddress: z
      .string()
      .describe("The mint address of the token to fetch the price for"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ tokenAddress }) =>
    safeExecuteAction("FETCH_PRICE", { tokenAddress }),
});

export const solanaPythPriceTool = createTool({
  id: "solana_pyth_price",
  description:
    "Fetch the current price from a Pyth oracle price feed on Solana. " +
    "Uses token symbol (e.g., 'SOL', 'BTC', 'ETH') instead of address. " +
    "Pyth provides decentralized, high-frequency price data.",
  inputSchema: z.object({
    tokenSymbol: z
      .string()
      .describe("Token symbol to fetch price for (e.g., 'SOL', 'BTC', 'ETH', 'BONK')"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ tokenSymbol }) =>
    safeExecuteAction("PYTH_FETCH_PRICE", { tokenSymbol }),
});

export const solanaGetTokenDataTool = createTool({
  id: "solana_get_token_data",
  description:
    "Get token metadata and data from a Solana token address or ticker symbol. " +
    "Returns token name, symbol, decimals, supply, and market data.",
  inputSchema: z.object({
    address: z
      .string()
      .optional()
      .describe("Token mint address"),
    ticker: z
      .string()
      .optional()
      .describe("Token ticker symbol (e.g., 'SOL', 'BONK')"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ address, ticker }) =>
    safeExecuteAction("GET_TOKEN_DATA", { ...(address ? { address } : {}), ...(ticker ? { ticker } : {}) }),
});

export const solanaRugcheckTool = createTool({
  id: "solana_rugcheck",
  description:
    "Check if a Solana token is potentially a rug pull. " +
    "Analyzes token contract, liquidity, and holder distribution for red flags. " +
    "Use when user asks 'is this token safe?' or 'rugcheck' a token.",
  inputSchema: z.object({
    mint: z
      .string()
      .describe("Token mint address to analyze"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ mint }) =>
    safeExecuteAction("RUGCHECK", { mint }),
});

export const solanaGetTpsTool = createTool({
  id: "solana_get_tps",
  description:
    "Get the current transactions per second (TPS) of the Solana network. " +
    "Use when user asks about Solana network performance or congestion.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("GET_TPS"),
});

// ============================================================================
// Export
// ============================================================================

export const solanaKitWalletTools = {
  solana_wallet_address: solanaWalletAddressTool,
  solana_balance: solanaBalanceTool,
  solana_token_balances: solanaTokenBalancesTool,
  solana_fetch_price: solanaFetchPriceTool,
  solana_pyth_price: solanaPythPriceTool,
  solana_get_token_data: solanaGetTokenDataTool,
  solana_rugcheck: solanaRugcheckTool,
  solana_get_tps: solanaGetTpsTool,
};
