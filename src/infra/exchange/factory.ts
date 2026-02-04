/**
 * Exchange Factory
 * Creates and caches exchange adapter instances
 */

import type { Exchange, ExchangeId, ExchangeCredentials } from "./types.ts";
import { BinanceAdapter } from "./adapters/binance.ts";
import { CoinbaseAdapter } from "./adapters/coinbase.ts";
import { KrakenAdapter } from "./adapters/kraken.ts";
import { HyperliquidAdapter } from "./adapters/hyperliquid.ts";
import { CCXTAdapter } from "./adapters/ccxt.ts";

/**
 * Supported exchanges and their adapter type
 */
const NATIVE_ADAPTERS: Set<ExchangeId> = new Set([
  "binance",
  "coinbase",
  "kraken",
  "hyperliquid",
]);

/**
 * All supported exchange IDs
 */
const SUPPORTED_EXCHANGES: ExchangeId[] = [
  "binance",
  "coinbase",
  "kraken",
  "bybit",
  "okx",
  "hyperliquid",
];

/**
 * Cache key generator for exchange instances
 */
function getCacheKey(exchangeId: ExchangeId, credentials: ExchangeCredentials): string {
  // Use first 8 characters of key as identifier to avoid storing full key
  // For Hyperliquid, use wallet private key; for others, use API key
  const key = exchangeId === "hyperliquid"
    ? credentials.walletPrivateKey || ""
    : credentials.apiKey;
  const keyPrefix = key.substring(0, 8);
  return `${exchangeId}:${keyPrefix}`;
}

/**
 * ExchangeFactory - Creates and manages exchange adapter instances
 *
 * Features:
 * - Singleton pattern for exchange instances (cached by exchange + credentials)
 * - Native adapters for Binance, Coinbase, Kraken, Hyperliquid (exchange-specific APIs)
 * - CCXT adapter fallback for Bybit, OKX
 *
 * @example
 * ```typescript
 * // Create a Binance exchange (uses native adapter)
 * const binance = ExchangeFactory.create('binance', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret'
 * });
 *
 * // Create a Coinbase exchange (requires passphrase)
 * const coinbase = ExchangeFactory.create('coinbase', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret',
 *   passphrase: 'your-passphrase'
 * });
 *
 * // Create a Kraken exchange (uses native adapter)
 * const kraken = ExchangeFactory.create('kraken', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret'
 * });
 *
 * // Create a Hyperliquid exchange (wallet-based auth)
 * const hyperliquid = ExchangeFactory.create('hyperliquid', {
 *   apiKey: '',
 *   apiSecret: '',
 *   walletPrivateKey: 'your-wallet-private-key'
 * });
 *
 * // All implement the same Exchange interface
 * const price = await binance.getPrice('BTCUSDT');
 * ```
 */
export class ExchangeFactory {
  /**
   * Instance cache to avoid creating duplicate exchange connections
   * Key format: "exchangeId:apiKeyPrefix"
   */
  private static instanceCache: Map<string, Exchange> = new Map();

  /**
   * Create or retrieve an exchange adapter instance
   *
   * @param exchangeId - The exchange to connect to
   * @param credentials - API credentials for the exchange
   * @returns Exchange adapter instance
   * @throws Error if exchange is not supported
   */
  static create(exchangeId: ExchangeId, credentials: ExchangeCredentials): Exchange {
    // Validate exchange is supported
    if (!SUPPORTED_EXCHANGES.includes(exchangeId)) {
      throw new Error(
        `Unsupported exchange: ${exchangeId}. Supported exchanges: ${SUPPORTED_EXCHANGES.join(", ")}`
      );
    }

    // Check cache
    const cacheKey = getCacheKey(exchangeId, credentials);
    const cached = this.instanceCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Create appropriate adapter
    let exchange: Exchange;

    if (NATIVE_ADAPTERS.has(exchangeId)) {
      // Use native adapters for supported exchanges
      switch (exchangeId) {
        case "binance":
          exchange = new BinanceAdapter(credentials.apiKey, credentials.apiSecret);
          break;
        case "coinbase":
          if (!credentials.passphrase) {
            throw new Error("Coinbase requires a passphrase in addition to API key and secret");
          }
          exchange = new CoinbaseAdapter(
            credentials.apiKey,
            credentials.apiSecret,
            credentials.passphrase
          );
          break;
        case "kraken":
          exchange = new KrakenAdapter(credentials.apiKey, credentials.apiSecret);
          break;
        case "hyperliquid":
          if (!credentials.walletPrivateKey) {
            throw new Error("Hyperliquid requires a wallet private key for authentication");
          }
          exchange = new HyperliquidAdapter(credentials.walletPrivateKey);
          break;
        default:
          // Fallback to CCXT for any native adapter without specific handling
          exchange = new CCXTAdapter(exchangeId, credentials);
      }
    } else {
      // Use CCXT adapter for other exchanges
      exchange = new CCXTAdapter(exchangeId, credentials);
    }

    // Cache the instance
    this.instanceCache.set(cacheKey, exchange);

    return exchange;
  }

  /**
   * Get list of supported exchanges
   *
   * @returns Array of supported exchange IDs
   */
  static getSupportedExchanges(): ExchangeId[] {
    return [...SUPPORTED_EXCHANGES];
  }

  /**
   * Check if an exchange is supported
   *
   * @param exchangeId - Exchange ID to check
   * @returns true if the exchange is supported
   */
  static isSupported(exchangeId: string): exchangeId is ExchangeId {
    return SUPPORTED_EXCHANGES.includes(exchangeId as ExchangeId);
  }

  /**
   * Check if an exchange uses a native adapter
   *
   * @param exchangeId - Exchange ID to check
   * @returns true if the exchange uses a native adapter (not CCXT)
   */
  static hasNativeAdapter(exchangeId: ExchangeId): boolean {
    return NATIVE_ADAPTERS.has(exchangeId);
  }

  /**
   * Clear the instance cache
   * Useful for testing or when credentials change
   */
  static clearCache(): void {
    this.instanceCache.clear();
  }

  /**
   * Remove a specific instance from the cache
   *
   * @param exchangeId - The exchange ID
   * @param credentials - The credentials used to create the instance
   */
  static removeFromCache(exchangeId: ExchangeId, credentials: ExchangeCredentials): void {
    const cacheKey = getCacheKey(exchangeId, credentials);
    this.instanceCache.delete(cacheKey);
  }

  /**
   * Get the number of cached instances
   *
   * @returns Number of cached exchange instances
   */
  static getCacheSize(): number {
    return this.instanceCache.size;
  }
}
