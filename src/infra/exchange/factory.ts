/**
 * Exchange Factory
 * Creates and caches exchange adapter instances
 */

import type { Exchange, ExchangeId, ExchangeCredentials } from "./types.ts";
import { BinanceAdapter } from "./adapters/binance.ts";
import { BinanceUSAdapter } from "./adapters/binance-us.ts";
import { CoinbaseAdapter } from "./adapters/coinbase.ts";
import { KrakenAdapter } from "./adapters/kraken.ts";
import { BitfinexAdapter } from "./adapters/bitfinex.ts";
import { HyperliquidAdapter } from "./adapters/hyperliquid.ts";
import { UniswapAdapter } from "./adapters/uniswap.ts";
import { RobinhoodAdapter } from "./adapters/robinhood.ts";

/**
 * All supported exchange IDs with native adapters
 */
const SUPPORTED_EXCHANGES: ExchangeId[] = [
  "binance",
  "binance_us",
  "coinbase",
  "kraken",
  "bitfinex",
  "hyperliquid",
  "uniswap",
  "robinhood",
];

/**
 * Cache key generator for exchange instances
 */
function getCacheKey(exchangeId: ExchangeId, credentials: ExchangeCredentials): string {
  // Use first 8 characters of key as identifier to avoid storing full key
  // For wallet-based exchanges, use wallet key; for others, use API key
  const key = (exchangeId === "hyperliquid" || exchangeId === "uniswap")
    ? credentials.walletPrivateKey || credentials.apiKey
    : credentials.apiKey;
  const keyPrefix = key.substring(0, 8);
  return `${exchangeId}:${keyPrefix}`;
}

/**
 * ExchangeFactory - Creates and manages exchange adapter instances
 *
 * Features:
 * - Singleton pattern for exchange instances (cached by exchange + credentials)
 * - Native adapters for all supported exchanges (Binance, Coinbase, Kraken, Bitfinex, Hyperliquid, Robinhood)
 *
 * @example
 * ```typescript
 * // Create a Binance exchange
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
 * // Create a Kraken exchange
 * const kraken = ExchangeFactory.create('kraken', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret'
 * });
 *
 * // Create a Bitfinex exchange
 * const bitfinex = ExchangeFactory.create('bitfinex', {
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

    switch (exchangeId) {
      case "binance":
        exchange = new BinanceAdapter(credentials.apiKey, credentials.apiSecret);
        break;
      case "binance_us":
        exchange = new BinanceUSAdapter(credentials.apiKey, credentials.apiSecret);
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
      case "bitfinex":
        exchange = new BitfinexAdapter(credentials.apiKey, credentials.apiSecret);
        break;
      case "hyperliquid":
        if (!credentials.walletPrivateKey) {
          throw new Error("Hyperliquid requires a wallet private key for authentication");
        }
        exchange = new HyperliquidAdapter(credentials.walletPrivateKey);
        break;
      case "uniswap":
        if (!credentials.apiKey) {
          throw new Error("Uniswap requires an API key from developers.uniswap.org");
        }
        exchange = new UniswapAdapter(
          credentials.apiKey,
          credentials.walletPrivateKey || credentials.apiSecret, // wallet address
          1, // Default to Ethereum mainnet
          process.env.THEGRAPH_API_KEY, // optional — enables subgraph market data
        );
        break;
      case "robinhood":
        exchange = new RobinhoodAdapter(credentials.apiKey, credentials.apiSecret);
        break;
      default:
        throw new Error(`No adapter available for exchange: ${exchangeId}`);
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
   * All supported exchanges now use native adapters
   *
   * @param exchangeId - Exchange ID to check
   * @returns true if the exchange is supported (all have native adapters)
   */
  static hasNativeAdapter(exchangeId: ExchangeId): boolean {
    return SUPPORTED_EXCHANGES.includes(exchangeId);
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
