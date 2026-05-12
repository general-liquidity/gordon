/**
 * Solana Agent Kit — DeFi Perpetual Trading Tools
 * Mastra createTool() wrappers for Drift, Adrena, and Flash perpetuals
 *
 * Tools:
 * - solana_adrena_open_long: Open long position on Adrena
 * - solana_adrena_open_short: Open short position on Adrena
 * - solana_adrena_close_long: Close long position on Adrena
 * - solana_adrena_close_short: Close short position on Adrena
 * - solana_flash_open_trade: Open perp position on Flash.Trade
 * - solana_flash_close_trade: Close perp position on Flash.Trade
 * - solana_drift_open_perp: Open/close perp on Drift
 * - solana_drift_create_account: Create Drift user account
 * - solana_drift_deposit: Deposit to Drift account
 * - solana_drift_withdraw: Withdraw/borrow from Drift account
 * - solana_drift_has_account: Check if Drift account exists
 * - solana_drift_account_info: Get Drift account details
 * - solana_drift_markets: List available Drift markets
 * - solana_drift_funding_rate: Get Drift perp funding rate
 * - solana_drift_perp_quote: Get entry quote for Drift perp trade
 * - solana_drift_spot_swap: Swap tokens on Drift spot
 *
 * All tools gracefully handle the case where Solana keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isSolanaKitConfigured } from "../../../../protocols/solana/index.ts";
import type { SolanaKitActionResult } from "../../../../protocols/solana/index.ts";

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
// Adrena Protocol (Perpetual Trading)
// ============================================================================

export const solanaAdrenaOpenLongTool = createTool({
  id: "solana_adrena_open_long",
  description:
    "Open a leveraged long position on Adrena Protocol (Solana perpetuals). " +
    "Requires permissionMode not 'strict'. Confirm trade details with user.",
  inputSchema: z.object({
    price: z.number().describe("Entry price"),
    collateralAmount: z.number().describe("Collateral amount in USD"),
    leverage: z.number().describe("Leverage multiplier (e.g., 5 for 5x)"),
    tradeMint: z.string().describe("Token mint address to trade"),
    slippage: z.number().optional().describe("Slippage tolerance (default: 0.3)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ price, collateralAmount, leverage, tradeMint, slippage }) =>
    safeExecuteAction("OPEN_PERP_TRADE_LONG", {
      price, collateralAmount, leverage, tradeMint,
      ...(slippage !== undefined ? { slippage } : {}),
    }),
});

export const solanaAdrenaOpenShortTool = createTool({
  id: "solana_adrena_open_short",
  description:
    "Open a leveraged short position on Adrena Protocol (Solana perpetuals). " +
    "Requires permissionMode not 'strict'. Confirm trade details with user.",
  inputSchema: z.object({
    price: z.number().describe("Entry price"),
    collateralAmount: z.number().describe("Collateral amount in USD"),
    leverage: z.number().describe("Leverage multiplier (e.g., 5 for 5x)"),
    tradeMint: z.string().describe("Token mint address to trade"),
    slippage: z.number().optional().describe("Slippage tolerance (default: 0.3)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ price, collateralAmount, leverage, tradeMint, slippage }) =>
    safeExecuteAction("OPEN_PERP_TRADE_SHORT", {
      price, collateralAmount, leverage, tradeMint,
      ...(slippage !== undefined ? { slippage } : {}),
    }),
});

export const solanaAdrenaCloseLongTool = createTool({
  id: "solana_adrena_close_long",
  description:
    "Close a long position on Adrena Protocol. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    price: z.number().describe("Close price"),
    tradeMint: z.string().describe("Token mint address of the position"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ price, tradeMint }) =>
    safeExecuteAction("CLOSE_PERP_TRADE_LONG", { price, tradeMint }),
});

export const solanaAdrenaCloseShortTool = createTool({
  id: "solana_adrena_close_short",
  description:
    "Close a short position on Adrena Protocol. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    price: z.number().describe("Close price"),
    tradeMint: z.string().describe("Token mint address of the position"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ price, tradeMint }) =>
    safeExecuteAction("CLOSE_PERP_TRADE_SHORT", { price, tradeMint }),
});

// ============================================================================
// Flash.Trade Protocol
// ============================================================================

export const solanaFlashOpenTradeTool = createTool({
  id: "solana_flash_open_trade",
  description:
    "Open a leveraged perpetual position on Flash.Trade (Solana). " +
    "Supports long and short positions. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    token: z.string().describe("Token symbol to trade (e.g., 'SOL', 'BTC')"),
    side: z.enum(["long", "short"]).describe("Trade direction"),
    collateralUsd: z.number().describe("Collateral in USD"),
    leverage: z.number().describe("Leverage multiplier"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ token, side, collateralUsd, leverage }) =>
    safeExecuteAction("FLASH_OPEN_TRADE", { token, side, collateralUsd, leverage }),
});

export const solanaFlashCloseTradeTool = createTool({
  id: "solana_flash_close_trade",
  description:
    "Close a perpetual position on Flash.Trade. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    token: z.string().describe("Token symbol of the position"),
    side: z.enum(["long", "short"]).describe("Side of position to close"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ token, side }) =>
    safeExecuteAction("FLASH_CLOSE_TRADE", { token, side }),
});

// ============================================================================
// Drift Protocol (Perpetuals, Spot, Account Management)
// ============================================================================

export const solanaDriftOpenPerpTool = createTool({
  id: "solana_drift_open_perp",
  description:
    "Open or close a perpetual position on Drift Protocol. " +
    "Supports market and limit orders, long and short. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    amount: z.number().describe("Position size in base units"),
    symbol: z.string().describe("Market symbol (e.g., 'SOL', 'BTC', 'ETH')"),
    action: z.enum(["long", "short"]).describe("Trade direction"),
    type: z.enum(["market", "limit"]).describe("Order type"),
    price: z.number().optional().describe("Limit price (required for limit orders)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount, symbol, action, type, price }) =>
    safeExecuteAction("TRADE_DRIFT_PERP_ACCOUNT", {
      amount, symbol, action, type,
      ...(price !== undefined ? { price } : {}),
    }),
});

export const solanaDriftCreateAccountTool = createTool({
  id: "solana_drift_create_account",
  description:
    "Create a Drift Protocol user account with initial deposit. " +
    "Required before trading on Drift. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    amount: z.number().describe("Initial deposit amount"),
    symbol: z.string().describe("Token symbol to deposit (e.g., 'USDC')"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount, symbol }) =>
    safeExecuteAction("CREATE_DRIFT_USER_ACCOUNT", { amount, symbol }),
});

export const solanaDriftDepositTool = createTool({
  id: "solana_drift_deposit",
  description:
    "Deposit funds into Drift Protocol account. Can also repay borrows. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    amount: z.number().describe("Amount to deposit"),
    symbol: z.string().describe("Token symbol (e.g., 'USDC', 'SOL')"),
    isRepay: z.boolean().optional().describe("If true, repays borrowed amount"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount, symbol, isRepay }) =>
    safeExecuteAction("DEPOSIT_TO_DRIFT_USER_ACCOUNT", {
      amount, symbol,
      ...(isRepay !== undefined ? { isRepay } : {}),
    }),
});

export const solanaDriftWithdrawTool = createTool({
  id: "solana_drift_withdraw",
  description:
    "Withdraw funds or borrow from Drift Protocol account. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    amount: z.number().describe("Amount to withdraw or borrow"),
    symbol: z.string().describe("Token symbol (e.g., 'USDC', 'SOL')"),
    isBorrow: z.boolean().optional().describe("If true, borrows instead of withdrawing"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ amount, symbol, isBorrow }) =>
    safeExecuteAction("WITHDRAW_OR_BORROW_FROM_DRIFT_ACCOUNT", {
      amount, symbol,
      ...(isBorrow !== undefined ? { isBorrow } : {}),
    }),
});

export const solanaDriftHasAccountTool = createTool({
  id: "solana_drift_has_account",
  description: "Check if the wallet has an existing Drift Protocol account.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("DOES_USER_HAVE_DRIFT_ACCOUNT"),
});

export const solanaDriftAccountInfoTool = createTool({
  id: "solana_drift_account_info",
  description:
    "Get detailed information about the Drift Protocol user account " +
    "including balances, positions, and margin status.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("DRIFT_USER_ACCOUNT_INFO"),
});

export const solanaDriftMarketsTool = createTool({
  id: "solana_drift_markets",
  description: "List all available markets on Drift Protocol (spot and perpetual).",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("AVAILABLE_DRIFT_MARKETS"),
});

export const solanaDriftFundingRateTool = createTool({
  id: "solana_drift_funding_rate",
  description:
    "Get the current funding rate for a Drift perpetual market. " +
    "Useful for carry trade analysis and funding arbitrage.",
  inputSchema: z.object({
    marketSymbol: z.string().describe("Perpetual market symbol (e.g., 'SOL-PERP', 'BTC-PERP')"),
    period: z.enum(["year", "hour"]).optional().describe("Rate period — 'year' for annualized, 'hour' for hourly (default: year)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ marketSymbol, period }) =>
    safeExecuteAction("DRIFT_PERP_MARKET_FUNDING_RATE_ACTION", {
      marketSymbol,
      ...(period ? { period } : {}),
    }),
});

export const solanaDriftPerpQuoteTool = createTool({
  id: "solana_drift_perp_quote",
  description:
    "Get an entry price quote for a Drift perpetual trade. " +
    "Shows estimated fill price and slippage before executing.",
  inputSchema: z.object({
    marketSymbol: z.string().describe("Perpetual market symbol (e.g., 'SOL-PERP')"),
    amount: z.number().describe("Position size in base units"),
    type: z.enum(["long", "short"]).describe("Trade direction"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ marketSymbol, amount, type }) =>
    safeExecuteAction("DRIFT_GET_ENTRY_QUOTE_OF_PERP_TRADE_ACTION", { marketSymbol, amount, type }),
});

export const solanaDriftSpotSwapTool = createTool({
  id: "solana_drift_spot_swap",
  description:
    "Swap tokens on Drift Protocol's spot market. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    fromSymbol: z.string().describe("Token to sell (e.g., 'USDC')"),
    toSymbol: z.string().describe("Token to buy (e.g., 'SOL')"),
    fromAmount: z.number().optional().describe("Amount of fromSymbol to sell (use this OR toAmount)"),
    toAmount: z.number().optional().describe("Amount of toSymbol to buy (use this OR fromAmount)"),
    slippage: z.number().optional().describe("Slippage tolerance in basis points"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ fromSymbol, toSymbol, fromAmount, toAmount, slippage }) =>
    safeExecuteAction("DRIFT_SPOT_TOKEN_SWAP_ACTION", {
      fromSymbol, toSymbol,
      ...(fromAmount !== undefined ? { fromAmount } : {}),
      ...(toAmount !== undefined ? { toAmount } : {}),
      ...(slippage !== undefined ? { slippage } : {}),
    }),
});

// ============================================================================
// Export
// ============================================================================

export const solanaKitDefiPerpsTools = {
  solana_adrena_open_long: solanaAdrenaOpenLongTool,
  solana_adrena_open_short: solanaAdrenaOpenShortTool,
  solana_adrena_close_long: solanaAdrenaCloseLongTool,
  solana_adrena_close_short: solanaAdrenaCloseShortTool,
  solana_flash_open_trade: solanaFlashOpenTradeTool,
  solana_flash_close_trade: solanaFlashCloseTradeTool,
  solana_drift_open_perp: solanaDriftOpenPerpTool,
  solana_drift_create_account: solanaDriftCreateAccountTool,
  solana_drift_deposit: solanaDriftDepositTool,
  solana_drift_withdraw: solanaDriftWithdrawTool,
  solana_drift_has_account: solanaDriftHasAccountTool,
  solana_drift_account_info: solanaDriftAccountInfoTool,
  solana_drift_markets: solanaDriftMarketsTool,
  solana_drift_funding_rate: solanaDriftFundingRateTool,
  solana_drift_perp_quote: solanaDriftPerpQuoteTool,
  solana_drift_spot_swap: solanaDriftSpotSwapTool,
};
