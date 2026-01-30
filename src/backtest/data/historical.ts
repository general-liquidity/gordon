/**
 * Historical Data Fetcher with SQLite Caching
 *
 * Fetches OHLC data from Binance with intelligent caching.
 * Minimizes API calls by storing data locally with TTL-based invalidation.
 */

import { getDatabase } from "../../infra/storage/index.ts";
import type { BinanceClient } from "../../infra/binance/index.ts";
import type { OHLC } from "../types.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("historical-data");

// ============================================================================
// Constants
// ============================================================================

/** Binance API limit per klines request */
const BINANCE_KLINE_LIMIT = 1000;

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

/** TTL for cache invalidation based on timeframe (in milliseconds) */
const CACHE_TTL_MS: Record<string, number> = {
  "1m": 5 * 60 * 1000,       // 5 minutes
  "3m": 10 * 60 * 1000,      // 10 minutes
  "5m": 30 * 60 * 1000,      // 30 minutes
  "15m": 30 * 60 * 1000,     // 30 minutes
  "30m": 60 * 60 * 1000,     // 1 hour
  "1h": 60 * 60 * 1000,      // 1 hour
  "2h": 2 * 60 * 60 * 1000,  // 2 hours
  "4h": 4 * 60 * 60 * 1000,  // 4 hours
  "6h": 6 * 60 * 60 * 1000,  // 6 hours
  "8h": 8 * 60 * 60 * 1000,  // 8 hours
  "12h": 12 * 60 * 60 * 1000, // 12 hours
  "1d": 24 * 60 * 60 * 1000, // 24 hours
  "3d": 72 * 60 * 60 * 1000, // 72 hours
  "1w": 168 * 60 * 60 * 1000, // 1 week
  "1M": 720 * 60 * 60 * 1000, // ~30 days
};

// ============================================================================
// Database Schema
// ============================================================================

/**
 * Initialize the historical_ohlc table in the database.
 * Should be called during application startup.
 */
export function initHistoricalDataTable(): void {
  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS historical_ohlc (
      symbol TEXT NOT NULL,
      timeframe TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      open REAL NOT NULL,
      high REAL NOT NULL,
      low REAL NOT NULL,
      close REAL NOT NULL,
      volume REAL NOT NULL,
      fetched_at INTEGER NOT NULL,
      PRIMARY KEY (symbol, timeframe, timestamp)
    )
  `);

  // Create indexes for efficient queries
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_historical_ohlc_symbol_timeframe
    ON historical_ohlc(symbol, timeframe)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_historical_ohlc_timestamp
    ON historical_ohlc(timestamp)
  `);

  db.run(`
    CREATE INDEX IF NOT EXISTS idx_historical_ohlc_fetched_at
    ON historical_ohlc(fetched_at)
  `);

  logger.info("Historical OHLC table initialized");
}

// ============================================================================
// Cache Operations
// ============================================================================

/**
 * Get cached OHLC data for a symbol and timeframe within a time range.
 * Returns null if no cached data exists or if cache is stale.
 *
 * @param symbol - Trading pair (e.g., "BTCUSDT")
 * @param timeframe - Candle timeframe (e.g., "1h", "4h", "1d")
 * @param startTime - Start time in milliseconds (inclusive)
 * @param endTime - End time in milliseconds (inclusive)
 * @returns Cached OHLC data or null if not available/stale
 */
export function getCachedData(
  symbol: string,
  timeframe: string,
  startTime: number,
  endTime: number
): OHLC[] | null {
  const db = getDatabase();
  const now = Date.now();
  const ttl = CACHE_TTL_MS[timeframe] ?? CACHE_TTL_MS["1h"]!;
  const minFetchedAt = now - ttl;

  const query = db.prepare<
    { timestamp: number; open: number; high: number; low: number; close: number; volume: number },
    [string, string, number, number, number]
  >(`
    SELECT timestamp, open, high, low, close, volume
    FROM historical_ohlc
    WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ? AND fetched_at >= ?
    ORDER BY timestamp ASC
  `);

  const rows = query.all(symbol.toUpperCase(), timeframe, startTime, endTime, minFetchedAt);

  if (rows.length === 0) {
    return null;
  }

  // Check if we have complete data (no gaps)
  const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;
  const expectedCount = Math.floor((endTime - startTime) / intervalMs) + 1;

  // Allow some tolerance (90% coverage is acceptable)
  if (rows.length < expectedCount * 0.9) {
    logger.debug("Cache incomplete, need to fetch more data", {
      symbol,
      timeframe,
      cached: String(rows.length),
      expected: String(expectedCount),
    });
    return null;
  }

  return rows.map((row) => ({
    timestamp: row.timestamp,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
  }));
}

/**
 * Cache OHLC data in the database.
 * Uses INSERT OR REPLACE to update existing records.
 *
 * @param symbol - Trading pair (e.g., "BTCUSDT")
 * @param timeframe - Candle timeframe (e.g., "1h", "4h", "1d")
 * @param data - Array of OHLC data to cache
 */
export function cacheData(
  symbol: string,
  timeframe: string,
  data: OHLC[]
): void {
  if (data.length === 0) {
    return;
  }

  const db = getDatabase();
  const now = Date.now();
  const upperSymbol = symbol.toUpperCase();

  const insertStmt = db.prepare(`
    INSERT OR REPLACE INTO historical_ohlc (symbol, timeframe, timestamp, open, high, low, close, volume, fetched_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  // Use a transaction for better performance with bulk inserts
  const transaction = db.transaction(() => {
    for (const candle of data) {
      insertStmt.run(
        upperSymbol,
        timeframe,
        candle.timestamp,
        candle.open,
        candle.high,
        candle.low,
        candle.close,
        candle.volume,
        now
      );
    }
  });

  transaction();

  logger.debug("Cached OHLC data", {
    symbol: upperSymbol,
    timeframe,
    count: String(data.length),
  });
}

/**
 * Clean up stale cache entries.
 * Removes entries older than the maximum TTL.
 */
export function cleanupStaleCache(): void {
  const db = getDatabase();
  const maxTtl = Math.max(...Object.values(CACHE_TTL_MS));
  const cutoff = Date.now() - maxTtl * 2; // Keep data for 2x max TTL

  const result = db.run(`DELETE FROM historical_ohlc WHERE fetched_at < ?`, [cutoff]);

  if (result.changes > 0) {
    logger.info("Cleaned up stale cache entries", { deleted: String(result.changes) });
  }
}

// ============================================================================
// Binance Data Fetching
// ============================================================================

/**
 * Fetch klines from Binance API.
 * Handles pagination for large date ranges.
 *
 * @param binance - BinanceClient instance
 * @param symbol - Trading pair (e.g., "BTCUSDT")
 * @param timeframe - Candle timeframe (e.g., "1h", "4h", "1d")
 * @param startTime - Start time in milliseconds
 * @param endTime - End time in milliseconds
 * @returns Array of OHLC data
 */
async function fetchKlinesFromBinance(
  binance: BinanceClient,
  symbol: string,
  timeframe: string,
  startTime: number,
  endTime: number
): Promise<OHLC[]> {
  const allCandles: OHLC[] = [];
  let currentStart = startTime;
  const upperSymbol = symbol.toUpperCase();

  logger.debug("Fetching klines from Binance", {
    symbol: upperSymbol,
    timeframe,
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
  });

  while (currentStart < endTime) {
    // Fetch candles using the BinanceClient's getCandles method
    // We need to use the underlying klines API to get proper pagination
    const response = await fetchKlinesBatch(
      binance,
      upperSymbol,
      timeframe,
      currentStart,
      endTime
    );

    if (response.length === 0) {
      break;
    }

    allCandles.push(...response);

    // Move to next batch - use the last candle's timestamp + 1 interval
    const lastCandle = response[response.length - 1]!;
    const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;
    currentStart = lastCandle.timestamp + intervalMs;

    // If we got fewer than the limit, we've reached the end
    if (response.length < BINANCE_KLINE_LIMIT) {
      break;
    }

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  logger.debug("Fetched klines from Binance", {
    symbol: upperSymbol,
    timeframe,
    count: String(allCandles.length),
  });

  return allCandles;
}

/**
 * Fetch a single batch of klines from Binance.
 * Uses the public klines endpoint with startTime/endTime parameters.
 */
async function fetchKlinesBatch(
  binance: BinanceClient,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number
): Promise<OHLC[]> {
  // Use getCandles which internally calls the klines endpoint
  // We need to calculate how many candles to request
  const intervalMs = TIMEFRAME_MS[interval] ?? TIMEFRAME_MS["1h"]!;
  const candleCount = Math.min(
    Math.ceil((endTime - startTime) / intervalMs),
    BINANCE_KLINE_LIMIT
  );

  // Binance's getCandles method fetches the most recent candles
  // For historical data, we need to use the raw klines API with startTime
  const candles = await fetchRawKlines(binance, symbol, interval, startTime, endTime, candleCount);

  return candles;
}

/**
 * Fetch raw klines data from Binance with specific time range.
 * This is a workaround since BinanceClient.getCandles doesn't support startTime.
 */
async function fetchRawKlines(
  binance: BinanceClient,
  symbol: string,
  interval: string,
  startTime: number,
  endTime: number,
  limit: number
): Promise<OHLC[]> {
  // Access the internal API through the client
  // Since BinanceClient doesn't expose startTime/endTime params for getCandles,
  // we'll use a direct fetch approach via the client's internal methods

  // The BinanceClient class has a publicRequest method we can leverage
  // However, it's private. We'll use the getCandles method and work with what we have.
  //
  // For now, we use a different approach: fetch recent candles and filter
  // In production, you'd want to extend BinanceClient to support this

  const url = new URL("https://api.binance.com/api/v3/klines");
  url.searchParams.set("symbol", symbol.toUpperCase());
  url.searchParams.set("interval", interval);
  url.searchParams.set("startTime", startTime.toString());
  url.searchParams.set("endTime", endTime.toString());
  url.searchParams.set("limit", Math.min(limit, BINANCE_KLINE_LIMIT).toString());

  const response = await fetch(url.toString());

  if (!response.ok) {
    const error = await response.json() as { msg?: string };
    throw new Error(`Binance API error: ${error.msg || response.statusText}`);
  }

  const klines = await response.json() as Array<[
    number,  // Open time
    string,  // Open
    string,  // High
    string,  // Low
    string,  // Close
    string,  // Volume
    number,  // Close time
    string,  // Quote asset volume
    number,  // Number of trades
    string,  // Taker buy base asset volume
    string,  // Taker buy quote asset volume
    string   // Ignore
  ]>;

  return klines.map((kline) => ({
    timestamp: kline[0],
    open: parseFloat(kline[1]),
    high: parseFloat(kline[2]),
    low: parseFloat(kline[3]),
    close: parseFloat(kline[4]),
    volume: parseFloat(kline[5]),
  }));
}

// ============================================================================
// Main API
// ============================================================================

/**
 * Fetch historical OHLC data for a symbol.
 * Uses cache when available, fetches from Binance when needed.
 *
 * @param binance - BinanceClient instance
 * @param symbol - Trading pair (e.g., "BTCUSDT")
 * @param timeframe - Candle timeframe (e.g., "1h", "4h", "1d")
 * @param days - Number of days of historical data to fetch
 * @returns Array of OHLC data sorted by timestamp (oldest first)
 */
export async function fetchHistoricalData(
  binance: BinanceClient,
  symbol: string,
  timeframe: string,
  days: number
): Promise<OHLC[]> {
  const upperSymbol = symbol.toUpperCase();
  const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;
  const now = Date.now();

  // Align endTime to the current candle boundary
  const endTime = Math.floor(now / intervalMs) * intervalMs;
  const startTime = endTime - days * 24 * 60 * 60 * 1000;

  logger.info("Fetching historical data", {
    symbol: upperSymbol,
    timeframe,
    days: String(days),
    startTime: new Date(startTime).toISOString(),
    endTime: new Date(endTime).toISOString(),
  });

  // Try to get cached data first
  const cachedData = getCachedData(upperSymbol, timeframe, startTime, endTime);

  if (cachedData !== null) {
    logger.info("Using cached historical data", {
      symbol: upperSymbol,
      timeframe,
      count: String(cachedData.length),
    });
    return cachedData;
  }

  // Fetch missing data from Binance
  const freshData = await fetchKlinesFromBinance(
    binance,
    upperSymbol,
    timeframe,
    startTime,
    endTime
  );

  // Cache the fetched data
  if (freshData.length > 0) {
    cacheData(upperSymbol, timeframe, freshData);
  }

  return freshData;
}

/**
 * Fetch historical data with smart merging of cached and fresh data.
 * Only fetches missing ranges from Binance.
 *
 * @param binance - BinanceClient instance
 * @param symbol - Trading pair (e.g., "BTCUSDT")
 * @param timeframe - Candle timeframe (e.g., "1h", "4h", "1d")
 * @param startTime - Start time in milliseconds
 * @param endTime - End time in milliseconds
 * @returns Array of OHLC data sorted by timestamp (oldest first)
 */
export async function fetchHistoricalDataRange(
  binance: BinanceClient,
  symbol: string,
  timeframe: string,
  startTime: number,
  endTime: number
): Promise<OHLC[]> {
  const upperSymbol = symbol.toUpperCase();
  const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;

  // Get all cached data (including potentially stale)
  const db = getDatabase();
  const query = db.prepare<
    { timestamp: number; open: number; high: number; low: number; close: number; volume: number; fetched_at: number },
    [string, string, number, number]
  >(`
    SELECT timestamp, open, high, low, close, volume, fetched_at
    FROM historical_ohlc
    WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
    ORDER BY timestamp ASC
  `);

  const cachedRows = query.all(upperSymbol, timeframe, startTime, endTime);
  const now = Date.now();
  const ttl = CACHE_TTL_MS[timeframe] ?? CACHE_TTL_MS["1h"]!;

  // Build a map of cached timestamps and their freshness
  const cachedMap = new Map<number, { data: OHLC; isFresh: boolean }>();
  for (const row of cachedRows) {
    cachedMap.set(row.timestamp, {
      data: {
        timestamp: row.timestamp,
        open: row.open,
        high: row.high,
        low: row.low,
        close: row.close,
        volume: row.volume,
      },
      isFresh: row.fetched_at >= now - ttl,
    });
  }

  // Find missing or stale ranges
  const missingRanges: Array<{ start: number; end: number }> = [];
  let currentStart: number | null = null;

  for (let t = startTime; t <= endTime; t += intervalMs) {
    const cached = cachedMap.get(t);
    const needsFetch = !cached || !cached.isFresh;

    if (needsFetch) {
      if (currentStart === null) {
        currentStart = t;
      }
    } else if (currentStart !== null) {
      missingRanges.push({ start: currentStart, end: t - intervalMs });
      currentStart = null;
    }
  }

  // Handle trailing range
  if (currentStart !== null) {
    missingRanges.push({ start: currentStart, end: endTime });
  }

  // Fetch missing ranges
  for (const range of missingRanges) {
    const freshData = await fetchKlinesFromBinance(
      binance,
      upperSymbol,
      timeframe,
      range.start,
      range.end
    );

    // Cache and update map
    if (freshData.length > 0) {
      cacheData(upperSymbol, timeframe, freshData);
      for (const candle of freshData) {
        cachedMap.set(candle.timestamp, { data: candle, isFresh: true });
      }
    }
  }

  // Build final result from map
  const result: OHLC[] = [];
  for (let t = startTime; t <= endTime; t += intervalMs) {
    const cached = cachedMap.get(t);
    if (cached) {
      result.push(cached.data);
    }
  }

  return result;
}

/**
 * Get cache statistics for debugging and monitoring.
 */
export function getCacheStats(): {
  totalEntries: number;
  symbolCounts: Record<string, number>;
  timeframeCounts: Record<string, number>;
  oldestEntry: number | null;
  newestEntry: number | null;
} {
  const db = getDatabase();

  const totalResult = db.prepare<{ count: number }, []>(
    `SELECT COUNT(*) as count FROM historical_ohlc`
  ).get();
  const totalEntries = totalResult?.count ?? 0;

  const symbolRows = db.prepare<{ symbol: string; count: number }, []>(
    `SELECT symbol, COUNT(*) as count FROM historical_ohlc GROUP BY symbol`
  ).all();
  const symbolCounts: Record<string, number> = {};
  for (const row of symbolRows) {
    symbolCounts[row.symbol] = row.count;
  }

  const timeframeRows = db.prepare<{ timeframe: string; count: number }, []>(
    `SELECT timeframe, COUNT(*) as count FROM historical_ohlc GROUP BY timeframe`
  ).all();
  const timeframeCounts: Record<string, number> = {};
  for (const row of timeframeRows) {
    timeframeCounts[row.timeframe] = row.count;
  }

  const minResult = db.prepare<{ min_ts: number | null }, []>(
    `SELECT MIN(timestamp) as min_ts FROM historical_ohlc`
  ).get();
  const maxResult = db.prepare<{ max_ts: number | null }, []>(
    `SELECT MAX(timestamp) as max_ts FROM historical_ohlc`
  ).get();

  return {
    totalEntries,
    symbolCounts,
    timeframeCounts,
    oldestEntry: minResult?.min_ts ?? null,
    newestEntry: maxResult?.max_ts ?? null,
  };
}
