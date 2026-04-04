/**
 * DefiLlama Yield Tools (Mastra Format)
 * Agent-facing tools for DeFi pool yield data from DefiLlama.
 *
 * These complement the existing defillama_search_protocols / defillama_get_protocol
 * tools (via AgentKit) with direct pool-level yield data.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  getUniswapPoolYields,
  getTopYieldPools,
} from "../../protocols/defillama/client.ts";

// ============================================================================
// Uniswap Pool Yields
// ============================================================================

export const getUniswapYieldsTool = createTool({
  id: "get_uniswap_pool_yields",
  description:
    "Get current APY, TVL, and volume data for Uniswap V3/V4 pools from DefiLlama. " +
    "Shows base APY (fees), reward APY, 7d/30d trends, impermanent loss risk, and pool TVL. " +
    "Use for yield farming analysis, comparing fee tiers, and LP profitability assessment. " +
    "Supports all chains: Ethereum, Base, Arbitrum, Optimism, Polygon, etc.",
  inputSchema: z.object({
    chain: z.string().optional().describe(
      "Chain name (e.g., 'ethereum', 'base', 'arbitrum'). Omit for all chains.",
    ),
    symbol: z.string().optional().describe(
      "Token pair filter (e.g., 'WETH-USDC', 'USDC'). Partial match.",
    ),
    limit: z.number().min(1).max(50).default(15).describe("Max pools to return"),
  }),
  outputSchema: z.object({
    pools: z.array(z.object({
      pool: z.string(),
      symbol: z.string(),
      chain: z.string(),
      tvlUsd: z.number(),
      apy: z.number(),
      apyBase: z.number().nullable(),
      apyReward: z.number().nullable(),
      apyPct7D: z.number().nullable(),
      apyPct30D: z.number().nullable(),
      volumeUsd1d: z.number().nullable(),
      volumeUsd7d: z.number().nullable(),
      ilRisk: z.string(),
      stablecoin: z.boolean(),
      poolMeta: z.string().nullable(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ chain, symbol, limit }) => {
    try {
      const pools = await getUniswapPoolYields(chain, symbol);
      return {
        count: Math.min(pools.length, limit),
        pools: pools.slice(0, limit).map((p) => ({
          pool: p.pool,
          symbol: p.symbol,
          chain: p.chain,
          tvlUsd: Math.round(p.tvlUsd),
          apy: Math.round(p.apy * 100) / 100,
          apyBase: p.apyBase !== null ? Math.round(p.apyBase * 100) / 100 : null,
          apyReward: p.apyReward !== null ? Math.round(p.apyReward * 100) / 100 : null,
          apyPct7D: p.apyPct7D !== null ? Math.round(p.apyPct7D * 100) / 100 : null,
          apyPct30D: p.apyPct30D !== null ? Math.round(p.apyPct30D * 100) / 100 : null,
          volumeUsd1d: p.volumeUsd1d !== null ? Math.round(p.volumeUsd1d) : null,
          volumeUsd7d: p.volumeUsd7d !== null ? Math.round(p.volumeUsd7d) : null,
          ilRisk: p.ilRisk,
          stablecoin: p.stablecoin,
          poolMeta: p.poolMeta,
        })),
      };
    } catch (error) {
      return { error: `Failed to get Uniswap yields: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Top DeFi Yields
// ============================================================================

export const getTopYieldsTool = createTool({
  id: "get_top_defi_yields",
  description:
    "Get the highest-yielding DeFi pools across all protocols from DefiLlama. " +
    "Includes Uniswap, Aave, Compound, Aerodrome, Curve, and all tracked protocols. " +
    "Use for finding the best yield opportunities, comparing protocols, and yield farming research.",
  inputSchema: z.object({
    chain: z.string().optional().describe(
      "Chain name (e.g., 'ethereum', 'base', 'arbitrum'). Omit for all chains.",
    ),
    limit: z.number().min(1).max(50).default(20).describe("Max pools to return"),
    minTvl: z.number().default(100000).describe("Minimum TVL in USD (default: 100000)"),
  }),
  outputSchema: z.object({
    pools: z.array(z.object({
      pool: z.string(),
      project: z.string(),
      symbol: z.string(),
      chain: z.string(),
      tvlUsd: z.number(),
      apy: z.number(),
      apyBase: z.number().nullable(),
      apyReward: z.number().nullable(),
      stablecoin: z.boolean(),
      ilRisk: z.string(),
    })).optional(),
    count: z.number().optional(),
    error: z.string().optional(),
  }),
  execute: async ({ chain, limit, minTvl }) => {
    try {
      const pools = await getTopYieldPools(chain, limit, minTvl);
      return {
        count: pools.length,
        pools: pools.map((p) => ({
          pool: p.pool,
          project: p.project,
          symbol: p.symbol,
          chain: p.chain,
          tvlUsd: Math.round(p.tvlUsd),
          apy: Math.round(p.apy * 100) / 100,
          apyBase: p.apyBase !== null ? Math.round(p.apyBase * 100) / 100 : null,
          apyReward: p.apyReward !== null ? Math.round(p.apyReward * 100) / 100 : null,
          stablecoin: p.stablecoin,
          ilRisk: p.ilRisk,
        })),
      };
    } catch (error) {
      return { error: `Failed to get top yields: ${(error as Error).message}` };
    }
  },
});

// ============================================================================
// Export
// ============================================================================

export const defillamaYieldTools = {
  get_uniswap_pool_yields: getUniswapYieldsTool,
  get_top_defi_yields: getTopYieldsTool,
};
