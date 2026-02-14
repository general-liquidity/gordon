/**
 * DexScreener API Client
 * Free REST API for Base L2 DEX data — pairs, volume, liquidity, new tokens
 *
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
// Token Pair Data
// ============================================================================

/**
 * Get all DEX pairs for a token on Base
 * Returns price, volume, liquidity, buy/sell counts across timeframes
 */
export async function getBasePairs(tokenAddress: string): Promise<DexScreenerPair[]> {
  const data = await dexScreenerFetch<{ pairs: DexScreenerPair[] | null }>(
    `/token-pairs/v1/base/${tokenAddress}`
  );
  return (data.pairs ?? []).filter((p) => p.chainId === "base");
}

/**
 * Search for DEX pairs by query (e.g., "BRETT" or "WETH/USDC")
 * Filters results to Base chain only
 */
export async function searchBasePairs(query: string): Promise<DexScreenerPair[]> {
  const data = await dexScreenerFetch<{ pairs: DexScreenerPair[] | null }>(
    `/latest/dex/search?q=${encodeURIComponent(query)}`
  );
  return (data.pairs ?? []).filter((p) => p.chainId === "base");
}

/**
 * Get specific pair by pair address on Base
 */
export async function getBasePairByAddress(pairAddress: string): Promise<DexScreenerPair | null> {
  const data = await dexScreenerFetch<{ pairs: DexScreenerPair[] | null }>(
    `/latest/dex/pairs/base/${pairAddress}`
  );
  const pairs = data.pairs ?? [];
  return pairs[0] ?? null;
}

/**
 * Batch lookup multiple tokens on Base (up to 30 addresses)
 */
export async function getBaseTokensBatch(addresses: string[]): Promise<DexScreenerPair[]> {
  if (addresses.length === 0) return [];
  const batch = addresses.slice(0, 30).join(",");
  const data = await dexScreenerFetch<{ pairs: DexScreenerPair[] | null }>(
    `/tokens/v1/base/${batch}`
  );
  return (data.pairs ?? []).filter((p) => p.chainId === "base");
}

// ============================================================================
// New Token Discovery
// ============================================================================

/**
 * Get newly created token profiles, filtered to Base
 */
export async function getNewBaseTokens(): Promise<DexScreenerTokenProfile[]> {
  const data = await dexScreenerFetch<DexScreenerTokenProfile[]>(
    `/token-profiles/latest/v1`
  );
  return (data ?? []).filter((t) => t.chainId === "base");
}

/**
 * Get trending/boosted tokens, filtered to Base
 */
export async function getBoostedBaseTokens(): Promise<DexScreenerTokenProfile[]> {
  const data = await dexScreenerFetch<DexScreenerTokenProfile[]>(
    `/token-boosts/top/v1`
  );
  return (data ?? []).filter((t) => t.chainId === "base");
}
