/**
 * Pre-configured Fallback Wrappers for Binance Operations
 * Provides resilient access to critical Binance API endpoints
 */

import type { BinanceClient } from "../binance/client.ts";
import type {
  BinanceOrderBook,
  BinanceBookTicker,
  BinanceTicker24hr,
  BinanceAvgPrice,
} from "../binance/types.ts";
import {
  withFallback,
  withFallbackSimple,
  type FallbackOptions,
  type ResilientResult,
} from "./fallback.ts";

// ============================================================================
// Default Configuration
// ============================================================================

/**
 * Default options for price fetching (short TTL since prices change frequently)
 */
const PRICE_DEFAULTS: FallbackOptions<number> = {
  cacheTTL: 30000, // 30 seconds
  maxRetries: 2,
  retryDelay: 500,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeout: 30000,
  useStaleOnError: true,
};

/**
 * Default options for order book (moderate TTL)
 */
const ORDER_BOOK_DEFAULTS: FallbackOptions<BinanceOrderBook> = {
  cacheTTL: 10000, // 10 seconds - order books change rapidly
  maxRetries: 2,
  retryDelay: 500,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeout: 30000,
  useStaleOnError: true,
};

/**
 * Default options for ticker data (longer TTL)
 */
const TICKER_DEFAULTS: FallbackOptions<BinanceTicker24hr[]> = {
  cacheTTL: 60000, // 1 minute
  maxRetries: 3,
  retryDelay: 1000,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeout: 60000,
  useStaleOnError: true,
};

/**
 * Default options for spread data
 */
const SPREAD_DEFAULTS: FallbackOptions<SpreadData> = {
  cacheTTL: 15000, // 15 seconds
  maxRetries: 2,
  retryDelay: 500,
  circuitBreakerThreshold: 5,
  circuitBreakerTimeout: 30000,
  useStaleOnError: true,
};

// ============================================================================
// Types
// ============================================================================

export interface SpreadData {
  spread: number;
  spreadPercent: number;
  bidPrice: number;
  askPrice: number;
}

// ============================================================================
// Price Fallbacks
// ============================================================================

/**
 * Get price with fallback support
 *
 * Uses:
 * - Retry with backoff (2 retries, 500ms base delay)
 * - Circuit breaker (trips after 5 failures)
 * - Stale cache fallback (30 second TTL)
 */
export function resilientGetPrice(
  binance: BinanceClient,
  symbol: string,
  options: Partial<FallbackOptions<number>> = {}
): Promise<ResilientResult<number>> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `price:${normalizedSymbol}`;

  return withFallback(
    () => binance.getPrice(normalizedSymbol),
    cacheKey,
    { ...PRICE_DEFAULTS, ...options }
  );
}

/**
 * Simple price getter with fallback (returns just the price)
 */
export function getPrice(
  binance: BinanceClient,
  symbol: string,
  options: Partial<FallbackOptions<number>> = {}
): Promise<number> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `price:${normalizedSymbol}`;

  return withFallbackSimple(
    () => binance.getPrice(normalizedSymbol),
    cacheKey,
    { ...PRICE_DEFAULTS, ...options }
  );
}

/**
 * Get average price with fallback support
 */
export function resilientGetAvgPrice(
  binance: BinanceClient,
  symbol: string,
  options: Partial<FallbackOptions<BinanceAvgPrice>> = {}
): Promise<ResilientResult<BinanceAvgPrice>> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `avgPrice:${normalizedSymbol}`;

  return withFallback(
    () => binance.getAvgPrice(normalizedSymbol),
    cacheKey,
    {
      cacheTTL: 60000,
      maxRetries: 2,
      retryDelay: 500,
      useStaleOnError: true,
      ...options,
    }
  );
}

// ============================================================================
// Order Book Fallbacks
// ============================================================================

/**
 * Get order book with fallback support
 *
 * Uses:
 * - Retry with backoff (2 retries)
 * - Circuit breaker protection
 * - Stale cache fallback (10 second TTL)
 */
export function resilientGetOrderBook(
  binance: BinanceClient,
  symbol: string,
  limit: number = 100,
  options: Partial<FallbackOptions<BinanceOrderBook>> = {}
): Promise<ResilientResult<BinanceOrderBook>> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `orderbook:${normalizedSymbol}:${limit}`;

  return withFallback(
    () => binance.getOrderBook(normalizedSymbol, limit),
    cacheKey,
    { ...ORDER_BOOK_DEFAULTS, ...options }
  );
}

/**
 * Simple order book getter with fallback
 */
export function getOrderBook(
  binance: BinanceClient,
  symbol: string,
  limit: number = 100,
  options: Partial<FallbackOptions<BinanceOrderBook>> = {}
): Promise<BinanceOrderBook> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `orderbook:${normalizedSymbol}:${limit}`;

  return withFallbackSimple(
    () => binance.getOrderBook(normalizedSymbol, limit),
    cacheKey,
    { ...ORDER_BOOK_DEFAULTS, ...options }
  );
}

/**
 * Get book ticker (best bid/ask) with fallback
 */
export function resilientGetBookTicker(
  binance: BinanceClient,
  symbol: string,
  options: Partial<FallbackOptions<BinanceBookTicker>> = {}
): Promise<ResilientResult<BinanceBookTicker>> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `bookTicker:${normalizedSymbol}`;

  return withFallback(
    async () => {
      const result = await binance.getBookTicker(normalizedSymbol);
      return result as BinanceBookTicker;
    },
    cacheKey,
    {
      cacheTTL: 10000,
      maxRetries: 2,
      retryDelay: 300,
      useStaleOnError: true,
      ...options,
    }
  );
}

// ============================================================================
// Spread Fallbacks
// ============================================================================

/**
 * Get spread with fallback support
 */
export function resilientGetSpread(
  binance: BinanceClient,
  symbol: string,
  options: Partial<FallbackOptions<SpreadData>> = {}
): Promise<ResilientResult<SpreadData>> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `spread:${normalizedSymbol}`;

  return withFallback(
    () => binance.getSpread(normalizedSymbol),
    cacheKey,
    { ...SPREAD_DEFAULTS, ...options }
  );
}

/**
 * Simple spread getter with fallback
 */
export function getSpread(
  binance: BinanceClient,
  symbol: string,
  options: Partial<FallbackOptions<SpreadData>> = {}
): Promise<SpreadData> {
  const normalizedSymbol = normalizeSymbol(symbol);
  const cacheKey = `spread:${normalizedSymbol}`;

  return withFallbackSimple(
    () => binance.getSpread(normalizedSymbol),
    cacheKey,
    { ...SPREAD_DEFAULTS, ...options }
  );
}

// ============================================================================
// Ticker Fallbacks
// ============================================================================

/**
 * Get 24hr tickers with fallback support
 */
export function resilientGet24hrTickers(
  binance: BinanceClient,
  options: Partial<FallbackOptions<BinanceTicker24hr[]>> = {}
): Promise<ResilientResult<BinanceTicker24hr[]>> {
  const cacheKey = "tickers:24hr";

  return withFallback(
    () => binance.get24hrTickers(),
    cacheKey,
    { ...TICKER_DEFAULTS, ...options }
  );
}

/**
 * Simple 24hr tickers getter with fallback
 */
export function get24hrTickers(
  binance: BinanceClient,
  options: Partial<FallbackOptions<BinanceTicker24hr[]>> = {}
): Promise<BinanceTicker24hr[]> {
  const cacheKey = "tickers:24hr";

  return withFallbackSimple(
    () => binance.get24hrTickers(),
    cacheKey,
    { ...TICKER_DEFAULTS, ...options }
  );
}

/**
 * Get top symbols by volume with fallback
 */
export function resilientGetTopSymbols(
  binance: BinanceClient,
  n: number,
  options: Partial<FallbackOptions<string[]>> = {}
): Promise<ResilientResult<string[]>> {
  const cacheKey = `topSymbols:${n}`;

  return withFallback(
    () => binance.getTopSymbols(n),
    cacheKey,
    {
      cacheTTL: 300000, // 5 minutes - top symbols don't change often
      maxRetries: 3,
      retryDelay: 1000,
      useStaleOnError: true,
      ...options,
    }
  );
}

/**
 * Simple top symbols getter with fallback
 */
export function getTopSymbols(
  binance: BinanceClient,
  n: number,
  options: Partial<FallbackOptions<string[]>> = {}
): Promise<string[]> {
  const cacheKey = `topSymbols:${n}`;

  return withFallbackSimple(
    () => binance.getTopSymbols(n),
    cacheKey,
    {
      cacheTTL: 300000,
      maxRetries: 3,
      retryDelay: 1000,
      useStaleOnError: true,
      ...options,
    }
  );
}

// ============================================================================
// Batch Operations with Fallback
// ============================================================================

/**
 * Get multiple prices with fallback support
 * Uses parallel fetching with individual fallbacks
 */
export async function resilientGetPrices(
  binance: BinanceClient,
  symbols: string[],
  options: Partial<FallbackOptions<number>> = {}
): Promise<Map<string, ResilientResult<number>>> {
  const results = new Map<string, ResilientResult<number>>();

  const promises = symbols.map(async (symbol) => {
    try {
      const result = await resilientGetPrice(binance, symbol, options);
      results.set(normalizeSymbol(symbol), result);
    } catch {
      // Individual failures don't fail the batch
    }
  });

  await Promise.all(promises);
  return results;
}

/**
 * Simple batch price getter
 */
export async function getPrices(
  binance: BinanceClient,
  symbols: string[]
): Promise<Map<string, number>> {
  const results = new Map<string, number>();

  const promises = symbols.map(async (symbol) => {
    try {
      const price = await getPrice(binance, symbol);
      results.set(normalizeSymbol(symbol), price);
    } catch {
      // Individual failures don't fail the batch
    }
  });

  await Promise.all(promises);
  return results;
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Normalize symbol to uppercase with USDT suffix if needed
 */
function normalizeSymbol(symbol: string): string {
  const upper = symbol.toUpperCase();
  return upper.endsWith("USDT") ? upper : `${upper}USDT`;
}

/**
 * Create a resilient Binance API wrapper
 * Returns an object with all resilient methods bound to a client
 */
export function createResilientBinanceApi(binance: BinanceClient) {
  return {
    getPrice: (symbol: string, options?: Partial<FallbackOptions<number>>) =>
      getPrice(binance, symbol, options),
    resilientGetPrice: (symbol: string, options?: Partial<FallbackOptions<number>>) =>
      resilientGetPrice(binance, symbol, options),

    getOrderBook: (symbol: string, limit?: number, options?: Partial<FallbackOptions<BinanceOrderBook>>) =>
      getOrderBook(binance, symbol, limit, options),
    resilientGetOrderBook: (symbol: string, limit?: number, options?: Partial<FallbackOptions<BinanceOrderBook>>) =>
      resilientGetOrderBook(binance, symbol, limit, options),

    getSpread: (symbol: string, options?: Partial<FallbackOptions<SpreadData>>) =>
      getSpread(binance, symbol, options),
    resilientGetSpread: (symbol: string, options?: Partial<FallbackOptions<SpreadData>>) =>
      resilientGetSpread(binance, symbol, options),

    get24hrTickers: (options?: Partial<FallbackOptions<BinanceTicker24hr[]>>) =>
      get24hrTickers(binance, options),
    resilientGet24hrTickers: (options?: Partial<FallbackOptions<BinanceTicker24hr[]>>) =>
      resilientGet24hrTickers(binance, options),

    getTopSymbols: (n: number, options?: Partial<FallbackOptions<string[]>>) =>
      getTopSymbols(binance, n, options),
    resilientGetTopSymbols: (n: number, options?: Partial<FallbackOptions<string[]>>) =>
      resilientGetTopSymbols(binance, n, options),

    getPrices: (symbols: string[]) => getPrices(binance, symbols),
    resilientGetPrices: (symbols: string[], options?: Partial<FallbackOptions<number>>) =>
      resilientGetPrices(binance, symbols, options),
  };
}
