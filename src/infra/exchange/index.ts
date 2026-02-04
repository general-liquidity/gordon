/**
 * Exchange Abstraction Layer
 *
 * This module provides a unified interface for interacting with multiple
 * cryptocurrency exchanges. The Exchange interface abstracts away exchange-specific
 * details, allowing the rest of the application to work with any supported exchange.
 *
 * Supported exchanges:
 * - Binance (native adapter with full feature support)
 * - Coinbase (via CCXT)
 * - Kraken (via CCXT)
 * - Bybit (via CCXT)
 * - OKX (via CCXT)
 *
 * @example
 * ```typescript
 * import { ExchangeFactory, type Exchange } from './infra/exchange';
 *
 * // Create exchange instance using factory (recommended)
 * const exchange: Exchange = ExchangeFactory.create('binance', {
 *   apiKey: 'your-api-key',
 *   apiSecret: 'your-api-secret'
 * });
 *
 * // Or create a different exchange
 * const kraken: Exchange = ExchangeFactory.create('kraken', credentials);
 *
 * // Use through abstract interface
 * const price = await exchange.getPrice('BTCUSDT');
 * const candles = await exchange.getCandles('BTCUSDT', '1h', 100);
 * ```
 */

// Core types
export * from "./types.ts";

// Factory (recommended entry point)
export { ExchangeFactory } from "./factory.ts";

// Adapters
export { BinanceAdapter } from "./adapters/binance.ts";
export { CCXTAdapter } from "./adapters/ccxt.ts";

// Type aliases for convenience
export type {
  Exchange,
  ExchangeId,
  ExchangeCredentials,
  ExchangeInfo,
  AccountInfo,
  AccountDetails,
  Balance,
  Order,
  OrderParams,
  OrderSide,
  OrderType,
  OrderStatus,
  Trade,
  Ticker24hr,
  OrderBook,
  BookTicker,
  SpreadInfo,
  RateLimitStatus,
} from "./types.ts";
