import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { backfillOHLCV, MAX_LIMIT } from "./backfill.ts";
import { readCandles, countCachedCandles, _resetCacheForTests } from "./ohlcvCache.ts";
import {
  getDatasetRecord,
  listDatasetRecords,
  _resetSystematicTablesForTests,
} from "../domain/systematic/store.ts";
import { setDatabasePathForTesting, closeDatabase } from "../storage/database.ts";
import type { Exchange } from "../exchange/types.ts";
import type { Candle } from "../../types/index.ts";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let testCounter = 0;
let currentDbPath = "";
const cleanupPaths = new Set<string>();

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) unlinkSync(path);
  } catch {
    /* Windows-busy */
  }
}

const TF_MS = 60 * 60 * 1000; // 1h

/**
 * Mock exchange whose getCandles returns capped pages walking forward from
 * `since`. Backed by a synthetic contiguous 1h series. `pageCap` simulates
 * the CCXT per-call ceiling. Records every getCandles call for assertions
 * and ASSERTS that no mutating method is ever invoked (read-only contract).
 */
function makeMockExchange(opts: {
  rangeStart: number;
  totalBars: number;
  pageCap?: number;
  gapAt?: number; // index to omit, producing a cadence gap
}): { exchange: Exchange; calls: Array<{ since?: number; limit?: number }> } {
  const pageCap = opts.pageCap ?? 500;
  const calls: Array<{ since?: number; limit?: number }> = [];
  const series: Candle[] = [];
  for (let i = 0; i < opts.totalBars; i += 1) {
    if (opts.gapAt !== undefined && i === opts.gapAt) continue;
    const openTime = opts.rangeStart + i * TF_MS;
    series.push({
      openTime,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1000 + i,
      closeTime: openTime + TF_MS - 1,
    });
  }

  const forbidden = () => {
    throw new Error("read-only contract violated: mutating call on mock exchange");
  };

  const exchange = {
    exchangeId: "ccxt:binance",
    displayName: "Mock Binance",
    async getCandles(
      _symbol: string,
      _interval: string,
      limit = 100,
      since?: number,
    ): Promise<Candle[]> {
      calls.push({ since, limit });
      const start = since ?? 0;
      const page = series.filter((c) => c.openTime >= start).slice(0, Math.min(limit, pageCap));
      return page;
    },
    createOrder: forbidden,
    cancelOrder: forbidden,
    cancelAllOrders: forbidden,
    withdraw: forbidden,
  } as unknown as Exchange;

  return { exchange, calls };
}

beforeEach(() => {
  testCounter++;
  currentDbPath = join(tmpdir(), `gordon-backfill-${process.pid}-${testCounter}.db`);
  cleanupPaths.add(currentDbPath);
  setDatabasePathForTesting(currentDbPath);
  _resetCacheForTests();
  _resetSystematicTablesForTests();
});

afterEach(() => {
  closeDatabase();
  setDatabasePathForTesting(null);
});

afterAll(() => {
  for (const path of cleanupPaths) {
    safeUnlink(path);
    safeUnlink(`${path}-wal`);
    safeUnlink(`${path}-shm`);
  }
});

describe("backfillOHLCV — pagination", () => {
  test("walks the full multi-page range, exceeding the per-call cap", async () => {
    const rangeStart = 1_700_000_000_000;
    const totalBars = 1500; // > pageCap so it must paginate
    const { exchange, calls } = makeMockExchange({ rangeStart, totalBars, pageCap: 500 });

    const result = await backfillOHLCV({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: rangeStart,
      until: rangeStart + (totalBars - 1) * TF_MS,
    });

    // Proves pagination: more candles than a single page could hold.
    expect(result.candles).toBe(totalBars);
    expect(result.candles).toBeGreaterThan(500);
    expect(result.pages).toBeGreaterThan(1);
    expect(calls.length).toBe(result.pages);
    // Every getCandles call asked for the MAX_LIMIT page size.
    expect(calls.every((c) => c.limit === MAX_LIMIT)).toBe(true);
    // Persisted contiguously.
    expect(countCachedCandles("ccxt:binance", "BTC/USDT", "1h")).toBe(totalBars);
    expect(result.from).toBe(rangeStart);
    expect(result.to).toBe(rangeStart + (totalBars - 1) * TF_MS);
    expect(result.gaps).toBe(0);
  });

  test("dedupes overlapping bars across page boundaries", async () => {
    const rangeStart = 1_700_000_000_000;
    const totalBars = 1200;
    const { exchange } = makeMockExchange({ rangeStart, totalBars, pageCap: 400 });

    const result = await backfillOHLCV({
      exchange,
      symbol: "ETH/USDT",
      timeframe: "1h",
      since: rangeStart,
      until: rangeStart + (totalBars - 1) * TF_MS,
    });

    // No duplicate persists despite since-aligned page overlaps.
    expect(result.candles).toBe(totalBars);
    const rows = readCandles("ccxt:binance", "ETH/USDT", "1h");
    const uniqueTs = new Set(rows.map((r) => r.openTime));
    expect(uniqueTs.size).toBe(rows.length);
  });

  test("stops when a page returns fewer than 2 candles", async () => {
    const rangeStart = 1_700_000_000_000;
    const { exchange, calls } = makeMockExchange({ rangeStart, totalBars: 50, pageCap: 500 });

    // Request a window far beyond available data — loop must terminate.
    const result = await backfillOHLCV({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: rangeStart,
      until: rangeStart + 10_000 * TF_MS,
    });

    expect(result.candles).toBe(50);
    // Bounded number of calls — does not spin forever.
    expect(calls.length).toBeLessThan(5);
  });

  test("respects maxCandles cap", async () => {
    const rangeStart = 1_700_000_000_000;
    const { exchange } = makeMockExchange({ rangeStart, totalBars: 5000, pageCap: 500 });

    const result = await backfillOHLCV({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: rangeStart,
      until: rangeStart + 5000 * TF_MS,
      maxCandles: 1000,
    });

    expect(result.candles).toBeLessThanOrEqual(1000 + MAX_LIMIT);
    expect(result.candles).toBeGreaterThanOrEqual(1000);
  });

  test("detects gaps vs expected cadence", async () => {
    const rangeStart = 1_700_000_000_000;
    const { exchange } = makeMockExchange({ rangeStart, totalBars: 600, pageCap: 500, gapAt: 300 });

    const result = await backfillOHLCV({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: rangeStart,
      until: rangeStart + 599 * TF_MS,
    });

    expect(result.gaps).toBe(1);
  });

  test("invokes onProgress as candles accumulate", async () => {
    const rangeStart = 1_700_000_000_000;
    const { exchange } = makeMockExchange({ rangeStart, totalBars: 900, pageCap: 400 });
    const progress: number[] = [];

    await backfillOHLCV({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: rangeStart,
      until: rangeStart + 899 * TF_MS,
      onProgress: (n) => progress.push(n),
    });

    expect(progress.length).toBeGreaterThan(1);
    // Monotonically non-decreasing.
    for (let i = 1; i < progress.length; i += 1) {
      expect(progress[i]!).toBeGreaterThanOrEqual(progress[i - 1]!);
    }
    expect(progress[progress.length - 1]).toBe(900);
  });
});

describe("backfillOHLCV — dataset registration", () => {
  test("registers a dataset row in the systematic store", async () => {
    const rangeStart = 1_700_000_000_000;
    const totalBars = 800;
    const { exchange } = makeMockExchange({ rangeStart, totalBars, pageCap: 500 });

    const result = await backfillOHLCV({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: rangeStart,
      until: rangeStart + (totalBars - 1) * TF_MS,
    });

    expect(result.datasetId).not.toBeNull();
    const record = getDatasetRecord(result.datasetId!);
    expect(record).not.toBeNull();
    expect(record!.symbol).toBe("BTC/USDT");
    expect(record!.timeframe).toBe("1h");
    expect(record!.sourceId).toBe("ccxt:binance");
    expect(record!.candleCount).toBe(totalBars);
    expect(record!.startTime).toBe(rangeStart);
    expect(record!.kind).toBe("raw_ohlc");

    const listed = listDatasetRecords({ symbol: "BTC/USDT", timeframe: "1h" });
    expect(listed.length).toBe(1);
  });

  test("no dataset row when the range yields no candles", async () => {
    const rangeStart = 1_700_000_000_000;
    // series starts AFTER the requested window end → nothing in range.
    const { exchange } = makeMockExchange({
      rangeStart: rangeStart + 10_000 * TF_MS,
      totalBars: 100,
    });

    const result = await backfillOHLCV({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: rangeStart,
      until: rangeStart + 10 * TF_MS,
    });

    expect(result.candles).toBe(0);
    expect(result.datasetId).toBeNull();
  });
});
