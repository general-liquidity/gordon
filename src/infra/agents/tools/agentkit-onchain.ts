/**
 * AgentKit Onchain Tools
 * Mastra createTool() wrappers for CDP AgentKit onchain actions
 *
 * These tools bridge AgentKit's action system to Mastra's tool format.
 * Each tool calls the corresponding AgentKit action via executeAction().
 *
 * Tools:
 * - agentkit_get_wallet: Get Gordon's onchain wallet details
 * - agentkit_get_balance: Get native ETH balance on Base
 * - agentkit_native_transfer: Send ETH on Base
 * - agentkit_erc20_balance: Get ERC20 token balance
 * - agentkit_erc20_transfer: Transfer ERC20 tokens
 * - agentkit_wrap_eth: Wrap ETH to WETH (or unwrap)
 * - agentkit_request_faucet: Request testnet ETH from faucet
 * - agentkit_get_swap_price: Get DEX swap quote (read-only)
 * - agentkit_swap: Execute DEX swap on Base (0x aggregation)
 *
 * All tools gracefully handle the case where CDP keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isAgentKitConfigured } from "../../protocols/agentkit/index.ts";
import type { AgentKitActionResult } from "../../protocols/agentkit/index.ts";

// ============================================================================
// Helper
// ============================================================================

/**
 * Execute an AgentKit action with standardized error handling
 */
async function safeExecuteAction(
  actionName: string,
  args: Record<string, unknown> = {},
): Promise<AgentKitActionResult> {
  if (!isAgentKitConfigured()) {
    return {
      success: false,
      result: "",
      action: actionName,
      error: "CDP AgentKit not configured. Set CDP_API_KEY_ID, CDP_API_KEY_SECRET, and CDP_WALLET_SECRET.",
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
      error: `AgentKit action "${actionName}" failed: ${(error as Error).message}. ` +
        `Note: The transaction may have been submitted. Check your wallet for pending transactions.`,
    };
  }
}

// ============================================================================
// Output schema (shared by all tools)
// ============================================================================

const agentKitResultSchema = z.object({
  success: z.boolean(),
  result: z.string(),
  action: z.string(),
  error: z.string().optional(),
});

// ============================================================================
// Wallet Tools
// ============================================================================

/**
 * Get Gordon's onchain wallet details (address, network)
 */
export const agentKitGetWalletTool = createTool({
  id: "agentkit_get_wallet",
  description:
    "Get Gordon's onchain wallet details on Base L2 — address, network, and balance. " +
    "Use when user asks 'what's my Base wallet', 'my onchain address', or 'Gordon wallet'.",
  inputSchema: z.object({}),
  outputSchema: agentKitResultSchema,
  execute: async () => safeExecuteAction("get_wallet_details"),
});

/**
 * Get native ETH balance on Base
 */
export const agentKitGetBalanceTool = createTool({
  id: "agentkit_get_balance",
  description:
    "Get the native ETH balance of Gordon's onchain wallet on Base L2. " +
    "Use when user asks about their Base ETH balance or how much ETH they have onchain.",
  inputSchema: z.object({
    asset_id: z
      .string()
      .optional()
      .describe("Asset to check balance for. Defaults to native ETH if omitted."),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ asset_id }) =>
    safeExecuteAction("get_balance", asset_id ? { asset_id } : {}),
});

// ============================================================================
// Transfer Tools
// ============================================================================

/**
 * Send ETH on Base L2
 */
export const agentKitNativeTransferTool = createTool({
  id: "agentkit_native_transfer",
  description:
    "Transfer native ETH from Gordon's wallet to another address on Base L2. " +
    "Use when user asks to 'send ETH on Base', 'transfer to address', or 'pay onchain'. " +
    "IMPORTANT: Always confirm the amount and destination with the user before executing.",
  inputSchema: z.object({
    to: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address")
      .describe("Destination address (0x...)"),
    value: z
      .string()
      .describe("Amount of ETH to send (e.g., '0.01')"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ to, value }) =>
    safeExecuteAction("native_transfer", { to, value }),
});

// ============================================================================
// ERC20 Token Tools
// ============================================================================

/**
 * Get ERC20 token balance
 */
export const agentKitErc20BalanceTool = createTool({
  id: "agentkit_erc20_balance",
  description:
    "Get the balance of an ERC20 token in Gordon's onchain wallet on Base L2. " +
    "Use when user asks about a specific token balance like USDC, WETH, DAI on Base.",
  inputSchema: z.object({
    contract_address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid contract address")
      .describe("ERC20 token contract address on Base"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ contract_address }) =>
    safeExecuteAction("get_balance", { contract_address }),
});

/**
 * Transfer ERC20 tokens
 */
export const agentKitErc20TransferTool = createTool({
  id: "agentkit_erc20_transfer",
  description:
    "Transfer ERC20 tokens from Gordon's wallet to another address on Base L2. " +
    "Use when user asks to 'send USDC', 'transfer tokens on Base', etc. " +
    "IMPORTANT: Always confirm the amount, token, and destination with the user before executing.",
  inputSchema: z.object({
    contract_address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid contract address")
      .describe("ERC20 token contract address"),
    to: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address")
      .describe("Destination address (0x...)"),
    amount: z
      .string()
      .describe("Amount of tokens to transfer (human-readable, e.g., '10.5')"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ contract_address, to, amount }) =>
    safeExecuteAction("transfer", { contract_address, to, amount }),
});

// ============================================================================
// WETH Tools
// ============================================================================

/**
 * Wrap ETH to WETH
 */
export const agentKitWrapEthTool = createTool({
  id: "agentkit_wrap_eth",
  description:
    "Wrap ETH to WETH on Base L2. WETH is needed for many DeFi protocols and DEX trades. " +
    "Use when user asks to 'wrap ETH', 'get WETH', or needs WETH for a swap.",
  inputSchema: z.object({
    amount_to_wrap: z
      .string()
      .describe("Amount of ETH to wrap to WETH (e.g., '0.1')"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ amount_to_wrap }) =>
    safeExecuteAction("wrap_eth", { amount_to_wrap }),
});

// ============================================================================
// Faucet Tools
// ============================================================================

/**
 * Request testnet ETH from faucet
 */
export const agentKitRequestFaucetTool = createTool({
  id: "agentkit_request_faucet",
  description:
    "Request testnet ETH from the Base Sepolia faucet. Only works on testnet (base-sepolia). " +
    "Use when user asks for 'test ETH', 'faucet', or 'testnet funds'.",
  inputSchema: z.object({
    asset_id: z
      .string()
      .optional()
      .describe("Asset to request from faucet. Defaults to 'eth'."),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ asset_id }) =>
    safeExecuteAction("request_faucet_funds", asset_id ? { asset_id } : {}),
});

// ============================================================================
// DEX Swap Tools
// ============================================================================

/**
 * Get a DEX swap price quote (read-only, no execution)
 */
export const agentKitGetSwapPriceTool = createTool({
  id: "agentkit_get_swap_price",
  description:
    "Get a DEX swap price quote on Base L2 without executing. Shows expected output amount, " +
    "liquidity status, and price. Use BEFORE agentkit_swap to show the user what they'll receive. " +
    "Native ETH address: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE. " +
    "Common Base tokens: USDC=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913, " +
    "WETH=0x4200000000000000000000000000000000000006, " +
    "AERO=0x940181a94A35A4569E4529A3CDfB74e38FD98631.",
  inputSchema: z.object({
    fromToken: z.string().describe("Contract address of token to sell (use 0xEeee...eEEeE for native ETH)"),
    toToken: z.string().describe("Contract address of token to buy"),
    fromAmount: z.string().describe("Amount to sell in human-readable units (e.g., '0.1', '100')"),
    slippageBps: z.number().optional().describe("Max slippage in basis points (100 = 1%). Default: 100"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ fromToken, toToken, fromAmount, slippageBps }) =>
    safeExecuteAction("get_swap_price", {
      fromToken,
      toToken,
      fromAmount,
      ...(slippageBps !== undefined ? { slippageBps } : {}),
    }),
});

/**
 * Execute a DEX swap on Base L2 via 0x aggregation
 */
export const agentKitSwapTool = createTool({
  id: "agentkit_swap",
  description:
    "Execute a token swap on Base L2 via DEX aggregation (routes through Uniswap, Aerodrome, " +
    "SushiSwap, etc. for best price). Automatically handles Permit2 token approvals. " +
    "IMPORTANT: Always call agentkit_get_swap_price first to show the quote. " +
    "IMPORTANT: Requires permissionMode not 'strict'. Confirm amount and tokens with user before executing. " +
    "Native ETH address: 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE. " +
    "Only works on base-mainnet or ethereum-mainnet.",
  inputSchema: z.object({
    fromToken: z.string().describe("Contract address of token to sell (use 0xEeee...eEEeE for native ETH)"),
    toToken: z.string().describe("Contract address of token to buy"),
    fromAmount: z.string().describe("Amount to sell in human-readable units"),
    slippageBps: z.number().optional().describe("Max slippage in basis points (100 = 1%). Default: 100"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ fromToken, toToken, fromAmount, slippageBps }) => {
    const networkId = process.env.CDP_NETWORK_ID;
    if (networkId && !["base-mainnet", "ethereum-mainnet"].includes(networkId)) {
      return {
        success: false,
        result: "",
        action: "swap",
        error: `DEX swaps only supported on base-mainnet or ethereum-mainnet, current network: ${networkId}`,
      };
    }
    return safeExecuteAction("swap", {
      fromToken,
      toToken,
      fromAmount,
      ...(slippageBps !== undefined ? { slippageBps } : {}),
    });
  },
});

// ============================================================================
// Export as Mastra tool object
// ============================================================================

/**
 * AgentKit onchain tools exported as an object for Mastra Agent
 */
export const agentKitOnchainTools = {
  agentkit_get_wallet: agentKitGetWalletTool,
  agentkit_get_balance: agentKitGetBalanceTool,
  agentkit_native_transfer: agentKitNativeTransferTool,
  agentkit_erc20_balance: agentKitErc20BalanceTool,
  agentkit_erc20_transfer: agentKitErc20TransferTool,
  agentkit_wrap_eth: agentKitWrapEthTool,
  agentkit_request_faucet: agentKitRequestFaucetTool,
  agentkit_get_swap_price: agentKitGetSwapPriceTool,
  agentkit_swap: agentKitSwapTool,
};
