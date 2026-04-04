/**
 * Historical data compatibility layer.
 *
 * This file preserves the existing backtest fetch API while routing all reads
 * through the shared DataSourceManager and data_source_cache tables.
 */

import type { Exchange } from "../../infra/exchange/types.ts";
import type { BrokerAdapter } from "../../infra/broker/types.ts";
import type { OHLC } from "../types.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import { normalizeCryptoSymbol } from "../../infra/domain/markets/instruments.ts";
import { getDatabase } from "../../infra/storage/index.ts";
import {
  DataSourceManager,
  ExchangeDataSource,
  BrokerDataSource,
} from "../../infra/data/sources/index.ts";

const logger = createModuleLogger("historical-data");

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

export type HistoricalDataClient = Exchange | BrokerAdapter;
export type HistoricalSourceKind = "exchange" | "broker" | "cache";

export interface HistoricalFetchMetadata {
  symbol: string;
  timeframe: string;
  startTime: number;
  endTime: number;
  candleCount: number;
  sourceId: string;
  sourceKind: HistoricalSourceKind;
  marketFamily: "crypto" | "stocks";
  fetchTimeMs: number;
  fromCache: boolean;
}

export interface HistoricalFetchResult {
  data: OHLC[];
  metadata: HistoricalFetchMetadata;
}

function isBrokerClient(client: HistoricalDataClient): client is BrokerAdapter {
  return "brokerId" in client;
}

function normalizeSymbol(client: HistoricalDataClient, symbol: string): string {
  const upper = symbol.toUpperCase();
  if (isBrokerClient(client)) {
    return upper;
  }
  return normalizeCryptoSymbol(symbol);
}

function mapToOHLC(
  candles: Array<{
    openTime: number;
    open: number;
    high: number;
    low: number;
    close: number;
    volume: number;
  }>,
): OHLC[] {
  return candles.map((candle) => ({
    timestamp: candle.openTime,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
  }));
}

function buildManager(client: HistoricalDataClient): {
  manager: DataSourceManager;
  sourceKind: Exclude<HistoricalSourceKind, "cache">;
  marketFamily: "crypto" | "stocks";
} {
  const manager = new DataSourceManager();

  if (isBrokerClient(client)) {
    manager.register(new BrokerDataSource(client));
    return {
      manager,
      sourceKind: "broker",
      marketFamily: "stocks",
    };
  }

  manager.register(new ExchangeDataSource(client));
  return {
    manager,
    sourceKind: "exchange",
    marketFamily: "crypto",
  };
}

/**
 * Retained for backward compatibility.
 * The shared SQLite database now initializes the underlying cache table.
 */
export function initHistoricalDataTable(): void {
  getDatabase();
}

export async function fetchHistoricalDataWithMetadata(
  client: HistoricalDataClient,
  symbol: string,
  timeframe: string,
  days: number,
): Promise<HistoricalFetchResult> {
  const endTime = Date.now();
  const intervalMs = TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;
  const startTime = endTime - Math.max(days, 1) * 24 * 60 * 60 * 1000;
  const adjustedStart = Math.max(0, startTime - intervalMs);
  return fetchHistoricalDataRangeWithMetadata(client, symbol, timeframe, adjustedStart, endTime);
}

export async function fetchHistoricalData(
  client: HistoricalDataClient,
  symbol: string,
  timeframe: string,
  days: number,
): Promise<OHLC[]> {
  const result = await fetchHistoricalDataWithMetadata(client, symbol, timeframe, days);
  return result.data;
}

export async function fetchHistoricalDataRangeWithMetadata(
  client: HistoricalDataClient,
  symbol: string,
  timeframe: string,
  startTime: number,
  endTime: number,
): Promise<HistoricalFetchResult> {
  const normalizedSymbol = normalizeSymbol(client, symbol);
  const { manager, sourceKind, marketFamily } = buildManager(client);
  const result = await manager.fetchOHLCWithMetadata({
    symbol: normalizedSymbol,
    timeframe,
    startTime,
    endTime,
  });

  const data = mapToOHLC(result.candles);
  logger.info("Fetched historical data", {
    symbol: normalizedSymbol,
    timeframe,
    candles: String(data.length),
    sourceId: result.sourceId,
    fromCache: String(result.fromCache),
  });

  return {
    data,
    metadata: {
      symbol: normalizedSymbol,
      timeframe,
      startTime,
      endTime,
      candleCount: data.length,
      sourceId: result.sourceId,
      sourceKind: result.fromCache ? "cache" : sourceKind,
      marketFamily,
      fetchTimeMs: result.fetchTimeMs,
      fromCache: result.fromCache,
    },
  };
}

export async function fetchHistoricalDataRange(
  client: HistoricalDataClient,
  symbol: string,
  timeframe: string,
  startTime: number,
  endTime: number,
): Promise<OHLC[]> {
  const result = await fetchHistoricalDataRangeWithMetadata(
    client,
    symbol,
    timeframe,
    startTime,
    endTime,
  );
  return result.data;
}

export function clearHistoricalDataCache(olderThanMs?: number): number {
  const db = getDatabase();
  if (olderThanMs === undefined) {
    const result = db.run("DELETE FROM data_source_cache");
    return Number(result.changes ?? 0);
  }

  const cutoff = Date.now() - olderThanMs;
  const result = db.run("DELETE FROM data_source_cache WHERE fetched_at < ?", [cutoff]);
  return Number(result.changes ?? 0);
}

export function getHistoricalDataStats(): {
  totalRows: number;
  symbolCounts: Record<string, number>;
  timeframeCounts: Record<string, number>;
  oldestTimestamp: number | null;
  newestTimestamp: number | null;
  sourceCounts: Record<string, number>;
} {
  const db = getDatabase();

  const totalRows = Number(
    db.prepare<{ count: number }, []>("SELECT COUNT(*) as count FROM data_source_cache").get()?.count ?? 0,
  );

  const symbolCounts: Record<string, number> = {};
  for (const row of db
    .prepare<{ symbol: string; count: number }, []>(
      "SELECT symbol, COUNT(*) as count FROM data_source_cache GROUP BY symbol",
    )
    .all()) {
    symbolCounts[row.symbol] = row.count;
  }

  const timeframeCounts: Record<string, number> = {};
  for (const row of db
    .prepare<{ timeframe: string; count: number }, []>(
      "SELECT timeframe, COUNT(*) as count FROM data_source_cache GROUP BY timeframe",
    )
    .all()) {
    timeframeCounts[row.timeframe] = row.count;
  }

  const sourceCounts: Record<string, number> = {};
  for (const row of db
    .prepare<{ source_id: string; count: number }, []>(
      "SELECT source_id, COUNT(*) as count FROM data_source_cache GROUP BY source_id",
    )
    .all()) {
    sourceCounts[row.source_id] = row.count;
  }

  const oldestTimestamp = db
    .prepare<{ min_ts: number | null }, []>("SELECT MIN(timestamp) as min_ts FROM data_source_cache")
    .get()?.min_ts ?? null;
  const newestTimestamp = db
    .prepare<{ max_ts: number | null }, []>("SELECT MAX(timestamp) as max_ts FROM data_source_cache")
    .get()?.max_ts ?? null;

  return {
    totalRows,
    symbolCounts,
    timeframeCounts,
    oldestTimestamp,
    newestTimestamp,
    sourceCounts,
  };
}
