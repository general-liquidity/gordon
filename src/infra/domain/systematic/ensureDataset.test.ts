import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import { ensureDataset } from "./service.ts";
import { upsertCandles, _resetCacheForTests, type CachedCandle } from "../../data/ohlcvCache.ts";
import { setDatabasePathForTesting, closeDatabase } from "../../storage/database.ts";
import { _resetSystematicTablesForTests } from "./store.ts";
import type { Exchange } from "../../exchange/types.ts";
import type { Candle } from "../../../types/index.ts";
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
const VENUE = "ccxt:binance";

function cached(openTime: number, base = 100): CachedCandle {
  return {
    openTime,
    open: base,
    high: base + 1,
    low: base - 1,
    close: base + 0.5,
    volume: 1000,
    closeTime: openTime + TF_MS - 1,
  };
}

/** Mock exchange serving a contiguous 1h series from rangeStart. Records the
 *  `since` of every getCandles call so the test can assert which sub-range
 *  was actually fetched. */
function makeMockExchange(
  rangeStart: number,
  totalBars: number,
): {
  exchange: Exchange;
  fetchedSince: number[];
} {
  const fetchedSince: number[] = [];
  const series: Candle[] = [];
  for (let i = 0; i < totalBars; i += 1) {
    const openTime = rangeStart + i * TF_MS;
    series.push({
      openTime,
      open: 100 + i,
      high: 101 + i,
      low: 99 + i,
      close: 100.5 + i,
      volume: 1000,
      closeTime: openTime + TF_MS - 1,
    });
  }
  const exchange = {
    exchangeId: VENUE,
    displayName: "Mock",
    async getCandles(_s: string, _i: string, limit = 100, since?: number): Promise<Candle[]> {
      if (since !== undefined) fetchedSince.push(since);
      const start = since ?? 0;
      return series.filter((c) => c.openTime >= start).slice(0, limit);
    },
  } as unknown as Exchange;
  return { exchange, fetchedSince };
}

beforeEach(() => {
  testCounter++;
  currentDbPath = join(tmpdir(), `gordon-ensureds-${process.pid}-${testCounter}.db`);
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

describe("ensureDataset — gap-fill", () => {
  test("fully cached range fetches nothing", async () => {
    const t0 = 1_700_000_000_000;
    // Cache t0..t10 (11 bars).
    const bars = Array.from({ length: 11 }, (_, i) => cached(t0 + i * TF_MS));
    upsertCandles(VENUE, "BTC/USDT", "1h", bars);

    const { exchange, fetchedSince } = makeMockExchange(t0, 11);
    const out = await ensureDataset({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: t0,
      until: t0 + 10 * TF_MS,
    });

    expect(out.length).toBe(11);
    // Nothing fetched — cache already covered the range.
    expect(fetchedSince.length).toBe(0);
  });

  test("cache has [t0..t5], request [t0..t10] → only t6..t10 fetched", async () => {
    const t0 = 1_700_000_000_000;
    // Cache t0..t5 (6 bars).
    const bars = Array.from({ length: 6 }, (_, i) => cached(t0 + i * TF_MS));
    upsertCandles(VENUE, "BTC/USDT", "1h", bars);

    const { exchange, fetchedSince } = makeMockExchange(t0, 11);
    const out = await ensureDataset({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: t0,
      until: t0 + 10 * TF_MS,
    });

    // Full contiguous range returned.
    expect(out.length).toBe(11);
    expect(out[0]!.openTime).toBe(t0);
    expect(out[10]!.openTime).toBe(t0 + 10 * TF_MS);

    // Backfill fetched only the tail sub-range — its first `since` is the
    // bar AFTER the last cached bar (t6), never the already-cached head.
    expect(fetchedSince.length).toBeGreaterThan(0);
    expect(fetchedSince[0]).toBe(t0 + 6 * TF_MS);
    // It never re-fetched from the cached head (t0).
    expect(fetchedSince).not.toContain(t0);
  });

  test("empty cache fetches the whole range", async () => {
    const t0 = 1_700_000_000_000;
    const { exchange, fetchedSince } = makeMockExchange(t0, 20);

    const out = await ensureDataset({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: t0,
      until: t0 + 19 * TF_MS,
    });

    expect(out.length).toBe(20);
    expect(fetchedSince[0]).toBe(t0);
  });

  test("head gap: request starts before cached window → head sub-range fetched", async () => {
    const t0 = 1_700_000_000_000;
    // Cache the LATER portion t5..t10.
    const bars = Array.from({ length: 6 }, (_, i) => cached(t0 + (i + 5) * TF_MS));
    upsertCandles(VENUE, "BTC/USDT", "1h", bars);

    const { exchange, fetchedSince } = makeMockExchange(t0, 11);
    const out = await ensureDataset({
      exchange,
      symbol: "BTC/USDT",
      timeframe: "1h",
      since: t0,
      until: t0 + 10 * TF_MS,
    });

    expect(out.length).toBe(11);
    // Head sub-range begins at the requested start.
    expect(fetchedSince).toContain(t0);
  });
});
