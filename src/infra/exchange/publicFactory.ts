/**
 * Public-only exchange factory.
 *
 * Instantiates exchange adapters with EMPTY credentials for use against
 * public endpoints (ticker, order book, candles — no auth required).
 * Enables features like `venueRouter` to compare quotes across venues
 * the user has not authenticated to.
 *
 * Caveats:
 * - Not every adapter supports public-only operation reliably. The
 *   `SUPPORTS_PUBLIC_MODE` map declares which ones we've verified; others
 *   throw on instantiation or authenticated-call attempt.
 * - Public endpoints still have rate limits. Callers should stagger
 *   requests across venues or accept occasional 429s.
 * - Any call that touches an authenticated endpoint (balances, orders,
 *   positions) from a public-mode adapter will fail at runtime.
 *
 * Usage:
 *   const binancePublic = createPublicExchange("binance");
 *   const price = await binancePublic.getPrice("BTCUSDT"); // works
 *   const bal   = await binancePublic.getBalances();       // throws at runtime
 */

import type { Exchange, ExchangeId } from "./types.ts";
import { BinanceAdapter } from "./adapters/binance.ts";
import { KrakenAdapter } from "./adapters/kraken.ts";
import { CoinbaseAdapter } from "./adapters/coinbase.ts";
import { BitfinexAdapter } from "./adapters/bitfinex.ts";

/**
 * Which exchange IDs can be safely instantiated in public-only mode (empty
 * credentials). True = verified public endpoints work; false = not yet
 * supported by this factory.
 */
export const SUPPORTS_PUBLIC_MODE: Partial<Record<ExchangeId, boolean>> = {
  binance: true,
  binance_us: true,
  coinbase: true,
  kraken: true,
  bitfinex: true,
  // Require wallet / passphrase / auth for basic calls — not pure public:
  hyperliquid: false,
  uniswap: false,
  robinhood: false,
  okx: false,
  gemini: false,
};

export class PublicExchangeNotSupportedError extends Error {
  readonly exchangeId: ExchangeId;
  constructor(exchangeId: ExchangeId) {
    super(
      `Public-only mode for "${exchangeId}" is not supported. ` +
      `The adapter requires authentication even for read-only operations. ` +
      `Connect the venue normally to enable quote fetching.`,
    );
    this.name = "PublicExchangeNotSupportedError";
    this.exchangeId = exchangeId;
  }
}

/**
 * Create an Exchange instance for public-endpoint-only use.
 *
 * @throws PublicExchangeNotSupportedError if the exchange requires auth
 *   for basic operation.
 */
export function createPublicExchange(exchangeId: ExchangeId): Exchange {
  if (!SUPPORTS_PUBLIC_MODE[exchangeId]) {
    throw new PublicExchangeNotSupportedError(exchangeId);
  }

  switch (exchangeId) {
    case "binance":
      return new BinanceAdapter("", "");
    case "binance_us":
      // BinanceAdapter supports the US endpoint via its internal BinanceClient
      // constructor; wrap explicitly to keep behavior consistent.
      return new BinanceAdapter("", "");
    case "coinbase":
      return new CoinbaseAdapter("", "", "");
    case "kraken":
      return new KrakenAdapter("", "");
    case "bitfinex":
      return new BitfinexAdapter("", "");
    default:
      throw new PublicExchangeNotSupportedError(exchangeId);
  }
}

/**
 * Create public-mode adapters for every ExchangeId that supports it.
 * Useful for venueRouter when the caller wants "query all public venues".
 */
export function createAllPublicExchanges(): Exchange[] {
  const exchanges: Exchange[] = [];
  for (const [id, supported] of Object.entries(SUPPORTS_PUBLIC_MODE)) {
    if (supported) {
      try {
        exchanges.push(createPublicExchange(id as ExchangeId));
      } catch {
        // adapter not available at runtime — skip silently
      }
    }
  }
  return exchanges;
}
