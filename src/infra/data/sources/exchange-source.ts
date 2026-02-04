/**
 * Exchange Data Source
 *
 * Implements the DataSource interface using an Exchange instance.
 * Fetches OHLC data directly from the exchange API.
 */

import type { Exchange } from "../../exchange/types.ts";
import type { Candle } from "../../../types/index.ts";
import type { DataSource, DataSourceCapabilities, OHLCParams } from "./types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("exchange-source");

// ============================================================================
// Constants
// ============================================================================

/** Timeframe to milliseconds mapping */
const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60 * 1000,
  "3m": 3 * 60 * 1000,
  "5m": 5 * 60 * 1000,
  "15m": 15 * 60 * 1000,
  "30m": 30 * 60 * 1000,
  "1h": 60 * 60 * 1000,
  "2h": 2 * 60 * 60 * 1000,
  "4h": 4 * 60 * 60 * 1000,
  "6h": 6 * 60 * 60 * 1000,
  "8h": 8 * 60 * 60 * 1000,
  "12h": 12 * 60 * 60 * 1000,
  "1d": 24 * 60 * 60 * 1000,
  "3d": 3 * 24 * 60 * 60 * 1000,
  "1w": 7 * 24 * 60 * 60 * 1000,
  "1M": 30 * 24 * 60 * 60 * 1000,
};

/** Maximum candles per API request (Binance default) */
const MAX_CANDLES_PER_REQUEST = 1000;

/** Default supported timeframes for exchanges */
const DEFAULT_TIMEFRAMES = [
  "1m",
  "3m",
  "5m",
  "15m",
  "30m",
  "1h",
  "2h",
  "4h",
  "6h",
  "8h",
  "12h",
  "1d",
  "3d",
  "1w",
  "1M",
];

// ============================================================================
// ExchangeDataSource Class
// ============================================================================

/**
 * ExchangeDataSource fetches OHLC data from an Exchange instance.
 *
 * This is typically a free data source that requires API credentials.
 * It has a default priority of 10 (lower priority than premium sources).
 *
 * @example
 * ```typescript
 * import { BinanceAdapter } from "../../exchange";
 *
 * const exchange = new BinanceAdapter(apiKey, apiSecret);
 * const source = new ExchangeDataSource(exchange);
 *
 * const candles = await source.fetchOHLC({
 *   symbol: "BTCUSDT",
 *   timeframe: "1h",
 *   startTime: Date.now() - 86400000,
 *   endTime: Date.now(),
 * });
 * ```
 */
export class ExchangeDataSource implements DataSource {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly requiresAuth: boolean;

  private exchange: Exchange;
  private capabilities: DataSourceCapabilities;

  /**
   * Create a new ExchangeDataSource.
   *
   * @param exchange - Exchange instance to use for data fetching
   * @param options - Optional configuration
   */
  constructor(
    exchange: Exchange,
    options: {
      /** Override the default priority (default: 10) */
      priority?: number;
      /** Override supported timeframes */
      supportedTimeframes?: string[];
      /** Maximum historical days available (default: 365) */
      maxHistoricalDays?: number;
    } = {}
  ) {
    this.exchange = exchange;
    this.id = `exchange-${exchange.exchangeId}`;
    this.name = `${exchange.displayName} Exchange`;
    this.priority = options.priority ?? 10;
    this.requiresAuth = false; // Public market data doesn't require auth

    this.capabilities = {
      supportedTimeframes: options.supportedTimeframes ?? DEFAULT_TIMEFRAMES,
      maxHistoricalDays: options.maxHistoricalDays ?? 365,
      realtime: true,
      exchanges: [exchange.exchangeId],
    };
  }

  /**
   * Check if the exchange is available.
   */
  async isAvailable(): Promise<boolean> {
    try {
      // Test connection to the exchange
      const connected = await this.exchange.testConnection();

      // Also check if we're being rate limited
      if (connected && this.exchange.shouldThrottle()) {
        logger.warn("Exchange is throttling requests", {
          exchangeId: this.exchange.exchangeId,
        });
        // Still available, but will be slower
      }

      return connected;
    } catch (error) {
      logger.error(
        "Exchange availability check failed",
        error instanceof Error ? error : new Error(String(error))
      );
      return false;
    }
  }

  /**
   * Get the capabilities of this data source.
   */
  getCapabilities(): DataSourceCapabilities {
    return this.capabilities;
  }

  /**
   * Fetch OHLC data from the exchange.
   *
   * Handles pagination for large date ranges automatically.
   */
  async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
    const { symbol, timeframe, startTime, endTime } = params;
    const upperSymbol = symbol.toUpperCase();
    const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;

    // Validate timeframe
    if (!this.capabilities.supportedTimeframes.includes(timeframe)) {
      throw new Error(
        `Timeframe '${timeframe}' not supported. Supported: ${this.capabilities.supportedTimeframes.join(", ")}`
      );
    }

    logger.debug("Fetching OHLC from exchange", {
      exchangeId: this.exchange.exchangeId,
      symbol: upperSymbol,
      timeframe,
      startTime: new Date(startTime).toISOString(),
      endTime: new Date(endTime).toISOString(),
    });

    const allCandles: Candle[] = [];
    let currentStart = startTime;

    // Paginate through the date range
    while (currentStart < endTime) {
      // Calculate how many candles we need for this batch
      const remainingCandles = Math.ceil((endTime - currentStart) / intervalMs);
      const limit = Math.min(remainingCandles, MAX_CANDLES_PER_REQUEST);

      // Fetch batch from exchange
      const candles = await this.fetchBatch(upperSymbol, timeframe, currentStart, endTime, limit);

      if (candles.length === 0) {
        break;
      }

      // Filter candles to only include those in our range
      const filteredCandles = candles.filter(
        (c) => c.openTime >= currentStart && c.openTime <= endTime
      );
      allCandles.push(...filteredCandles);

      // Move to next batch
      const lastCandle = candles[candles.length - 1]!;
      currentStart = lastCandle.openTime + intervalMs;

      // If we got fewer than requested, we've reached the end
      if (candles.length < limit) {
        break;
      }

      // Small delay to avoid rate limiting
      await this.delay(100);
    }

    // Sort by timestamp and deduplicate
    const uniqueCandles = this.deduplicateCandles(allCandles);

    logger.debug("Fetched OHLC from exchange", {
      exchangeId: this.exchange.exchangeId,
      symbol: upperSymbol,
      timeframe,
      count: String(uniqueCandles.length),
    });

    return uniqueCandles;
  }

  /**
   * Fetch a single batch of candles using raw API call.
   */
  private async fetchBatch(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit: number
  ): Promise<Candle[]> {
    // For Binance, we need to use the klines endpoint with startTime/endTime
    // The Exchange.getCandles method only supports limit parameter
    // So we'll make a direct API call
    const exchangeId = this.exchange.exchangeId;

    if (exchangeId === "binance") {
      return this.fetchBinanceKlines(symbol, interval, startTime, endTime, limit);
    }

    // For other exchanges, fall back to using getCandles
    // This may not respect startTime exactly, but it's a reasonable fallback
    const candles = await this.exchange.getCandles(symbol, interval, limit);

    // Filter to only candles within our time range
    return candles.filter((c) => c.openTime >= startTime && c.openTime <= endTime);
  }

  /**
   * Fetch klines directly from Binance API with time range support.
   */
  private async fetchBinanceKlines(
    symbol: string,
    interval: string,
    startTime: number,
    endTime: number,
    limit: number
  ): Promise<Candle[]> {
    const url = new URL("https://api.binance.com/api/v3/klines");
    url.searchParams.set("symbol", symbol.toUpperCase());
    url.searchParams.set("interval", interval);
    url.searchParams.set("startTime", startTime.toString());
    url.searchParams.set("endTime", endTime.toString());
    url.searchParams.set("limit", Math.min(limit, MAX_CANDLES_PER_REQUEST).toString());

    const response = await fetch(url.toString());

    if (!response.ok) {
      const error = (await response.json()) as { msg?: string };
      throw new Error(`Binance API error: ${error.msg || response.statusText}`);
    }

    const klines = (await response.json()) as Array<
      [
        number, // Open time
        string, // Open
        string, // High
        string, // Low
        string, // Close
        string, // Volume
        number, // Close time
        string, // Quote asset volume
        number, // Number of trades
        string, // Taker buy base asset volume
        string, // Taker buy quote asset volume
        string // Ignore
      ]
    >;

    return klines.map((kline) => ({
      openTime: kline[0],
      open: parseFloat(kline[1]),
      high: parseFloat(kline[2]),
      low: parseFloat(kline[3]),
      close: parseFloat(kline[4]),
      volume: parseFloat(kline[5]),
      closeTime: kline[6],
    }));
  }

  /**
   * Deduplicate candles by timestamp and sort.
   */
  private deduplicateCandles(candles: Candle[]): Candle[] {
    const uniqueMap = new Map<number, Candle>();

    for (const candle of candles) {
      // Keep the later fetched candle if duplicate (it's likely more accurate)
      uniqueMap.set(candle.openTime, candle);
    }

    return Array.from(uniqueMap.values()).sort((a, b) => a.openTime - b.openTime);
  }

  /**
   * Delay helper for rate limiting.
   */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get the underlying exchange instance.
   */
  getExchange(): Exchange {
    return this.exchange;
  }
}
