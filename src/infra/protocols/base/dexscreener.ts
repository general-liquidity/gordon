/**
 * DexScreener API Client
 * Free REST API for DEX data — pairs, volume, liquidity, new tokens
 *
 * Supports all chains: ethereum, base, arbitrum, optimism, polygon, bsc, avalanche, etc.
 * No API key required. Rate limit: 300 req/min for pair/token endpoints.
 * Docs: https://docs.dexscreener.com
 */

import type {
  DexScreenerPair,
  DexScreenerTokenProfile,
} from "./types.ts";

// ============================================================================
// Configuration
// ============================================================================

const DEXSCREENER_BASE = "https://api.dexscreener.com";

/**
 * Map chain IDs to DexScreener network identifiers.
 * DexScreener uses lowercase string IDs, not numeric chain IDs.
 */
export const DEXSCREENER_CHAIN_IDS: Record<number, string> = {
  1: "ethereum",
  10: "optimism",
  56: "bsc",
  130: "unichain",
  137: "polygon",
  143: "monad",
  8453: "base",
  42161: "arbitrum",
  42220: "celo",
  43114: "avalanche",
  81457: "blast",
  7777777: "zora",
  480: "worldchain",
};

// ============================================================================
// Internal Helpers
// ============================================================================

async function dexScreenerFetch<T>(path: string): Promise<T> {
  const url = `${DEXSCREENER_BASE}${path}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });

  if (!res.ok) {
    throw new Error(`DexScreener API error: ${res.status} ${res.statusText}`);
  }

  return (await res.json()) as T;
}

// ============================================================================
// Multi-Chain Token Pair Data
// ============================================================================

/**
 * Get all DEX pairs for a token on any chain
 * @param chain - DexScreener chain ID (e.g., "base", "ethereum", "arbitrum")
 * @param tokenAddress - Token contract address
 */
export async function getDexPairs(chain: string, tokenAddress: string): Promise<DexScreenerPair[]> {
  const data = await dexScreenerFetch<{ pairs: DexScreenerPair[] | null }>(
    `/token-pairs/v1/${chain}/${tokenAddress}`
  );
  return (data.pairs ?? []).filter((p) => p.chainId === chain);
}

/**
 * Search for DEX pairs by query, optionally filtered to a specific chain
 * @param query - Search term (e.g., "BRETT", "WETH/USDC", token address)
 * @param chain - Optional chain filter (e.g., "base", "ethereum"). If omitted, returns all chains.
 * @param dex - Optional DEX filter (e.g., "uniswap"). If omitted, returns all DEXs.
 */
export async function searchDexPairs(
  query: string,
  chain?: string,
  dex?: string,
): Promise<DexScreenerPair[]> {
  const data = await dexScreenerFetch<{ pairs: DexScreenerPair[] | null }>(
    `/latest/dex/search?q=${encodeURIComponent(query)}`
  );
  let pairs = data.pairs ?? [];
  if (chain) pairs = pairs.filter((p) => p.chainId === chain);
  if (dex) pairs = pairs.filter((p) => p.dexId === dex);
  return pairs;
}

/**
 * Batch lookup multiple tokens on any chain (up to 30 addresses)
 */
export async function getDexTokensBatch(chain: string, addresses: string[]): Promise<DexScreenerPair[]> {
  if (addresses.length === 0) return [];
  const batch = addresses.slice(0, 30).join(",");
  const data = await dexScreenerFetch<{ pairs: DexScreenerPair[] | null }>(
    `/tokens/v1/${chain}/${batch}`
  );
  return (data.pairs ?? []).filter((p) => p.chainId === chain);
}

/**
 * Get newly created token profiles, optionally filtered to a chain
 */
export async function getNewTokens(chain?: string): Promise<DexScreenerTokenProfile[]> {
  const data = await dexScreenerFetch<DexScreenerTokenProfile[]>(
    `/token-profiles/latest/v1`
  );
  if (!chain) return data ?? [];
  return (data ?? []).filter((t) => t.chainId === chain);
}

/**
 * Get trending/boosted tokens, optionally filtered to a chain
 */
export async function getBoostedTokens(chain?: string): Promise<DexScreenerTokenProfile[]> {
  const data = await dexScreenerFetch<DexScreenerTokenProfile[]>(
    `/token-boosts/top/v1`
  );
  if (!chain) return data ?? [];
  return (data ?? []).filter((t) => t.chainId === chain);
}

// ============================================================================
// Base-Specific Wrappers (backward compatibility)
// ============================================================================

/** Get all DEX pairs for a token on Base */
export async function getBasePairs(tokenAddress: string): Promise<DexScreenerPair[]> {
  return getDexPairs("base", tokenAddress);
}

/** Search for DEX pairs by query, filtered to Base */
export async function searchBasePairs(query: string): Promise<DexScreenerPair[]> {
  return searchDexPairs(query, "base");
}

/** Get specific pair by pair address on Base */
export async function getBasePairByAddress(pairAddress: string): Promise<DexScreenerPair | null> {
  const data = await dexScreenerFetch<{ pairs: DexScreenerPair[] | null }>(
    `/latest/dex/pairs/base/${pairAddress}`
  );
  const pairs = data.pairs ?? [];
  return pairs[0] ?? null;
}

/** Batch lookup multiple tokens on Base (up to 30 addresses) */
export async function getBaseTokensBatch(addresses: string[]): Promise<DexScreenerPair[]> {
  return getDexTokensBatch("base", addresses);
}

/** Get newly created token profiles, filtered to Base */
export async function getNewBaseTokens(): Promise<DexScreenerTokenProfile[]> {
  return getNewTokens("base");
}

/** Get trending/boosted tokens, filtered to Base */
export async function getBoostedBaseTokens(): Promise<DexScreenerTokenProfile[]> {
  return getBoostedTokens("base");
}
