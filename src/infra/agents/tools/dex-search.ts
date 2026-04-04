/**
 * Multi-Chain DexScreener Tools (Mastra Format)
 * Chain-agnostic DEX data tools that work across all DexScreener-supported chains.
 *
 * These complement the Base-specific tools in base-signals.ts with cross-chain
 * capabilities: search any chain, discover tokens globally, compare liquidity.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  searchDexPairs,
  getDexPairs,
  getBoostedTokens,
  DEXSCREENER_CHAIN_IDS,
} from "../../protocols/base/dexscreener.ts";

// ============================================================================
// Multi-Chain DEX Search
// ============================================================================

export const searchDexPairsTool = createTool({
  id: "search_dex_pairs",
  description:
    "Search for DEX trading pairs across any chain using DexScreener. " +
    "Works on Ethereum, Base, Arbitrum, Optimism, Polygon, BSC, Avalanche, and more. " +
    "Filter by chain and/or DEX. No API key needed. " +
    "Use when user asks about DEX pairs on chains other than Base, or wants to compare " +
    "pairs across chains. For Base-only queries, prefer get_base_dex_pairs.",
  inputSchema: z.object({
    query: z.string().describe(
      "Search term: token symbol (e.g., 'UNI'), pair (e.g., 'WETH/USDC'), or token address (0x...)",
    ),
    chain: z.string().optional().describe(
      "DexScreener chain ID: 'ethereum', 'base', 'arbitrum', 'optimism', 'polygon', 'bsc', 'avalanche', 'unichain'. Omit for all chains.",
    ),
    dex: z.string().optional().describe(
      "DEX filter: 'uniswap', 'sushiswap', 'aerodrome', 'curve', etc. Omit for all DEXs.",
    ),
  }),
  outputSchema: z.object({
    pairs: z.array(z.object({
      chain: z.string(),
      pairAddress: z.string(),
      dex: z.string(),
      baseToken: z.string(),
      quoteToken: z.string(),
      priceUsd: z.string(),
      volumeH24: z.number(),
      liquidityUsd: z.number(),
      priceChangeH24: z.number(),
      marketCap: z.number().nullable(),
      url: z.string(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ query, chain, dex }) => {
    try {
      // If query looks like an address and chain is specified, use direct pair lookup
      const isAddress = /^0x[a-fA-F0-9]{40}$/.test(query);
      let pairs;

      if (isAddress && chain) {
        pairs = await getDexPairs(chain, query);
        if (dex) pairs = pairs.filter((p) => p.dexId === dex);
      } else {
        pairs = await searchDexPairs(query, chain, dex);
      }

      return {
        count: pairs.length,
        pairs: pairs.slice(0, 25).map((p) => ({
          chain: p.chainId,
          pairAddress: p.pairAddress,
          dex: p.dexId,
          baseToken: `${p.baseToken.symbol} (${p.baseToken.address})`,
          quoteToken: `${p.quoteToken.symbol} (${p.quoteToken.address})`,
          priceUsd: p.priceUsd,
          volumeH24: p.volume?.h24 ?? 0,
          liquidityUsd: p.liquidity?.usd ?? 0,
          priceChangeH24: p.priceChange?.h24 ?? 0,
          marketCap: p.marketCap ?? null,
          url: p.url,
        })),
      };
    } catch (error) {
      return { error: `Failed to search DEX pairs: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Multi-Chain Boosted/Trending Tokens
// ============================================================================

export const getBoostedTokensTool = createTool({
  id: "get_boosted_tokens",
  description:
    "Get currently promoted/boosted tokens from DexScreener across all chains. " +
    "Shows tokens with active promotions — can indicate marketing spend or community interest. " +
    "Optionally filter by chain. No API key needed.",
  inputSchema: z.object({
    chain: z.string().optional().describe(
      "Filter to a specific chain: 'ethereum', 'base', 'arbitrum', etc. Omit for all chains.",
    ),
  }),
  outputSchema: z.object({
    tokens: z.array(z.object({
      chain: z.string(),
      tokenAddress: z.string(),
      url: z.string(),
      description: z.string().optional(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ chain }) => {
    try {
      const tokens = await getBoostedTokens(chain);
      return {
        count: tokens.length,
        tokens: tokens.slice(0, 30).map((t) => ({
          chain: t.chainId,
          tokenAddress: t.tokenAddress,
          url: t.url,
          description: t.description,
        })),
      };
    } catch (error) {
      return { error: `Failed to get boosted tokens: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export const dexSearchTools = {
  search_dex_pairs: searchDexPairsTool,
  get_boosted_tokens: getBoostedTokensTool,
};
