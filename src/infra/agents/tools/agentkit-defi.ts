/**
 * AgentKit DeFi Tools
 * Mastra createTool() wrappers for CDP AgentKit DeFi action providers
 *
 * These tools bridge AgentKit's action system to Mastra's tool format.
 * Each tool calls the corresponding AgentKit action via executeAction().
 *
 * Providers:
 * - Pyth Network: Oracle price feeds (real-time, decentralized)
 * - DeFiLlama: DeFi protocol data and token prices
 * - Moonwell: Base-native lending protocol (deposit/withdraw)
 *
 * Tools:
 * - pyth_get_price_feed: Look up Pyth price feed ID by symbol
 * - pyth_fetch_price: Get real-time price from Pyth oracle
 * - defillama_search_protocols: Search DeFi protocols by name
 * - defillama_get_protocol: Get protocol TVL and details
 * - defillama_get_token_prices: Get token prices from DeFiLlama
 * - moonwell_deposit: Supply assets to Moonwell lending on Base
 * - moonwell_withdraw: Redeem assets from Moonwell lending on Base
 * - basenames_register: Register a .base domain name
 *
 * All tools gracefully handle the case where CDP keys are not configured.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { executeAction, isAgentKitConfigured } from "../../protocols/agentkit/index.ts";
import type { AgentKitActionResult } from "../../protocols/agentkit/index.ts";

// ============================================================================
// Moonwell MToken Addresses (Base Mainnet)
// ============================================================================

/** Moonwell MToken contract addresses on Base mainnet — used for deposit/withdraw */
const MOONWELL_MTOKENS: Record<string, string> = {
  USDC: "0xEdc817A28E8B93B03976FBd4a3dDBc9f7D176c22",
  WETH: "0x628ff693426583D9a7FB391E54366292F509D457",
  DAI: "0x73b06D8d18De422E269645eaCe15400DE7462417",
  cbETH: "0x3bf93770f2d4a794c3d9EBEfBAeBAE2a8f09A5E5",
  wstETH: "0x627Fe393Bc6EdDA28e99AE648fD6fF362514304b",
  AERO: "0x73902f619CEB9B31FD8EFecf435CbDf89E369Ba6",
  cbBTC: "0xF877ACaFA28c19b96727966690b2f44d35aD5976",
};

/** Format Moonwell MToken addresses for tool descriptions */
const MOONWELL_MTOKEN_LIST = Object.entries(MOONWELL_MTOKENS)
  .map(([symbol, addr]) => `${symbol}=${addr}`)
  .join(", ");

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
      error: `AgentKit action "${actionName}" failed: ${(error as Error).message}`,
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
// Pyth Network Tools (Oracle Price Feeds)
// ============================================================================

/**
 * Look up a Pyth price feed ID by token symbol
 */
export const pythGetPriceFeedTool = createTool({
  id: "pyth_get_price_feed",
  description:
    "Look up a Pyth Network oracle price feed ID by token symbol. Returns the feed ID " +
    "needed to fetch real-time decentralized prices. Use this first, then pyth_fetch_price " +
    "with the returned feed ID. Supports crypto (BTC, ETH, SOL), forex, equities, and commodities.",
  inputSchema: z.object({
    tokenSymbol: z
      .string()
      .describe("Token symbol to look up (e.g., 'BTC', 'ETH', 'SOL', 'AERO')"),
    quoteCurrency: z
      .string()
      .optional()
      .describe("Quote currency (default: 'USD'). E.g., 'USD', 'EUR'."),
    assetType: z
      .string()
      .optional()
      .describe("Asset type filter: 'crypto', 'fx', 'equity', 'metal'. Default: 'crypto'."),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ tokenSymbol, quoteCurrency, assetType }) =>
    safeExecuteAction("fetch_price_feed", {
      tokenSymbol,
      ...(quoteCurrency !== undefined ? { quoteCurrency } : {}),
      ...(assetType !== undefined ? { assetType } : {}),
    }),
});

/**
 * Get real-time price from Pyth oracle by feed ID
 */
export const pythFetchPriceTool = createTool({
  id: "pyth_fetch_price",
  description:
    "Fetch the real-time price from a Pyth Network oracle feed. Requires a feed ID " +
    "(get one via pyth_get_price_feed). Returns the latest price with confidence interval " +
    "and timestamp. Pyth prices are decentralized and update every 400ms.",
  inputSchema: z.object({
    priceFeedID: z
      .string()
      .describe("Pyth price feed ID (hex string from pyth_get_price_feed)"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ priceFeedID }) =>
    safeExecuteAction("fetch_price", { priceFeedID }),
});

// ============================================================================
// DeFiLlama Tools (DeFi Protocol Data)
// ============================================================================

/**
 * Search DeFi protocols by name
 */
export const defillamaSearchProtocolsTool = createTool({
  id: "defillama_search_protocols",
  description:
    "Search DeFi protocols by name on DeFiLlama. Returns matching protocols with TVL, " +
    "chain info, and category. Use to discover DeFi projects or find protocol IDs " +
    "for deeper analysis with defillama_get_protocol.",
  inputSchema: z.object({
    query: z
      .string()
      .describe("Search query (protocol name, e.g., 'Aave', 'Uniswap', 'Moonwell', 'Aerodrome')"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ query }) =>
    safeExecuteAction("find_protocol", { query }),
});

/**
 * Get protocol TVL and details
 */
export const defillamaGetProtocolTool = createTool({
  id: "defillama_get_protocol",
  description:
    "Get detailed info about a DeFi protocol from DeFiLlama — TVL, TVL history, " +
    "chain breakdown, token info, and category. Use after defillama_search_protocols " +
    "to get the protocol ID (slug).",
  inputSchema: z.object({
    protocolId: z
      .string()
      .describe("Protocol slug/ID from DeFiLlama (e.g., 'aave', 'uniswap', 'moonwell-apollo')"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ protocolId }) =>
    safeExecuteAction("get_protocol", { protocolId }),
});

/**
 * Get token prices from DeFiLlama
 */
export const defillamaGetTokenPricesTool = createTool({
  id: "defillama_get_token_prices",
  description:
    "Get current token prices from DeFiLlama's price API. Accepts tokens in the format " +
    "'chain:address' (e.g., 'base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' for USDC on Base). " +
    "Common Base tokens: USDC=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913, " +
    "WETH=0x4200000000000000000000000000000000000006, " +
    "AERO=0x940181a94A35A4569E4529A3CDfB74e38FD98631.",
  inputSchema: z.object({
    tokens: z
      .array(z.string())
      .describe("Token identifiers in 'chain:address' format (e.g., ['base:0x833589...'])"),
    searchWidth: z
      .string()
      .optional()
      .describe("Time window for price lookup (e.g., '4h'). Default: latest."),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ tokens, searchWidth }) =>
    safeExecuteAction("get_token_prices", {
      tokens,
      ...(searchWidth !== undefined ? { searchWidth } : {}),
    }),
});

// ============================================================================
// Moonwell Tools (Base-Native Lending)
// ============================================================================

/**
 * Supply assets to Moonwell lending on Base
 */
export const moonwellDepositTool = createTool({
  id: "moonwell_deposit",
  description:
    "Deposit (supply) assets to Moonwell lending protocol on Base L2 to earn yield. " +
    "IMPORTANT: Requires ARMED mode. Confirm amount and token with user before executing. " +
    `Moonwell MToken addresses on Base mainnet: ${MOONWELL_MTOKEN_LIST}.`,
  inputSchema: z.object({
    mTokenAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid MToken contract address")
      .describe("Moonwell MToken contract address (e.g., 0xEdc817... for USDC)"),
    tokenAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid token contract address")
      .describe("Underlying token contract address (e.g., USDC=0x833589fcd6edb6e08f4c7c32d4f71b54bda02913)"),
    assets: z
      .string()
      .describe("Amount to deposit in human-readable units (e.g., '100' for 100 USDC)"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ mTokenAddress, tokenAddress, assets }) =>
    safeExecuteAction("mint", { mTokenAddress, tokenAddress, assets }),
});

/**
 * Redeem assets from Moonwell lending on Base
 */
export const moonwellWithdrawTool = createTool({
  id: "moonwell_withdraw",
  description:
    "Withdraw (redeem) assets from Moonwell lending protocol on Base L2. " +
    "IMPORTANT: Requires ARMED mode. Confirm amount with user before executing. " +
    `Moonwell MToken addresses on Base mainnet: ${MOONWELL_MTOKEN_LIST}.`,
  inputSchema: z.object({
    mTokenAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid MToken contract address")
      .describe("Moonwell MToken contract address (e.g., 0xEdc817... for USDC)"),
    assets: z
      .string()
      .describe("Amount to withdraw in human-readable units (e.g., '50' for 50 USDC)"),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ mTokenAddress, assets }) =>
    safeExecuteAction("redeem", { mTokenAddress, assets }),
});

// ============================================================================
// Basenames Tools (Base Domain Registration)
// ============================================================================

/**
 * Register a .base domain name (Basename)
 */
export const basenamesRegisterTool = createTool({
  id: "basenames_register",
  description:
    "Register a Basename (.base domain) on Base L2. Basenames are ENS-compatible " +
    "human-readable names (e.g., 'gordon.base') that resolve to your wallet address. " +
    "IMPORTANT: Requires ARMED mode. Registration costs ETH (default 0.002 ETH). " +
    "Confirm the name and cost with the user before executing.",
  inputSchema: z.object({
    basename: z
      .string()
      .describe("The Basename to register (e.g., 'gordon.base' or 'myname.base')"),
    amount: z
      .string()
      .optional()
      .describe("Registration payment in ETH (default: '0.002'). Higher amounts may be needed for premium names."),
  }),
  outputSchema: agentKitResultSchema,
  execute: async ({ basename, amount }) =>
    safeExecuteAction("register", {
      basename,
      ...(amount !== undefined ? { amount } : {}),
    }),
});

// ============================================================================
// Export as Mastra tool object
// ============================================================================

/**
 * AgentKit DeFi tools exported as an object for Mastra Agent
 */
export const agentKitDefiTools = {
  pyth_get_price_feed: pythGetPriceFeedTool,
  pyth_fetch_price: pythFetchPriceTool,
  defillama_search_protocols: defillamaSearchProtocolsTool,
  defillama_get_protocol: defillamaGetProtocolTool,
  defillama_get_token_prices: defillamaGetTokenPricesTool,
  moonwell_deposit: moonwellDepositTool,
  moonwell_withdraw: moonwellWithdrawTool,
  basenames_register: basenamesRegisterTool,
};
