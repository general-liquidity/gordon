/**
 * Historical Data Cache
 *
 * SQLite-based caching layer for OHLC data.
 * Stores candles with source tracking and provides efficient coverage queries.
 */

import { getDatabase } from "../../storage/index.ts";
import { createModuleLogger } from "../../logger/index.ts";
import type { Candle } from "../../../types/index.ts";
import type { OHLCParams, DataCoverage } from "./types.ts";

const logger = createModuleLogger("data-cache");

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

// ============================================================================
// HistoricalDataCache Class
// ============================================================================

/**
 * HistoricalDataCache provides SQLite-based caching for OHLC data.
 *
 * Features:
 * - Efficient storage with compound primary key (symbol, timeframe, timestamp)
 * - Source tracking for data provenance
 * - Coverage queries to determine data completeness
 * - Automatic deduplication on insert
 *
 * @example
 * ```typescript
 * const cache = new HistoricalDataCache();
 *
 * // Check for cached data
 * const cached = await cache.get({
 *   symbol: "BTCUSDT",
 *   timeframe: "1h",
 *   startTime: Date.now() - 86400000,
 *   endTime: Date.now(),
 * });
 *
 * if (cached) {
 *   console.log(`Found ${cached.length} cached candles`);
 * }
 *
 * // Store new data
 * await cache.set(params, candles, "exchange-source");
 * ```
 */
export class HistoricalDataCache {
  /**
   * Retrieve cached OHLC data for the specified parameters.
   *
   * @param params - OHLC query parameters
   * @returns Array of candles if data exists and covers the range, null otherwise
   */
  async get(params: OHLCParams): Promise<Candle[] | null> {
    const db = getDatabase();
    const { symbol, timeframe, startTime, endTime } = params;
    const upperSymbol = symbol.toUpperCase();

    const query = db.prepare<
      {
        timestamp: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
      },
      [string, string, number, number]
    >(`
      SELECT timestamp, open, high, low, close, volume
      FROM data_source_cache
      WHERE symbol = ? AND timeframe = ? AND timestamp >= ? AND timestamp <= ?
      ORDER BY timestamp ASC
    `);

    const rows = query.all(upperSymbol, timeframe, startTime, endTime);

    if (rows.length === 0) {
      logger.debug("Cache miss: no data found", { symbol: upperSymbol, timeframe });
      return null;
    }

    // Check for data completeness
    const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;
    const expectedCount = Math.floor((endTime - startTime) / intervalMs) + 1;

    // Require at least 90% coverage for cache hit
    if (rows.length < expectedCount * 0.9) {
      logger.debug("Cache miss: incomplete data", {
        symbol: upperSymbol,
        timeframe,
        cached: String(rows.length),
        expected: String(expectedCount),
        coverage: `${((rows.length / expectedCount) * 100).toFixed(1)}%`,
      });
      return null;
    }

    logger.debug("Cache hit", {
      symbol: upperSymbol,
      timeframe,
      count: String(rows.length),
    });

    // Convert to Candle type
    return rows.map((row) => ({
      openTime: row.timestamp,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
      closeTime: row.timestamp + intervalMs - 1,
    }));
  }

  /**
   * Store OHLC data in the cache.
   *
   * Uses INSERT OR REPLACE to handle duplicates automatically.
   * Data is stored with source tracking for provenance.
   *
   * @param params - OHLC query parameters
   * @param data - Array of candles to cache
   * @param sourceId - Identifier of the data source (default: "unknown")
   */
  async set(params: OHLCParams, data: Candle[], sourceId: string = "unknown"): Promise<void> {
    if (data.length === 0) {
      return;
    }

    const db = getDatabase();
    const { symbol, timeframe } = params;
    const upperSymbol = symbol.toUpperCase();
    const now = Date.now();

    const insertStmt = db.prepare(`
      INSERT OR REPLACE INTO data_source_cache
      (symbol, timeframe, timestamp, open, high, low, close, volume, source_id, fetched_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    // Use a transaction for better performance with bulk inserts
    const transaction = db.transaction(() => {
      for (const candle of data) {
        insertStmt.run(
          upperSymbol,
          timeframe,
          candle.openTime,
          candle.open,
          candle.high,
          candle.low,
          candle.close,
          candle.volume,
          sourceId,
          now
        );
      }
    });

    transaction();

    logger.debug("Cached OHLC data", {
      symbol: upperSymbol,
      timeframe,
      count: String(data.length),
      sourceId,
    });
  }

  /**
   * Get the coverage range of cached data for a symbol/timeframe.
   *
   * @param symbol - Trading pair symbol
   * @param timeframe - Candle timeframe
   * @returns Coverage range with start/end timestamps, or null if no data
   */
  async getCoverage(symbol: string, timeframe: string): Promise<DataCoverage | null> {
    const db = getDatabase();
    const upperSymbol = symbol.toUpperCase();

    const query = db.prepare<
      { min_ts: number | null; max_ts: number | null },
      [string, string]
    >(`
      SELECT MIN(timestamp) as min_ts, MAX(timestamp) as max_ts
      FROM data_source_cache
      WHERE symbol = ? AND timeframe = ?
    `);

    const result = query.get(upperSymbol, timeframe);

    if (!result || result.min_ts === null || result.max_ts === null) {
      return null;
    }

    return {
      start: result.min_ts,
      end: result.max_ts,
    };
  }

  /**
   * Get count of cached candles for a symbol/timeframe.
   *
   * @param symbol - Trading pair symbol
   * @param timeframe - Candle timeframe
   * @returns Number of cached candles
   */
  async getCount(symbol: string, timeframe: string): Promise<number> {
    const db = getDatabase();
    const upperSymbol = symbol.toUpperCase();

    const query = db.prepare<{ count: number }, [string, string]>(`
      SELECT COUNT(*) as count
      FROM data_source_cache
      WHERE symbol = ? AND timeframe = ?
    `);

    const result = query.get(upperSymbol, timeframe);
    return result?.count ?? 0;
  }

  /**
   * Clear cached data for a specific symbol/timeframe or all data.
   *
   * @param symbol - Optional symbol filter
   * @param timeframe - Optional timeframe filter
   */
  async clear(symbol?: string, timeframe?: string): Promise<void> {
    const db = getDatabase();

    if (symbol && timeframe) {
      db.run(`DELETE FROM data_source_cache WHERE symbol = ? AND timeframe = ?`, [
        symbol.toUpperCase(),
        timeframe,
      ]);
      logger.info("Cleared cache for symbol/timeframe", { symbol, timeframe });
    } else if (symbol) {
      db.run(`DELETE FROM data_source_cache WHERE symbol = ?`, [symbol.toUpperCase()]);
      logger.info("Cleared cache for symbol", { symbol });
    } else {
      db.run(`DELETE FROM data_source_cache`);
      logger.info("Cleared entire data source cache");
    }
  }

  /**
   * Get statistics about the cache.
   */
  async getStats(): Promise<{
    totalEntries: number;
    symbols: string[];
    timeframes: string[];
    oldestEntry: number | null;
    newestEntry: number | null;
    bySource: Record<string, number>;
  }> {
    const db = getDatabase();

    // Total entries
    const totalResult = db.prepare<{ count: number }, []>(
      `SELECT COUNT(*) as count FROM data_source_cache`
    ).get();
    const totalEntries = totalResult?.count ?? 0;

    // Distinct symbols
    const symbolRows = db.prepare<{ symbol: string }, []>(
      `SELECT DISTINCT symbol FROM data_source_cache ORDER BY symbol`
    ).all();
    const symbols = symbolRows.map((r) => r.symbol);

    // Distinct timeframes
    const timeframeRows = db.prepare<{ timeframe: string }, []>(
      `SELECT DISTINCT timeframe FROM data_source_cache ORDER BY timeframe`
    ).all();
    const timeframes = timeframeRows.map((r) => r.timeframe);

    // Oldest and newest
    const minResult = db.prepare<{ min_ts: number | null }, []>(
      `SELECT MIN(timestamp) as min_ts FROM data_source_cache`
    ).get();
    const maxResult = db.prepare<{ max_ts: number | null }, []>(
      `SELECT MAX(timestamp) as max_ts FROM data_source_cache`
    ).get();

    // Count by source
    const sourceRows = db.prepare<{ source_id: string; count: number }, []>(
      `SELECT source_id, COUNT(*) as count FROM data_source_cache GROUP BY source_id`
    ).all();
    const bySource: Record<string, number> = {};
    for (const row of sourceRows) {
      bySource[row.source_id] = row.count;
    }

    return {
      totalEntries,
      symbols,
      timeframes,
      oldestEntry: minResult?.min_ts ?? null,
      newestEntry: maxResult?.max_ts ?? null,
      bySource,
    };
  }

  /**
   * Prune old cache entries based on fetched_at timestamp.
   *
   * @param maxAgeMs - Maximum age in milliseconds (default: 30 days)
   * @returns Number of entries deleted
   */
  async prune(maxAgeMs: number = 30 * 24 * 60 * 60 * 1000): Promise<number> {
    const db = getDatabase();
    const cutoff = Date.now() - maxAgeMs;

    const result = db.run(`DELETE FROM data_source_cache WHERE fetched_at < ?`, [cutoff]);
    const deleted = result.changes;

    if (deleted > 0) {
      logger.info("Pruned old cache entries", { deleted: String(deleted) });
    }

    return deleted;
  }
}
