/**
 * Data Source Abstraction Layer - Core Types
 *
 * Defines interfaces for fetching historical OHLC data from multiple sources.
 * Supports fallback between sources based on priority and availability.
 */

import type { Candle } from "../../../types/index.ts";

// ============================================================================
// OHLC Parameters
// ============================================================================

/**
 * Parameters for fetching OHLC (candlestick) data
 */
export interface OHLCParams {
  /** Trading pair symbol (e.g., "BTCUSDT") */
  symbol: string;
  /** Candle timeframe (e.g., "1m", "5m", "1h", "4h", "1d") */
  timeframe: string;
  /** Start time in milliseconds (inclusive) */
  startTime: number;
  /** End time in milliseconds (inclusive) */
  endTime: number;
  /** Optional exchange filter for multi-exchange data */
  exchange?: string;
}

// ============================================================================
// Data Source Capabilities
// ============================================================================

/**
 * Describes what a data source can provide
 */
export interface DataSourceCapabilities {
  /** List of supported timeframes (e.g., ["1m", "5m", "1h", "1d"]) */
  supportedTimeframes: string[];
  /** Maximum number of historical days available */
  maxHistoricalDays: number;
  /** Whether this source supports real-time/live data */
  realtime: boolean;
  /** List of supported exchanges (if applicable) */
  exchanges?: string[];
  /** Supported Gordon market families */
  markets?: Array<"crypto" | "stocks">;
  /** Whether latest quote lookups are available */
  supportsQuotes?: boolean;
  /** Whether best bid/ask data is available */
  supportsBidAsk?: boolean;
  /** Whether order book depth is available */
  supportsOrderBook?: boolean;
  /** Whether trading-session calendars are available */
  supportsSessionCalendar?: boolean;
  /** Whether corporate actions are available */
  supportsCorporateActions?: boolean;
  /** Whether extended-hours data is available */
  supportsExtendedHours?: boolean;
  /** Whether funding-rate style derivatives data is available */
  supportsFundingRates?: boolean;
  /** Whether open-interest data is available */
  supportsOpenInterest?: boolean;
  /** Whether liquidation data is available */
  supportsLiquidations?: boolean;
}

// ============================================================================
// Data Source Interface
// ============================================================================

/**
 * Abstract interface for historical data providers.
 *
 * Data sources are prioritized by the `priority` property (lower = higher priority).
 * The DataSourceManager tries sources in order until one succeeds.
 *
 * @example
 * ```typescript
 * class MyDataSource implements DataSource {
 *   readonly id = "my-source";
 *   readonly name = "My Data Source";
 *   readonly priority = 5;
 *   readonly requiresAuth = true;
 *
 *   async isAvailable(): Promise<boolean> {
 *     // Check if API key is configured
 *     return !!process.env.MY_API_KEY;
 *   }
 *
 *   getCapabilities(): DataSourceCapabilities {
 *     return {
 *       supportedTimeframes: ["1m", "5m", "15m", "1h", "4h", "1d"],
 *       maxHistoricalDays: 365,
 *       realtime: true,
 *     };
 *   }
 *
 *   async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
 *     // Fetch data from API
 *   }
 * }
 * ```
 */
export interface DataSource {
  /** Unique identifier for this data source */
  readonly id: string;

  /** Human-readable name for display */
  readonly name: string;

  /**
   * Priority for source selection (lower = higher priority).
   * Suggested ranges:
   * - 1-9: Premium/paid sources with best data quality
   * - 10-19: Free sources with good quality (e.g., exchange APIs)
   * - 20+: Backup/fallback sources
   */
  readonly priority: number;

  /** Whether this source requires authentication to use */
  readonly requiresAuth: boolean;

  /**
   * Check if this data source is currently available.
   * May check for API keys, network connectivity, rate limits, etc.
   */
  isAvailable(): Promise<boolean>;

  /**
   * Get the capabilities of this data source.
   * Used by the manager to determine if a source can handle a request.
   */
  getCapabilities(): DataSourceCapabilities;

  /**
   * Fetch OHLC candle data for the specified parameters.
   * Should throw an error if the fetch fails.
   *
   * @param params - OHLC fetch parameters
   * @returns Array of candles sorted by timestamp (oldest first)
   */
  fetchOHLC(params: OHLCParams): Promise<Candle[]>;
}

// ============================================================================
// Result Types
// ============================================================================

/**
 * Result of a data fetch operation, including metadata
 */
export interface DataFetchResult {
  /** The fetched candles */
  candles: Candle[];
  /** ID of the source that provided the data */
  sourceId: string;
  /** Whether data came from cache */
  fromCache: boolean;
  /** Time taken to fetch in milliseconds */
  fetchTimeMs: number;
}

/**
 * Information about data coverage in cache
 */
export interface DataCoverage {
  /** Earliest timestamp available */
  start: number;
  /** Latest timestamp available */
  end: number;
}
