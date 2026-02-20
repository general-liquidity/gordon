/**
 * DefiLlama API Client
 * Direct integration for pool yields and cross-chain token prices.
 *
 * APIs:
 * - yields.llama.fi/pools — Pool APY, TVL, volume for all DeFi protocols
 * - coins.llama.fi/prices — Cross-chain token prices
 *
 * No API key required. Rate limits are generous (~500 req/min).
 */

import { Cache } from "../cache/cache.ts";
import type {
  DefiLlamaPool,
  DefiLlamaPoolsResponse,
  DefiLlamaPricesResponse,
  DefiLlamaTokenPrice,
} from "./types.ts";

const YIELDS_BASE = "https://yields.llama.fi";
const COINS_BASE = "https://coins.llama.fi";

/**
 * Map DexScreener/Uniswap chain names to DefiLlama chain identifiers.
 * DefiLlama uses title-case chain names in pool data.
 */
export const DEFILLAMA_CHAINS: Record<string, string> = {
  ethereum: "Ethereum",
  base: "Base",
  arbitrum: "Arbitrum",
  optimism: "Optimism",
  polygon: "Polygon",
  bsc: "BSC",
  avalanche: "Avalanche",
  celo: "Celo",
  blast: "Blast",
  unichain: "Unichain",
};

/**
 * Map numeric chain IDs to DefiLlama coins API chain identifiers.
 * coins.llama.fi uses lowercase chain names with colons.
 */
export const DEFILLAMA_COIN_CHAINS: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  137: "polygon",
  8453: "base",
  42161: "arbitrum",
  42220: "celo",
  43114: "avax", // DefiLlama uses "avax" not "avalanche"
  81457: "blast",
  130: "unichain",
};

// Cache pools for 5 min (the full dataset is ~30MB, avoid hammering)
const poolsCache = new Cache<DefiLlamaPool[]>({ defaultTtl: 5 * 60 * 1000 });
const priceCache = new Cache<Record<string, DefiLlamaTokenPrice>>({ defaultTtl: 2 * 60 * 1000 });

async function llamaFetch<T>(base: string, path: string): Promise<T> {
  const url = `${base}${path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  if (!res.ok) {
    throw new Error(`DefiLlama API error: ${res.status} ${res.statusText}`);
  }
  return (await res.json()) as T;
}

// ============================================================================
// Pool Yields
// ============================================================================

/**
 * Get all pool yield data from DefiLlama.
 * Results are cached for 5 minutes (the dataset is large).
 */
async function getAllPools(): Promise<DefiLlamaPool[]> {
  const cached = poolsCache.get("all");
  if (cached) return cached;

  const resp = await llamaFetch<DefiLlamaPoolsResponse>(YIELDS_BASE, "/pools");
  const pools = resp.data ?? [];
  poolsCache.set("all", pools);
  return pools;
}

/**
 * Get Uniswap V3 pool yields for a specific chain.
 * @param chain - DefiLlama chain name (e.g., "Ethereum", "Base")
 * @param symbol - Optional symbol filter (e.g., "WETH-USDC")
 */
export async function getUniswapPoolYields(
  chain?: string,
  symbol?: string,
): Promise<DefiLlamaPool[]> {
  const allPools = await getAllPools();
  let pools = allPools.filter(
    (p) => p.project === "uniswap-v3" || p.project === "uniswap-v4",
  );

  if (chain) {
    const defillamaChain = DEFILLAMA_CHAINS[chain.toLowerCase()] ?? chain;
    pools = pools.filter((p) => p.chain === defillamaChain);
  }

  if (symbol) {
    const sym = symbol.toUpperCase();
    pools = pools.filter((p) => p.symbol.toUpperCase().includes(sym));
  }

  // Sort by TVL descending
  pools.sort((a, b) => b.tvlUsd - a.tvlUsd);
  return pools;
}

/**
 * Get top yield pools across all DeFi protocols on a chain.
 * @param chain - DefiLlama chain name
 * @param limit - Max pools to return (default: 20)
 * @param minTvl - Minimum TVL in USD (default: 100000)
 */
export async function getTopYieldPools(
  chain?: string,
  limit = 20,
  minTvl = 100000,
): Promise<DefiLlamaPool[]> {
  const allPools = await getAllPools();
  let pools = allPools.filter((p) => p.tvlUsd >= minTvl && p.apy > 0);

  if (chain) {
    const defillamaChain = DEFILLAMA_CHAINS[chain.toLowerCase()] ?? chain;
    pools = pools.filter((p) => p.chain === defillamaChain);
  }

  // Sort by APY descending
  pools.sort((a, b) => b.apy - a.apy);
  return pools.slice(0, limit);
}

/**
 * Get yield for a specific pool by its DefiLlama pool ID.
 */
export async function getPoolYield(poolId: string): Promise<DefiLlamaPool | null> {
  const allPools = await getAllPools();
  return allPools.find((p) => p.pool === poolId) ?? null;
}

// ============================================================================
// Token Prices
// ============================================================================

/**
 * Get token prices from DefiLlama's coins API.
 * @param tokens - Array of "chain:address" strings (e.g., ["base:0x833589...", "ethereum:0xA0b8..."])
 */
export async function getTokenPrices(
  tokens: string[],
): Promise<Record<string, DefiLlamaTokenPrice>> {
  if (tokens.length === 0) return {};

  const key = tokens.sort().join(",");
  const cached = priceCache.get(key);
  if (cached) return cached;

  const joined = tokens.join(",");
  const resp = await llamaFetch<DefiLlamaPricesResponse>(
    COINS_BASE,
    `/prices/current/${joined}`,
  );

  const prices = resp.coins ?? {};
  priceCache.set(key, prices);
  return prices;
}
