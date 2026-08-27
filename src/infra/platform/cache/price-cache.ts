/**
 * Price Cache
 * Specialized cache for cryptocurrency prices
 */

import { Cache } from "./cache.ts";

/**
 * Cached price data
 */
export interface CachedPrice {
  price: number;
  timestamp: number;
}

/**
 * Price cache configuration
 */
export interface PriceCacheConfig {
  /** TTL for price data in milliseconds (default: 30 seconds) */
  priceTtl: number;
  /** Maximum number of symbols to cache */
  maxSymbols: number;
}

/**
 * Specialized cache for price data
 * Short TTL since prices change frequently
 */
export class PriceCache {
  private cache: Cache<CachedPrice>;
  private config: PriceCacheConfig;

  constructor(config: Partial<PriceCacheConfig> = {}) {
    this.config = {
      priceTtl: config.priceTtl ?? 30000, // 30 seconds
      maxSymbols: config.maxSymbols ?? 500,
    };

    this.cache = new Cache<CachedPrice>({
      defaultTtl: this.config.priceTtl,
      maxEntries: this.config.maxSymbols,
      updateTtlOnAccess: false,
    });
  }

  /**
   * Get cached price for a symbol
   */
  getPrice(symbol: string): number | undefined {
    const cached = this.cache.get(symbol.toUpperCase());
    return cached?.price;
  }

  /**
   * Set price for a symbol
   */
  setPrice(symbol: string, price: number): void {
    this.cache.set(symbol.toUpperCase(), {
      price,
      timestamp: Date.now(),
    });
  }

  /**
   * Set multiple prices at once
   */
  setPrices(prices: Record<string, number>): void {
    const timestamp = Date.now();
    for (const [symbol, price] of Object.entries(prices)) {
      this.cache.set(symbol.toUpperCase(), { price, timestamp });
    }
  }

  /**
   * Get or fetch price
   */
  async getOrFetch(symbol: string, fetcher: () => Promise<number>): Promise<number> {
    const upperSymbol = symbol.toUpperCase();
    const cached = this.cache.get(upperSymbol);

    if (cached) {
      return cached.price;
    }

    const price = await fetcher();
    this.setPrice(upperSymbol, price);
    return price;
  }

  /**
   * Check if price is cached and fresh
   */
  hasFreshPrice(symbol: string, maxAge?: number): boolean {
    const cached = this.cache.get(symbol.toUpperCase());
    if (!cached) return false;

    const age = Date.now() - cached.timestamp;
    return age < (maxAge ?? this.config.priceTtl);
  }

  /**
   * Get age of cached price in milliseconds
   */
  getPriceAge(symbol: string): number | undefined {
    const cached = this.cache.get(symbol.toUpperCase());
    if (!cached) return undefined;
    return Date.now() - cached.timestamp;
  }

  /**
   * Clear all cached prices
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return this.cache.getStats();
  }

  /**
   * Invalidate price for a symbol
   */
  invalidate(symbol: string): void {
    this.cache.delete(symbol.toUpperCase());
  }

  /**
   * Invalidate all prices for symbols matching a pattern
   */
  invalidatePattern(pattern: RegExp): number {
    let invalidated = 0;
    for (const key of this.cache.keys()) {
      if (pattern.test(key)) {
        this.cache.delete(key);
        invalidated++;
      }
    }
    return invalidated;
  }
}

// Default price cache instance
let defaultPriceCache: PriceCache | null = null;

/**
 * Get the default price cache instance
 */
export function getPriceCache(): PriceCache {
  if (!defaultPriceCache) {
    defaultPriceCache = new PriceCache();
  }
  return defaultPriceCache;
}

/**
 * Set the default price cache instance
 */
export function setPriceCache(cache: PriceCache): void {
  defaultPriceCache = cache;
}
