/**
 * Data Sources Module
 *
 * Provides a unified interface for fetching historical OHLC data from multiple sources
 * with automatic caching and fallback.
 *
 * @example
 * ```typescript
 * import {
 *   DataSourceManager,
 *   ExchangeDataSource,
 *   getDataSourceManager,
 * } from "./";
 * import { ExchangeFactory } from "../../exchange";
 *
 * // Setup
 * const manager = getDataSourceManager();
 * const exchange = ExchangeFactory.create("binance", { apiKey, apiSecret });
 * manager.register(new ExchangeDataSource(exchange));
 *
 * // Fetch data
 * const candles = await manager.fetchOHLC({
 *   symbol: "BTCUSDT",
 *   timeframe: "1h",
 *   startTime: Date.now() - 86400000,
 *   endTime: Date.now(),
 * });
 * ```
 */

// Core types
export type {
  OHLCParams,
  DataSourceCapabilities,
  DataSource,
  DataFetchResult,
  DataCoverage,
} from "./types.ts";

// Cache
export { HistoricalDataCache } from "./cache.ts";

// Data sources
export { ExchangeDataSource } from "./exchange-source.ts";
export { BrokerDataSource } from "./broker-source.ts";

// Manager
export {
  DataSourceManager,
  getDataSourceManager,
  resetDataSourceManager,
} from "./manager.ts";
