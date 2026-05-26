import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  upsertCandles,
  readCandles,
  countCachedCandles,
  pruneCacheBefore,
  _resetCacheForTests,
  type CachedCandle,
} from "./ohlcvCache.ts";
import {
  setDatabasePathForTesting,
  closeDatabase,
} from "../storage/database.ts";
import { unlinkSync, existsSync } from "node:fs";

// Fresh DB per test — Windows holds WAL/SHM file handles briefly after
// close, so reusing one path across tests races the OS unlink.
let testCounter = 0;
let currentDbPath = "";
const cleanupPaths = new Set<string>();

function safeUnlink(path: string): void {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* Windows-busy — leave for next run / gitignore */ }
}

function bar(openTime: number, base = 100, vol = 1_000): CachedCandle {
  return {
    openTime,
    open: base,
    high: base * 1.01,
    low: base * 0.99,
    close: base * 1.005,
    volume: vol,
    closeTime: openTime + 60_000,
  };
}

beforeEach(() => {
  testCounter++;
  currentDbPath = `${process.cwd()}/.tmp-ohlcv-${process.pid}-${testCounter}.db`;
  cleanupPaths.add(currentDbPath);
  setDatabasePathForTesting(currentDbPath);
  _resetCacheForTests();
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

describe("ohlcvCache — write path", () => {
  test("inserts a fresh batch and counts back correctly", () => {
    const candles = [bar(1_000), bar(2_000), bar(3_000)];
    const res = upsertCandles("binance", "BTC/USDT", "1m", candles);
    expect(res.inserted).toBe(3);
    expect(res.skipped).toBe(0);
    expect(countCachedCandles("binance", "BTC/USDT", "1m")).toBe(3);
  });

  test("re-inserting same bars is a no-op (first-writer-wins)", () => {
    const candles = [bar(1_000), bar(2_000)];
    upsertCandles("binance", "BTC/USDT", "1m", candles);
    const res = upsertCandles("binance", "BTC/USDT", "1m", candles);
    expect(res.inserted).toBe(0);
    expect(res.skipped).toBe(2);
    expect(countCachedCandles("binance", "BTC/USDT", "1m")).toBe(2);
  });

  test("normalizes symbol case so BTC/USDT == btc/usdt", () => {
    upsertCandles("binance", "btc/usdt", "1m", [bar(1_000)]);
    expect(countCachedCandles("binance", "BTC/USDT", "1m")).toBe(1);
  });

  test("rejects malformed candles without throwing", () => {
    const candles = [
      bar(1_000),
      { open: 1, high: 1, low: 1, close: 1, volume: NaN, openTime: 2_000 } as CachedCandle,
      { open: 1, high: 1, low: 1, close: 1, volume: 100, openTime: -1 } as CachedCandle,
    ];
    const res = upsertCandles("binance", "BTC/USDT", "1m", candles);
    expect(res.inserted).toBe(1);
    expect(res.skipped).toBe(2);
  });

  test("isolates venue + symbol + timeframe", () => {
    upsertCandles("binance", "BTC/USDT", "1m", [bar(1_000)]);
    upsertCandles("coinbase", "BTC/USDT", "1m", [bar(1_000)]);
    upsertCandles("binance", "ETH/USDT", "1m", [bar(1_000)]);
    upsertCandles("binance", "BTC/USDT", "1h", [bar(1_000)]);
    expect(countCachedCandles("binance", "BTC/USDT", "1m")).toBe(1);
    expect(countCachedCandles("coinbase", "BTC/USDT", "1m")).toBe(1);
    expect(countCachedCandles("binance", "ETH/USDT", "1m")).toBe(1);
    expect(countCachedCandles("binance", "BTC/USDT", "1h")).toBe(1);
  });

  test("handles empty input cleanly", () => {
    const res = upsertCandles("binance", "BTC/USDT", "1m", []);
    expect(res).toEqual({ inserted: 0, skipped: 0 });
  });
});

describe("ohlcvCache — read path", () => {
  test("returns all cached candles in ascending bar_ts order", () => {
    upsertCandles("binance", "BTC/USDT", "1m", [bar(3_000), bar(1_000), bar(2_000)]);
    const out = readCandles("binance", "BTC/USDT", "1m");
    expect(out.map((c) => c.openTime)).toEqual([1_000, 2_000, 3_000]);
  });

  test("filters by fromTs / toTs window", () => {
    upsertCandles("binance", "BTC/USDT", "1m", [
      bar(1_000), bar(2_000), bar(3_000), bar(4_000), bar(5_000),
    ]);
    const out = readCandles("binance", "BTC/USDT", "1m", { fromTs: 2_000, toTs: 4_000 });
    expect(out.map((c) => c.openTime)).toEqual([2_000, 3_000, 4_000]);
  });

  test("respects limit", () => {
    upsertCandles("binance", "BTC/USDT", "1m", [bar(1_000), bar(2_000), bar(3_000)]);
    const out = readCandles("binance", "BTC/USDT", "1m", { limit: 2 });
    expect(out).toHaveLength(2);
    expect(out[0]!.openTime).toBe(1_000);
  });

  test("empty when nothing cached", () => {
    expect(readCandles("binance", "BTC/USDT", "1m")).toEqual([]);
  });
});

describe("ohlcvCache — asOfStoredAt replay semantics", () => {
  test("excludes rows stored AFTER the asOf cutoff", async () => {
    upsertCandles("binance", "BTC/USDT", "1m", [bar(1_000)]);
    // Sleep so the second batch gets a strictly-later stored_at.
    await new Promise((resolve) => setTimeout(resolve, 5));
    const cutoff = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 5));
    upsertCandles("binance", "BTC/USDT", "1m", [bar(2_000)]);

    const replay = readCandles("binance", "BTC/USDT", "1m", { asOfStoredAt: cutoff });
    expect(replay.map((c) => c.openTime)).toEqual([1_000]);

    const live = readCandles("binance", "BTC/USDT", "1m");
    expect(live).toHaveLength(2);
  });

  test("future asOf returns everything", () => {
    upsertCandles("binance", "BTC/USDT", "1m", [bar(1_000), bar(2_000)]);
    const future = Date.now() + 1_000_000;
    const out = readCandles("binance", "BTC/USDT", "1m", { asOfStoredAt: future });
    expect(out).toHaveLength(2);
  });

  test("past asOf returns empty", () => {
    upsertCandles("binance", "BTC/USDT", "1m", [bar(1_000), bar(2_000)]);
    const past = Date.now() - 1_000_000;
    const out = readCandles("binance", "BTC/USDT", "1m", { asOfStoredAt: past });
    expect(out).toEqual([]);
  });
});

describe("ohlcvCache — prune", () => {
  test("pruneCacheBefore drops rows older than threshold", async () => {
    upsertCandles("binance", "BTC/USDT", "1m", [bar(1_000)]);
    await new Promise((resolve) => setTimeout(resolve, 10));
    const cutoff = Date.now();
    await new Promise((resolve) => setTimeout(resolve, 10));
    upsertCandles("binance", "BTC/USDT", "1m", [bar(2_000)]);

    const removed = pruneCacheBefore(cutoff);
    expect(removed).toBe(1);
    const remaining = readCandles("binance", "BTC/USDT", "1m");
    expect(remaining.map((c) => c.openTime)).toEqual([2_000]);
  });
});
