/**
 * Base Onchain Tools
 * Tools for Base L2 chain data — onchain registry, gas prices, token data
 *
 * These tools are additive to Gordon's existing exchange-based tools.
 * They provide onchain intelligence from Base L2 alongside CEX data.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  getRegistryEntries,
  getRegistryFeatured,
  formatRegistryEntry,
  getBaseGasPrice,
  getLatestBlock,
  getBaseBalance,
  getBaseTokenBalance,
  searchBasePairs,
  BASE_TOKENS,
  BASE_CHAIN_CONFIG,
  type RegistryCategory,
  type RegistryCuration,
} from "../../../../protocols/base/index.ts";

/**
 * Fetch a live ETH/USD price from DexScreener (WETH/USDC pair on Base).
 * Falls back to a static estimate if the API call fails.
 */
async function getLiveEthPrice(): Promise<number> {
  try {
    const pairs = await searchBasePairs("WETH/USDC");
    const price = pairs[0]?.priceUsd;
    if (price) return parseFloat(price);
  } catch {
    // DexScreener unavailable — fall through to fallback
  }
  console.warn("[base-onchain] DexScreener unavailable, using fallback ETH price of $2500");
  return 2500; // static fallback
}

// ============================================================================
// Base Onchain Registry Tools
// ============================================================================

/**
 * Get trending/curated entries from the Base Onchain Registry
 */
export const getBaseTrendingTool = createTool({
  id: "get_base_trending",
  description:
    "Get trending and curated onchain apps, mints, and experiences on Base L2. " +
    "Use when user asks 'what's hot on Base', 'Base trending', 'what to mint on Base', " +
    "'Base ecosystem', or wants to discover onchain opportunities beyond CEX trading.",
  inputSchema: z.object({
    category: z
      .enum(["Games", "Social", "Creators", "Finance", "Media"])
      .optional()
      .describe("Filter by category. Omit for all categories."),
    curation: z
      .enum(["Featured", "Curated", "Community"])
      .optional()
      .describe("Filter by curation level. Featured = top placement, Curated = reviewed, Community = all."),
    limit: z
      .number()
      .min(1)
      .max(50)
      .default(10)
      .describe("Max results to return (default 10)"),
    page: z
      .number()
      .min(1)
      .default(1)
      .describe("Page number for pagination"),
  }),
  outputSchema: z.object({
    entries: z.array(z.object({
      title: z.string(),
      description: z.string(),
      category: z.string(),
      curation: z.string(),
      creator: z.string(),
      action: z.string(),
      cost: z.string(),
      contract: z.string(),
      url: z.string(),
      featured: z.boolean(),
      active: z.boolean(),
    })).optional(),
    totalRecords: z.number().optional(),
    currentPage: z.number().optional(),
    totalPages: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ category, curation, limit, page }) => {
    try {
      const response = await getRegistryEntries({
        category: category ? [category as RegistryCategory] : undefined,
        curation: curation as RegistryCuration | undefined,
        limit,
        page,
      });

      const entries = response.data.map(formatRegistryEntry);

      return {
        entries,
        totalRecords: response.pagination.total_records,
        currentPage: response.pagination.current_page,
        totalPages: response.pagination.total_pages,
      };
    } catch (error) {
      return { error: `Failed to fetch Base registry: ${(error as Error).message}` };
    }
  },
});

/**
 * Get the currently featured entry on Base
 */
export const getBaseFeaturedTool = createTool({
  id: "get_base_featured",
  description:
    "Get the currently featured onchain app/mint on Base L2. " +
    "Use when user asks 'what's featured on Base', 'Base spotlight', or 'top Base pick today'.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    category: z.string().optional(),
    creator: z.string().optional(),
    action: z.string().optional(),
    cost: z.string().optional(),
    contract: z.string().optional(),
    url: z.string().optional(),
    active: z.boolean().optional(),
    error: z.string().optional(),
  }),
  execute: async () => {
    try {
      const response = await getRegistryFeatured();
      const formatted = formatRegistryEntry(response.data);
      return formatted;
    } catch (error) {
      return { error: `Failed to fetch Base featured: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Base Chain Data Tools
// ============================================================================

/**
 * Get Base L2 gas price and network status
 */
export const getBaseGasTool = createTool({
  id: "get_base_gas",
  description:
    "Get current Base L2 gas price and estimated transaction costs. " +
    "Use when user asks about Base gas fees, transaction costs on Base, or network status.",
  inputSchema: z.object({
    network: z
      .enum(["mainnet", "testnet"])
      .default("mainnet")
      .describe("Base network (mainnet or testnet)"),
  }),
  outputSchema: z.object({
    gasPriceGwei: z.number().optional(),
    estimatedTransferCostETH: z.number().optional(),
    estimatedTransferCostUSD: z.string().optional(),
    latestBlock: z.number().optional(),
    blockTimestamp: z.number().optional(),
    txCountInBlock: z.number().optional(),
    baseFeeGwei: z.number().optional(),
    network: z.string().optional(),
    chainId: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ network }) => {
    try {
      const [gasPrice, block, ethPrice] = await Promise.all([
        getBaseGasPrice(network),
        getLatestBlock(network),
        getLiveEthPrice(),
      ]);

      return {
        gasPriceGwei: Math.round(gasPrice.gasPrice * 1000) / 1000,
        estimatedTransferCostETH: gasPrice.estimatedTransferCostETH,
        estimatedTransferCostUSD: `~$${(gasPrice.estimatedTransferCostETH * ethPrice).toFixed(4)}`,
        latestBlock: block.number,
        blockTimestamp: block.timestamp,
        txCountInBlock: block.transactionCount,
        baseFeeGwei: Math.round(block.baseFeePerGas * 1000) / 1000,
        network: BASE_CHAIN_CONFIG[network].name,
        chainId: BASE_CHAIN_CONFIG[network].chainId,
      };
    } catch (error) {
      return { error: `Failed to fetch Base gas data: ${(error as Error).message}` };
    }
  },
});

/**
 * Get Base L2 wallet balance (ETH + major tokens)
 */
export const getBaseBalanceTool = createTool({
  id: "get_base_balance",
  description:
    "Get ETH and token balances for a wallet address on Base L2. " +
    "Use when user asks about their Base wallet, Base balance, or holdings on Base chain.",
  inputSchema: z.object({
    address: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid Ethereum address")
      .describe("Wallet address to check (0x...)"),
    network: z
      .enum(["mainnet", "testnet"])
      .default("mainnet")
      .describe("Base network"),
  }),
  outputSchema: z.object({
    address: z.string().optional(),
    network: z.string().optional(),
    ethBalance: z.number().optional(),
    tokens: z.array(z.object({
      symbol: z.string(),
      balance: z.number(),
      contractAddress: z.string(),
    })).optional(),
    error: z.string().optional(),
  }),
  execute: async ({ address, network }) => {
    try {
      const ethBalance = await getBaseBalance(address, network);

      // Check major token balances in parallel
      const tokenChecks = [
        { symbol: "USDC", address: BASE_TOKENS.USDC, decimals: 6 },
        { symbol: "WETH", address: BASE_TOKENS.WETH, decimals: 18 },
        { symbol: "DAI", address: BASE_TOKENS.DAI, decimals: 18 },
        { symbol: "cbETH", address: BASE_TOKENS.cbETH, decimals: 18 },
      ];

      const tokenResults = await Promise.allSettled(
        tokenChecks.map(async (token) => {
          const balance = await getBaseTokenBalance(
            token.address,
            address,
            token.decimals,
            network
          );
          return { symbol: token.symbol, balance, contractAddress: token.address as string };
        })
      );

      const tokens = tokenResults
        .filter((r): r is PromiseFulfilledResult<{ symbol: string; balance: number; contractAddress: string }> =>
          r.status === "fulfilled" && r.value.balance > 0
        )
        .map((r) => r.value);

      return {
        address,
        network: BASE_CHAIN_CONFIG[network].name,
        ethBalance,
        tokens,
      };
    } catch (error) {
      return { error: `Failed to fetch Base balance: ${(error as Error).message}` };
    }
  },
});

/**
 * Get Base network info and configuration
 */
export const getBaseInfoTool = createTool({
  id: "get_base_info",
  description:
    "Get Base L2 network information — chain ID, RPC endpoints, explorer links, and key token addresses. " +
    "Use when user asks about Base network details, endpoints, or configuration.",
  inputSchema: z.object({}),
  outputSchema: z.object({
    mainnet: z.object({
      chainId: z.number(),
      name: z.string(),
      rpc: z.string(),
      explorer: z.string(),
      currency: z.string(),
    }),
    testnet: z.object({
      chainId: z.number(),
      name: z.string(),
      rpc: z.string(),
      explorer: z.string(),
      currency: z.string(),
    }),
    keyTokens: z.array(z.object({
      symbol: z.string(),
      address: z.string(),
    })),
  }),
  execute: async () => {
    return {
      mainnet: {
        chainId: BASE_CHAIN_CONFIG.mainnet.chainId,
        name: BASE_CHAIN_CONFIG.mainnet.name,
        rpc: BASE_CHAIN_CONFIG.mainnet.rpc,
        explorer: BASE_CHAIN_CONFIG.mainnet.explorer,
        currency: BASE_CHAIN_CONFIG.mainnet.currency,
      },
      testnet: {
        chainId: BASE_CHAIN_CONFIG.testnet.chainId,
        name: BASE_CHAIN_CONFIG.testnet.name,
        rpc: BASE_CHAIN_CONFIG.testnet.rpc,
        explorer: BASE_CHAIN_CONFIG.testnet.explorer,
        currency: BASE_CHAIN_CONFIG.testnet.currency,
      },
      keyTokens: Object.entries(BASE_TOKENS).map(([symbol, address]) => ({
        symbol,
        address,
      })),
    };
  },
});

// ============================================================================
// Export as Mastra tool object
// ============================================================================

/**
 * Base onchain tools exported as an object for Mastra Agent
 * This is the format expected by Mastra's Agent class
 */
export const baseOnchainTools = {
  get_base_trending: getBaseTrendingTool,
  get_base_featured: getBaseFeaturedTool,
  get_base_gas: getBaseGasTool,
  get_base_balance: getBaseBalanceTool,
  get_base_info: getBaseInfoTool,
};
