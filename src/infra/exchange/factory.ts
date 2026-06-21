/**
 * Exchange Factory
 * Creates and caches exchange adapter instances
 */

import type { Exchange, ExchangeId, NativeExchangeId, ExchangeCredentials } from "./types.ts";
import { isCcxtExchangeId, extractCcxtSubId, normalizeExchangeId, ccxtIdToNativeVenue } from "./types.ts";
import { CcxtAdapter } from "./adapters/ccxt-adapter.ts";
import { loadOAuthExchangeCredentials, exchangeSupportsOAuth } from "./oauth-bridge.ts";
import { assertSandboxSupported } from "./sandboxSupport.ts";

/**
 * First-class venue ids — popular venues with curated env-var names and
 * sandbox metadata. Accepted as factory input aliases but normalized to
 * canonical `ccxt:<subId>`; every venue routes through CcxtAdapter.
 */
const SUPPORTED_EXCHANGES: NativeExchangeId[] = [
  "binance",
  "binance_us",
  "coinbase",
  "kraken",
  "bitfinex",
  "hyperliquid",
  "robinhood",
  "okx",
  "gemini",
];

/**
 * Cache key generator for exchange instances. Operates on the canonical
 * (`ccxt:*`) id so the same venue caches once regardless of input form.
 */
function getCacheKey(exchangeId: ExchangeId, credentials: ExchangeCredentials): string {
  // Use first 8 characters of key as identifier to avoid storing full key.
  // For wallet-based venues (hyperliquid), use the wallet key; else the API key.
  const key = ccxtIdToNativeVenue(exchangeId) === "hyperliquid"
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
   * - CCXT adapter for all supported exchanges
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
    // Every venue routes through the single CCXT adapter. Normalize the id to
    // its canonical `ccxt:<subId>` form first — bare first-class ids (e.g.
    // "binance" from older configs) become "ccxt:binance" — so there is one
    // canonical shape everywhere (cache, audit, exchangeId-keyed paths).
    const canonical = normalizeExchangeId(exchangeId);
    const subId = extractCcxtSubId(canonical);

    // Guard: refuse to construct a sandbox adapter for a first-class venue that
    // doesn't offer one (resolves the underlying venue behind ccxt:*). Long-tail
    // CCXT venues defer to CCXT's own detection at construct time.
    assertSandboxSupported(canonical, Boolean(credentials.sandbox));

    const cacheKey = getCacheKey(canonical, credentials);
    const cached = this.instanceCache.get(cacheKey);
    if (cached) return cached;

    // Per-venue auth requirements, still enforced before construction.
    if ((subId === "coinbase" || subId === "okx") && !credentials.passphrase) {
      throw new Error(`${subId} requires a passphrase in addition to API key and secret`);
    }
    if (subId === "hyperliquid" && !credentials.walletPrivateKey) {
      throw new Error("Hyperliquid requires a wallet private key for authentication");
    }

    const envMaxLeverage = Number(process.env.GORDON_RISK_MAX_LEVERAGE);
    const exchange = new CcxtAdapter(
      subId,
      {
        apiKey: credentials.apiKey,
        apiSecret: credentials.apiSecret,
        passphrase: credentials.passphrase,
        walletPrivateKey: credentials.walletPrivateKey,
        walletAddress: credentials.walletAddress,
      },
      credentials.sandbox,
      Number.isFinite(envMaxLeverage) && envMaxLeverage > 0
        ? { maxLeverage: envMaxLeverage }
        : undefined,
    );

    this.instanceCache.set(cacheKey, exchange);
    return exchange;
  }

  /**
   * Create an exchange adapter, preferring OAuth tokens from the oauth-store
   * over static API keys when the exchange supports OAuth 2.0.
   */
  static async createWithAuth(
    exchangeId: ExchangeId,
    fallbackCredentials: ExchangeCredentials,
    oauthClientId?: string,
  ): Promise<Exchange> {
    if (exchangeSupportsOAuth(exchangeId)) {
      const oauthCreds = await loadOAuthExchangeCredentials(exchangeId, {
        clientId: oauthClientId,
        sandbox: fallbackCredentials.sandbox,
      });
      if (oauthCreds?.accessToken) {
        return this.create(exchangeId, oauthCreds as ExchangeCredentials);
      }
    }
    return this.create(exchangeId, fallbackCredentials);
  }

  static exchangeSupportsOAuth(exchangeId: ExchangeId): boolean {
    return exchangeSupportsOAuth(exchangeId);
  }

  /**
   * Get list of supported exchanges
   *
   * @returns Array of supported exchange IDs
   */
  static getSupportedExchanges(): ExchangeId[] {
    return SUPPORTED_EXCHANGES.map((id) => normalizeExchangeId(id));
  }

  /**
   * Check if an exchange is supported
   *
   * @param exchangeId - Exchange ID to check
   * @returns true if the exchange is supported
   */
  static isSupported(exchangeId: string): exchangeId is ExchangeId {
    if (isCcxtExchangeId(exchangeId)) return true;
    return SUPPORTED_EXCHANGES.includes(exchangeId as NativeExchangeId);
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
