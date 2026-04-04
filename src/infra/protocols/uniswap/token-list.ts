/**
 * Uniswap Token List
 * Fetches the official Uniswap token list and resolves symbols to addresses.
 *
 * - Lazy-loaded: fetches on first resolve() call
 * - Cached for 24h via in-memory Cache<T>
 * - Expands bridgeInfo for cross-chain resolution
 * - Falls back to hardcoded addresses if fetch fails
 */

import { Cache } from "../cache/cache.ts";
import type { TokenInfo, RawTokenListEntry, UniswapTokenListResponse } from "./types.ts";
import { WRAPPED_NATIVE, USDC_ADDRESSES, SUPPORTED_CHAIN_IDS } from "./types.ts";

const TOKEN_LIST_URL = "https://tokens.uniswap.org";
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

/**
 * Uniswap Token List — fetches, caches, and resolves token symbols to addresses
 */
export class UniswapTokenList {
  /** symbol:chainId → TokenInfo[] (array for collision handling) */
  private bySymbol: Map<string, TokenInfo[]> = new Map();
  /** lowercase address → TokenInfo */
  private byAddress: Map<string, TokenInfo> = new Map();
  /** Cache to track fetch TTL */
  private cache = new Cache<boolean>({ defaultTtl: CACHE_TTL_MS, maxEntries: 1 });
  /** In-flight fetch promise to deduplicate concurrent calls */
  private fetchPromise: Promise<void> | null = null;

  /**
   * Whether the token list has been loaded
   */
  isLoaded(): boolean {
    return this.cache.has("loaded");
  }

  /**
   * Ensure the token list is loaded (lazy fetch)
   */
  private async ensureLoaded(): Promise<void> {
    if (this.isLoaded()) return;

    // Deduplicate concurrent fetches
    if (this.fetchPromise) return this.fetchPromise;

    this.fetchPromise = this.fetchList();
    try {
      await this.fetchPromise;
    } finally {
      this.fetchPromise = null;
    }
  }

  /**
   * Fetch the token list from tokens.uniswap.org and build lookup maps
   */
  private async fetchList(): Promise<void> {
    try {
      const res = await fetch(TOKEN_LIST_URL);
      if (!res.ok) throw new Error(`Token list fetch failed: ${res.status}`);

      const data = (await res.json()) as UniswapTokenListResponse;
      this.buildMaps(data.tokens);
      this.cache.set("loaded", true, CACHE_TTL_MS);
    } catch {
      // If fetch fails but maps are empty, we'll rely on hardcoded fallbacks
      // If maps are populated (stale cache), keep using them
      if (this.bySymbol.size === 0) {
        this.buildHardcodedFallback();
      }
    }
  }

  /**
   * Build lookup maps from raw token entries
   */
  private buildMaps(tokens: RawTokenListEntry[]): void {
    this.bySymbol.clear();
    this.byAddress.clear();

    const supportedChains = new Set(SUPPORTED_CHAIN_IDS);

    for (const raw of tokens) {
      // Add direct entry if on a supported chain
      if (supportedChains.has(raw.chainId)) {
        this.addToken({
          chainId: raw.chainId,
          address: raw.address,
          symbol: raw.symbol,
          name: raw.name,
          decimals: raw.decimals,
          logoURI: raw.logoURI,
        });
      }

      // Expand bridgeInfo for cross-chain resolution
      if (raw.extensions?.bridgeInfo) {
        for (const [chainIdStr, bridge] of Object.entries(raw.extensions.bridgeInfo)) {
          const bridgeChainId = Number(chainIdStr);
          if (supportedChains.has(bridgeChainId)) {
            this.addToken({
              chainId: bridgeChainId,
              address: bridge.tokenAddress,
              symbol: raw.symbol,
              name: raw.name,
              decimals: raw.decimals,
              logoURI: raw.logoURI,
            });
          }
        }
      }
    }
  }

  /**
   * Build minimal maps from hardcoded constants (offline fallback)
   */
  private buildHardcodedFallback(): void {
    // Add WETH/WBNB/WMATIC/WAVAX entries
    for (const [chainIdStr, address] of Object.entries(WRAPPED_NATIVE)) {
      const chainId = Number(chainIdStr);
      const symbol = chainId === 56 ? "WBNB" : chainId === 137 ? "WMATIC" : chainId === 43114 ? "WAVAX" : "WETH";
      this.addToken({ chainId, address, symbol, name: `Wrapped Native (${symbol})`, decimals: 18 });
    }

    // Add USDC entries
    for (const [chainIdStr, address] of Object.entries(USDC_ADDRESSES)) {
      const chainId = Number(chainIdStr);
      this.addToken({ chainId, address, symbol: "USDC", name: "USD Coin", decimals: 6 });
    }

    this.cache.set("loaded", true, CACHE_TTL_MS);
  }

  /**
   * Add a token to both lookup maps
   */
  private addToken(token: TokenInfo): void {
    const key = `${token.symbol.toUpperCase()}:${token.chainId}`;
    const existing = this.bySymbol.get(key) || [];

    // Avoid duplicates (same address on same chain)
    if (!existing.some((t) => t.address.toLowerCase() === token.address.toLowerCase())) {
      existing.push(token);
      this.bySymbol.set(key, existing);
    }

    this.byAddress.set(token.address.toLowerCase(), token);
  }

  /**
   * Resolve a token symbol to its address on a specific chain.
   *
   * Resolution priority:
   * 1. Exact match on target chain
   * 2. Bridged token from Ethereum mainnet (canonical)
   * 3. First match on any chain
   *
   * @returns Token address or null if not found
   */
  async resolve(symbol: string, chainId: number): Promise<string | null> {
    await this.ensureLoaded();

    const sym = symbol.toUpperCase();

    // 1. Exact match on target chain
    const exact = this.bySymbol.get(`${sym}:${chainId}`);
    if (exact && exact.length > 0) return exact[0]!.address;

    // 2. Check Ethereum mainnet canonical + bridgeInfo
    const mainnet = this.bySymbol.get(`${sym}:1`);
    if (mainnet && mainnet.length > 0) {
      // The bridgeInfo expansion should have already added this chain,
      // but if not, return the mainnet address as a best effort
      return mainnet[0]!.address;
    }

    // 3. Any chain
    for (const [key, tokens] of this.bySymbol) {
      if (key.startsWith(`${sym}:`)) {
        return tokens[0]!.address;
      }
    }

    return null;
  }

  /**
   * Get full token info for a symbol on a specific chain
   */
  async getToken(symbol: string, chainId: number): Promise<TokenInfo | null> {
    await this.ensureLoaded();

    const sym = symbol.toUpperCase();
    const exact = this.bySymbol.get(`${sym}:${chainId}`);
    if (exact && exact.length > 0) return exact[0]!;

    const mainnet = this.bySymbol.get(`${sym}:1`);
    if (mainnet && mainnet.length > 0) return mainnet[0]!;

    return null;
  }

  /**
   * Look up token info by address
   */
  async getTokenByAddress(address: string): Promise<TokenInfo | null> {
    await this.ensureLoaded();
    return this.byAddress.get(address.toLowerCase()) || null;
  }
}
