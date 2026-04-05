/**
 * Solana Agent Kit — DeFi Cross-Chain Bridge & DEX Aggregation Tools
 * Mastra createTool() wrappers for deBridge and OKX DEX
 *
 * Tools:
 * - solana_debridge_create_order: Create a deBridge cross-chain order
 * - solana_debridge_execute: Execute a deBridge bridge order
 * - solana_debridge_status: Check deBridge transaction status
 * - solana_debridge_chains: Get supported deBridge chains
 * - solana_debridge_tokens: Get token info on a chain
 * - solana_okx_swap: Execute a swap via OKX DEX aggregator
 * - solana_okx_quote: Get a swap quote from OKX DEX
 * - solana_okx_tokens: Get available tokens on OKX DEX
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
// deBridge Cross-Chain
// ============================================================================

export const solanaDebridgeCreateOrderTool = createTool({
  id: "solana_debridge_create_order",
  description:
    "Create a cross-chain bridge order via deBridge. " +
    "Bridges tokens between Solana and EVM chains (Ethereum, Arbitrum, etc.). " +
    "IMPORTANT: Confirm bridge details with user. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    srcChainId: z.string().describe("Source chain ID (e.g., '7565164' for Solana)"),
    srcChainTokenIn: z.string().describe("Source token address"),
    srcChainTokenInAmount: z.string().describe("Amount to bridge (as string, in base units)"),
    dstChainId: z.string().describe("Destination chain ID"),
    dstChainTokenOut: z.string().describe("Destination token address"),
    dstChainTokenOutRecipient: z.string().describe("Recipient address on destination chain"),
    account: z.string().describe("Sender account address"),
    slippage: z.number().optional().describe("Slippage tolerance"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ srcChainId, srcChainTokenIn, srcChainTokenInAmount, dstChainId, dstChainTokenOut, dstChainTokenOutRecipient, account, slippage }) =>
    safeExecuteAction("DEBRIDGE_CREATE_BRIDGE_ORDER", {
      srcChainId, srcChainTokenIn, srcChainTokenInAmount,
      dstChainId, dstChainTokenOut, dstChainTokenOutRecipient, account,
      ...(slippage !== undefined ? { slippage } : {}),
    }),
});

export const solanaDebridgeExecuteTool = createTool({
  id: "solana_debridge_execute",
  description: "Execute a previously created deBridge bridge order. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    transactionData: z.string().describe("Transaction data from create order response"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ transactionData }) =>
    safeExecuteAction("DEBRIDGE_EXECUTE_BRIDGE_ORDER", { transactionData }),
});

export const solanaDebridgeStatusTool = createTool({
  id: "solana_debridge_status",
  description: "Check the status of a deBridge cross-chain transaction.",
  inputSchema: z.object({
    txHash: z.string().describe("Transaction hash to check"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ txHash }) =>
    safeExecuteAction("DEBRIDGE_CHECK_TRANSACTION_STATUS", { txHash }),
});

export const solanaDebridgeChainsTool = createTool({
  id: "solana_debridge_chains",
  description: "Get all supported chains on deBridge for cross-chain bridging.",
  inputSchema: z.object({}),
  outputSchema: solanaResultSchema,
  execute: async () => safeExecuteAction("DEBRIDGE_GET_SUPPORTED_CHAINS"),
});

export const solanaDebridgeTokensTool = createTool({
  id: "solana_debridge_tokens",
  description: "Get token information available on a specific chain via deBridge.",
  inputSchema: z.object({
    chainId: z.string().describe("Chain ID to query"),
    tokenAddress: z.string().optional().describe("Specific token address to look up"),
    search: z.string().optional().describe("Search by token name or symbol"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ chainId, tokenAddress, search }) =>
    safeExecuteAction("DEBRIDGE_GET_TOKENS_INFO", {
      chainId,
      ...(tokenAddress ? { tokenAddress } : {}),
      ...(search ? { search } : {}),
    }),
});

// ============================================================================
// OKX DEX Aggregator
// ============================================================================

export const solanaOkxSwapTool = createTool({
  id: "solana_okx_swap",
  description:
    "Execute a token swap via OKX DEX aggregator. " +
    "Routes through multiple DEXes for best price. Requires permissionMode not 'strict'.",
  inputSchema: z.object({
    chainId: z.string().describe("Chain ID (e.g., '501' for Solana)"),
    fromTokenAddress: z.string().describe("Source token address"),
    toTokenAddress: z.string().describe("Destination token address"),
    userWalletAddress: z.string().describe("User's wallet address"),
    amount: z.string().describe("Swap amount (as string, in base units)"),
    slippage: z.string().describe("Slippage tolerance (e.g., '0.5' for 0.5%)"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ chainId, fromTokenAddress, toTokenAddress, userWalletAddress, amount, slippage }) =>
    safeExecuteAction("OKX_EXECUTE_SWAP", {
      chainId, fromTokenAddress, toTokenAddress, userWalletAddress, amount, slippage,
    }),
});

export const solanaOkxQuoteTool = createTool({
  id: "solana_okx_quote",
  description: "Get a swap quote from OKX DEX aggregator before executing.",
  inputSchema: z.object({
    chainId: z.string().describe("Chain ID"),
    fromTokenAddress: z.string().describe("Source token address"),
    toTokenAddress: z.string().describe("Destination token address"),
    amount: z.string().describe("Amount (as string, in base units)"),
    slippage: z.string().describe("Slippage tolerance"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ chainId, fromTokenAddress, toTokenAddress, amount, slippage }) =>
    safeExecuteAction("OKX_GET_QUOTE", { chainId, fromTokenAddress, toTokenAddress, amount, slippage }),
});

export const solanaOkxTokensTool = createTool({
  id: "solana_okx_tokens",
  description: "Get available tokens on OKX DEX for a specific chain.",
  inputSchema: z.object({
    chainId: z.string().describe("Chain ID to query"),
  }),
  outputSchema: solanaResultSchema,
  execute: async ({ chainId }) =>
    safeExecuteAction("OKX_GET_TOKEN", { chainId }),
});

// ============================================================================
// Export
// ============================================================================

export const solanaKitDefiBridgeTools = {
  solana_debridge_create_order: solanaDebridgeCreateOrderTool,
  solana_debridge_execute: solanaDebridgeExecuteTool,
  solana_debridge_status: solanaDebridgeStatusTool,
  solana_debridge_chains: solanaDebridgeChainsTool,
  solana_debridge_tokens: solanaDebridgeTokensTool,
  solana_okx_swap: solanaOkxSwapTool,
  solana_okx_quote: solanaOkxQuoteTool,
  solana_okx_tokens: solanaOkxTokensTool,
};
