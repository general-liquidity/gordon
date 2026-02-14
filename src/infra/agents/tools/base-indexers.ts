/**
 * Base L2 Data Indexer Tools
 * Tools for querying decentralized indexers (The Graph) on Base L2
 *
 * Data sources:
 * - Uniswap V3 on Base (public subgraph, no API key)
 * - Aerodrome on Base (public subgraph, no API key)
 *
 * These provide on-chain DEX analytics: pool TVL, volumes, top pairs,
 * and liquidity data that complement DeFiLlama's protocol-level data
 * and DexScreener's real-time pair data.
 *
 * Tools:
 * - indexer_top_pools: Get top liquidity pools from Uniswap V3 on Base
 * - indexer_pool_stats: Get detailed stats for a specific Uniswap V3 pool
 * - indexer_aerodrome_pools: Get top Aerodrome pools on Base
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

// ============================================================================
// The Graph Subgraph Endpoints (Public, No API Key)
// ============================================================================

const SUBGRAPH_URLS = {
  uniswapV3Base: "https://api.studio.thegraph.com/query/48211/uniswap-v3-base/version/latest",
  aerodromeBase: "https://api.studio.thegraph.com/query/50942/aerodrome-cl/version/latest",
} as const;

// ============================================================================
// GraphQL Query Helper
// ============================================================================

async function querySubgraph(
  url: string,
  query: string,
  variables: Record<string, unknown> = {},
): Promise<{ success: boolean; data?: unknown; error?: string }> {
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ query, variables }),
    });

    if (!response.ok) {
      return { success: false, error: `Subgraph returned ${response.status}: ${response.statusText}` };
    }

    const json = (await response.json()) as { data?: unknown; errors?: Array<{ message: string }> };
    if (json.errors && json.errors.length > 0) {
      return { success: false, error: json.errors.map((e) => e.message).join("; ") };
    }

    return { success: true, data: json.data };
  } catch (error) {
    return { success: false, error: `Subgraph query failed: ${(error as Error).message}` };
  }
}

// ============================================================================
// Output Schema
// ============================================================================

const indexerResultSchema = z.object({
  success: z.boolean(),
  data: z.string(),
  source: z.string(),
  error: z.string().optional(),
});

type IndexerResult = z.infer<typeof indexerResultSchema>;

// ============================================================================
// Uniswap V3 Tools
// ============================================================================

/**
 * Get top liquidity pools from Uniswap V3 on Base
 */
export const indexerTopPoolsTool = createTool({
  id: "indexer_top_pools",
  description:
    "Get top Uniswap V3 liquidity pools on Base L2 ranked by total value locked (TVL). " +
    "Returns pool addresses, token pairs, TVL, volume, and fee tiers. " +
    "Use for on-chain liquidity analysis, finding deep pools for large trades, " +
    "or identifying where most Base DEX activity is concentrated.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of pools to return (default: 10, max: 50)"),
    orderBy: z
      .enum(["totalValueLockedUSD", "volumeUSD"])
      .optional()
      .describe("Sort by TVL or volume (default: totalValueLockedUSD)"),
  }),
  outputSchema: indexerResultSchema,
  execute: async ({ limit = 10, orderBy = "totalValueLockedUSD" }): Promise<IndexerResult> => {
    const query = `
      query TopPools($limit: Int!, $orderBy: Pool_orderBy!) {
        pools(
          first: $limit
          orderBy: $orderBy
          orderDirection: desc
          where: { totalValueLockedUSD_gt: "1000" }
        ) {
          id
          token0 { symbol name id }
          token1 { symbol name id }
          feeTier
          totalValueLockedUSD
          volumeUSD
          txCount
        }
      }
    `;

    const result = await querySubgraph(SUBGRAPH_URLS.uniswapV3Base, query, {
      limit,
      orderBy,
    });

    if (!result.success) {
      return { success: false, data: "", source: "uniswap-v3-base", error: result.error };
    }

    const pools = (result.data as { pools: Array<Record<string, unknown>> }).pools;
    const formatted = pools.map((pool, i) => {
      const token0 = pool.token0 as { symbol: string };
      const token1 = pool.token1 as { symbol: string };
      const feeBps = Number(pool.feeTier) / 100;
      return `${i + 1}. ${token0.symbol}/${token1.symbol} (${feeBps}bps) — TVL: $${Number(pool.totalValueLockedUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })}, Vol: $${Number(pool.volumeUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })}, Txs: ${pool.txCount}, Pool: ${pool.id}`;
    });

    return {
      success: true,
      data: `Top ${pools.length} Uniswap V3 pools on Base (by ${orderBy === "totalValueLockedUSD" ? "TVL" : "Volume"}):\n${formatted.join("\n")}`,
      source: "uniswap-v3-base",
    };
  },
});

/**
 * Get detailed stats for a specific Uniswap V3 pool on Base
 */
export const indexerPoolStatsTool = createTool({
  id: "indexer_pool_stats",
  description:
    "Get detailed on-chain statistics for a specific Uniswap V3 pool on Base L2. " +
    "Returns TVL, volume, fee tier, tick data, and token details. " +
    "Use the pool address from indexer_top_pools or get_base_dex_pairs.",
  inputSchema: z.object({
    poolAddress: z
      .string()
      .regex(/^0x[a-fA-F0-9]{40}$/, "Must be a valid pool contract address")
      .describe("Uniswap V3 pool contract address on Base"),
  }),
  outputSchema: indexerResultSchema,
  execute: async ({ poolAddress }): Promise<IndexerResult> => {
    const query = `
      query PoolStats($id: ID!) {
        pool(id: $id) {
          id
          token0 { symbol name id decimals }
          token1 { symbol name id decimals }
          feeTier
          liquidity
          sqrtPrice
          tick
          totalValueLockedToken0
          totalValueLockedToken1
          totalValueLockedUSD
          volumeUSD
          volumeToken0
          volumeToken1
          txCount
          token0Price
          token1Price
          poolDayData(first: 7, orderBy: date, orderDirection: desc) {
            date
            volumeUSD
            tvlUSD
            feesUSD
          }
        }
      }
    `;

    const result = await querySubgraph(SUBGRAPH_URLS.uniswapV3Base, query, {
      id: poolAddress.toLowerCase(),
    });

    if (!result.success) {
      return { success: false, data: "", source: "uniswap-v3-base", error: result.error };
    }

    const pool = (result.data as { pool: Record<string, unknown> | null }).pool;
    if (!pool) {
      return { success: false, data: "", source: "uniswap-v3-base", error: `Pool ${poolAddress} not found on Uniswap V3 Base` };
    }

    const token0 = pool.token0 as { symbol: string; name: string; id: string };
    const token1 = pool.token1 as { symbol: string; name: string; id: string };
    const feeBps = Number(pool.feeTier) / 100;
    const dayData = pool.poolDayData as Array<{ date: number; volumeUSD: string; tvlUSD: string; feesUSD: string }>;

    const lines = [
      `Pool: ${token0.symbol}/${token1.symbol} (${feeBps}bps fee)`,
      `Address: ${pool.id}`,
      `TVL: $${Number(pool.totalValueLockedUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })} (${Number(pool.totalValueLockedToken0).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${token0.symbol} + ${Number(pool.totalValueLockedToken1).toLocaleString(undefined, { maximumFractionDigits: 2 })} ${token1.symbol})`,
      `All-time Volume: $${Number(pool.volumeUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
      `Total Transactions: ${pool.txCount}`,
      `Current Price: 1 ${token0.symbol} = ${Number(pool.token1Price).toLocaleString(undefined, { maximumFractionDigits: 6 })} ${token1.symbol}`,
      `Token0: ${token0.name} (${token0.id})`,
      `Token1: ${token1.name} (${token1.id})`,
    ];

    if (dayData && dayData.length > 0) {
      lines.push("", "Last 7 days:");
      for (const day of dayData) {
        const date = new Date(day.date * 1000).toISOString().split("T")[0];
        lines.push(`  ${date}: Vol $${Number(day.volumeUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })}, TVL $${Number(day.tvlUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })}, Fees $${Number(day.feesUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })}`);
      }
    }

    return { success: true, data: lines.join("\n"), source: "uniswap-v3-base" };
  },
});

// ============================================================================
// Aerodrome Tools
// ============================================================================

/**
 * Get top Aerodrome pools on Base
 */
export const indexerAerodromePoolsTool = createTool({
  id: "indexer_aerodrome_pools",
  description:
    "Get top Aerodrome concentrated liquidity pools on Base L2. Aerodrome is the largest " +
    "DEX on Base by TVL. Returns pool addresses, token pairs, TVL, volume, and fee tiers. " +
    "Use for Base-native DeFi analysis, comparing liquidity across DEXes, " +
    "or finding the best trading venues for Base tokens like AERO, USDC, WETH.",
  inputSchema: z.object({
    limit: z
      .number()
      .min(1)
      .max(50)
      .optional()
      .describe("Number of pools to return (default: 10, max: 50)"),
  }),
  outputSchema: indexerResultSchema,
  execute: async ({ limit = 10 }): Promise<IndexerResult> => {
    const query = `
      query TopPools($limit: Int!) {
        pools(
          first: $limit
          orderBy: totalValueLockedUSD
          orderDirection: desc
          where: { totalValueLockedUSD_gt: "1000" }
        ) {
          id
          token0 { symbol name id }
          token1 { symbol name id }
          feeTier
          totalValueLockedUSD
          volumeUSD
          txCount
        }
      }
    `;

    const result = await querySubgraph(SUBGRAPH_URLS.aerodromeBase, query, { limit });

    if (!result.success) {
      return { success: false, data: "", source: "aerodrome-base", error: result.error };
    }

    const pools = (result.data as { pools: Array<Record<string, unknown>> }).pools;
    const formatted = pools.map((pool, i) => {
      const token0 = pool.token0 as { symbol: string };
      const token1 = pool.token1 as { symbol: string };
      const feeBps = Number(pool.feeTier) / 100;
      return `${i + 1}. ${token0.symbol}/${token1.symbol} (${feeBps}bps) — TVL: $${Number(pool.totalValueLockedUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })}, Vol: $${Number(pool.volumeUSD).toLocaleString(undefined, { maximumFractionDigits: 0 })}, Txs: ${pool.txCount}, Pool: ${pool.id}`;
    });

    return {
      success: true,
      data: `Top ${pools.length} Aerodrome CL pools on Base (by TVL):\n${formatted.join("\n")}`,
      source: "aerodrome-base",
    };
  },
});

// ============================================================================
// Export as Mastra tool object
// ============================================================================

export const baseIndexerTools = {
  indexer_top_pools: indexerTopPoolsTool,
  indexer_pool_stats: indexerPoolStatsTool,
  indexer_aerodrome_pools: indexerAerodromePoolsTool,
};
