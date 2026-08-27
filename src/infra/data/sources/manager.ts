/**
 * Data Source Manager
 *
 * Manages multiple data sources with priority-based fallback.
 * Integrates SQLite caching for performance optimization.
 */

import type { Candle } from "../../../types/index.ts";
import type { DataSource, OHLCParams, DataFetchResult } from "./types.ts";
import { HistoricalDataCache } from "./cache.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("data-manager");
const PREFETCH_CONCURRENCY = 6;
const AVAILABILITY_CHECK_CONCURRENCY = 4;

async function mapWithConcurrency<T>(
  items: T[],
  concurrency: number,
  mapper: (item: T) => Promise<void>,
): Promise<void> {
  if (items.length === 0) {
    return;
  }

  const workerCount = Math.min(Math.max(concurrency, 1), items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;

      if (currentIndex >= items.length) {
        return;
      }

      const item = items[currentIndex];
      if (item === undefined) {
        return;
      }

      await mapper(item);
    }
  }

  await Promise.all(Array.from({ length: workerCount }, () => worker()));
}

// ============================================================================
// DataSourceManager Class
// ============================================================================

/**
 * DataSourceManager orchestrates data fetching from multiple sources.
 *
 * Features:
 * - Priority-based source selection (lower priority = tried first)
 * - SQLite caching layer for performance
 * - Automatic fallback to next source on failure
 * - Source availability checking
 *
 * @example
 * ```typescript
 * const manager = new DataSourceManager();
 *
 * // Register data sources
 * manager.register(new ExchangeDataSource(exchange));
 * manager.register(new PremiumDataSource(apiKey)); // Lower priority
 *
 * // Fetch data (automatically uses cache and fallback)
 * const candles = await manager.fetchOHLC({
 *   symbol: "BTCUSDT",
 *   timeframe: "1h",
 *   startTime: Date.now() - 86400000,
 *   endTime: Date.now(),
 * });
 * ```
 */
export class DataSourceManager {
  private sources: DataSource[] = [];
  private cache: HistoricalDataCache;

  constructor() {
    this.cache = new HistoricalDataCache();
  }

  /**
   * Register a data source.
   *
   * Sources are automatically sorted by priority (lower = higher priority).
   * Duplicate source IDs are replaced.
   *
   * @param source - Data source to register
   */
  register(source: DataSource): void {
    // Remove existing source with same ID
    this.sources = this.sources.filter((s) => s.id !== source.id);

    // Add new source
    this.sources.push(source);

    // Sort by priority (lower = higher priority)
    this.sources.sort((a, b) => a.priority - b.priority);

    logger.info("Registered data source", {
      id: source.id,
      name: source.name,
      priority: String(source.priority),
      totalSources: String(this.sources.length),
    });
  }

  /**
   * Unregister a data source by ID.
   *
   * @param sourceId - ID of the source to remove
   * @returns true if source was found and removed
   */
  unregister(sourceId: string): boolean {
    const initialLength = this.sources.length;
    this.sources = this.sources.filter((s) => s.id !== sourceId);
    const removed = this.sources.length < initialLength;

    if (removed) {
      logger.info("Unregistered data source", { id: sourceId });
    }

    return removed;
  }

  /**
   * List all registered data sources.
   *
   * @returns Array of data sources sorted by priority
   */
  listSources(): DataSource[] {
    return [...this.sources];
  }

  /**
   * Get a specific data source by ID.
   *
   * @param sourceId - ID of the source to find
   * @returns The data source or undefined if not found
   */
  getSource(sourceId: string): DataSource | undefined {
    return this.sources.find((s) => s.id === sourceId);
  }

  /**
   * Fetch OHLC data with caching and source fallback.
   *
   * Process:
   * 1. Check local SQLite cache first
   * 2. If cache miss, try sources in priority order
   * 3. Cache successful results
   * 4. Fall back to next source on failure
   *
   * @param params - OHLC fetch parameters
   * @returns Array of candles sorted by timestamp
   * @throws Error if all sources fail
   */
  async fetchOHLC(params: OHLCParams): Promise<Candle[]> {
    const result = await this.fetchOHLCWithMetadata(params);
    return result.candles;
  }

  /**
   * Fetch OHLC data with detailed metadata about the fetch.
   *
   * @param params - OHLC fetch parameters
   * @returns Fetch result including candles, source info, and timing
   */
  async fetchOHLCWithMetadata(params: OHLCParams): Promise<DataFetchResult> {
    const startTime = performance.now();
    const { symbol, timeframe } = params;

    // 1. Check cache first
    logger.debug("Checking cache", { symbol, timeframe });
    const cached = await this.cache.get(params);

    if (cached !== null) {
      const fetchTimeMs = performance.now() - startTime;
      logger.info("Cache hit", {
        symbol,
        timeframe,
        count: String(cached.length),
        fetchTimeMs: fetchTimeMs.toFixed(2),
      });
      return {
        candles: cached,
        sourceId: "cache",
        fromCache: true,
        fetchTimeMs,
      };
    }

    // 2. Try sources in priority order
    if (this.sources.length === 0) {
      throw new Error("No data sources registered");
    }

    const errors: Array<{ sourceId: string; error: Error }> = [];
    const availability = new Map<string, boolean>();

    await mapWithConcurrency(this.sources, AVAILABILITY_CHECK_CONCURRENCY, async (source) => {
      try {
        availability.set(source.id, await source.isAvailable());
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn("Source availability check failed", {
          sourceId: source.id,
          error: err.message,
        });
        availability.set(source.id, false);
        errors.push({ sourceId: source.id, error: err });
      }
    });

    for (const source of this.sources) {
      // Check if source is available
      const available = availability.get(source.id) ?? false;
      if (!available) {
        logger.debug("Source not available, skipping", {
          sourceId: source.id,
          sourceName: source.name,
        });
        continue;
      }

      // Check if source supports the requested timeframe
      const capabilities = source.getCapabilities();
      if (!capabilities.supportedTimeframes.includes(timeframe)) {
        logger.debug("Source does not support timeframe, skipping", {
          sourceId: source.id,
          timeframe,
          supported: capabilities.supportedTimeframes.join(", "),
        });
        continue;
      }

      // Try to fetch from this source
      try {
        logger.debug("Fetching from source", {
          sourceId: source.id,
          sourceName: source.name,
          symbol,
          timeframe,
        });

        const candles = await source.fetchOHLC(params);

        if (candles.length === 0) {
          logger.warn("Source returned no data", {
            sourceId: source.id,
            symbol,
            timeframe,
          });
          errors.push({
            sourceId: source.id,
            error: new Error("Source returned no data"),
          });
          continue;
        }

        // 3. Cache successful results
        await this.cache.set(params, candles, source.id);

        const fetchTimeMs = performance.now() - startTime;
        logger.info("Fetched from source", {
          sourceId: source.id,
          symbol,
          timeframe,
          count: String(candles.length),
          fetchTimeMs: fetchTimeMs.toFixed(2),
        });

        return {
          candles,
          sourceId: source.id,
          fromCache: false,
          fetchTimeMs,
        };
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.warn("Source fetch failed, trying next", {
          sourceId: source.id,
          error: err.message,
        });
        errors.push({ sourceId: source.id, error: err });
        // Continue to next source
      }
    }

    // 4. All sources failed
    const errorDetails = errors.map((e) => `${e.sourceId}: ${e.error.message}`).join("; ");
    throw new Error(`All data sources failed. Errors: ${errorDetails}`);
  }

  /**
   * Prefetch data for multiple symbols/timeframes.
   *
   * Useful for warming the cache before analysis.
   *
   * @param requests - Array of OHLC params to prefetch
   * @returns Summary of prefetch results
   */
  async prefetch(requests: OHLCParams[]): Promise<{
    succeeded: number;
    failed: number;
    errors: Array<{ params: OHLCParams; error: string }>;
  }> {
    const results = {
      succeeded: 0,
      failed: 0,
      errors: [] as Array<{ params: OHLCParams; error: string }>,
    };

    await mapWithConcurrency(requests, PREFETCH_CONCURRENCY, async (params) => {
      try {
        await this.fetchOHLC(params);
        results.succeeded++;
      } catch (error) {
        results.failed++;
        results.errors.push({
          params,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });

    logger.info("Prefetch completed", {
      succeeded: String(results.succeeded),
      failed: String(results.failed),
    });

    return results;
  }

  /**
   * Get cache statistics.
   */
  async getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Clear the cache.
   *
   * @param symbol - Optional symbol filter
   * @param timeframe - Optional timeframe filter
   */
  async clearCache(symbol?: string, timeframe?: string): Promise<void> {
    await this.cache.clear(symbol, timeframe);
  }

  /**
   * Prune old cache entries.
   *
   * @param maxAgeMs - Maximum age in milliseconds
   * @returns Number of entries deleted
   */
  async pruneCache(maxAgeMs?: number): Promise<number> {
    return this.cache.prune(maxAgeMs);
  }

  /**
   * Get data coverage information from cache.
   *
   * @param symbol - Trading pair symbol
   * @param timeframe - Candle timeframe
   */
  async getCoverage(symbol: string, timeframe: string) {
    return this.cache.getCoverage(symbol, timeframe);
  }

  /**
   * Check availability of all registered sources.
   *
   * @returns Map of source ID to availability status
   */
  async checkSourceAvailability(): Promise<Map<string, boolean>> {
    const availability = new Map<string, boolean>();

    for (const source of this.sources) {
      try {
        const available = await source.isAvailable();
        availability.set(source.id, available);
      } catch {
        availability.set(source.id, false);
      }
    }

    return availability;
  }

  /**
   * Get the underlying cache instance for advanced operations.
   */
  getCache(): HistoricalDataCache {
    return this.cache;
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let defaultManager: DataSourceManager | null = null;

/**
 * Get the default DataSourceManager singleton.
 *
 * Creates a new instance on first call.
 */
export function getDataSourceManager(): DataSourceManager {
  if (!defaultManager) {
    defaultManager = new DataSourceManager();
  }
  return defaultManager;
}

/**
 * Reset the default DataSourceManager.
 *
 * Useful for testing.
 */
export function resetDataSourceManager(): void {
  defaultManager = null;
}
