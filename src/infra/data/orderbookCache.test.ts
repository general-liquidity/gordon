import { afterAll, afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  upsertOrderbookSnapshot,
  readOrderbookSnapshot,
  listOrderbookSnapshots,
  countOrderbookSnapshots,
  pruneOrderbookCacheBefore,
  _resetOrderbookCacheForTests,
  type OrderbookSnapshot,
} from "./orderbookCache.ts";
import {
  setDatabasePathForTesting,
  closeDatabase,
} from "../storage/database.ts";
import { unlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let counter = 0;
let currentDbPath = "";
const cleanupPaths = new Set<string>();

function safeUnlink(path: string): void {
  try { if (existsSync(path)) unlinkSync(path); } catch { /* Windows-busy */ }
}

function snap(overrides: Partial<OrderbookSnapshot> = {}): OrderbookSnapshot {
  return {
    venue: "binance",
    symbol: "BTC/USDT",
    takenAt: 1_000,
    bids: [{ price: 99.0, quantity: 1.0 }, { price: 98.5, quantity: 2.0 }],
    asks: [{ price: 100.0, quantity: 1.5 }, { price: 100.5, quantity: 2.5 }],
    ...overrides,
  };
}

beforeEach(() => {
  counter++;
  currentDbPath = join(tmpdir(), `gordon-orderbook-${process.pid}-${counter}.db`);
  cleanupPaths.add(currentDbPath);
  setDatabasePathForTesting(currentDbPath);
  _resetOrderbookCacheForTests();
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

describe("orderbookCache — write path", () => {
  test("inserts and reads back", () => {
    expect(upsertOrderbookSnapshot(snap())).toBe(true);
    const got = readOrderbookSnapshot("binance", "BTC/USDT");
    expect(got).not.toBeNull();
    expect(got?.bids).toHaveLength(2);
    expect(got?.asks).toHaveLength(2);
    expect(got?.takenAt).toBe(1_000);
  });

  test("dedupes identical (venue, symbol, takenAt)", () => {
    upsertOrderbookSnapshot(snap());
    const second = upsertOrderbookSnapshot(snap());
    expect(second).toBe(false);
    expect(countOrderbookSnapshots("binance", "BTC/USDT")).toBe(1);
  });

  test("isolates venue + symbol", () => {
    upsertOrderbookSnapshot(snap({ venue: "binance" }));
    upsertOrderbookSnapshot(snap({ venue: "coinbase" }));
    upsertOrderbookSnapshot(snap({ symbol: "ETH/USDT" }));
    expect(countOrderbookSnapshots("binance", "BTC/USDT")).toBe(1);
    expect(countOrderbookSnapshots("coinbase", "BTC/USDT")).toBe(1);
    expect(countOrderbookSnapshots("binance", "ETH/USDT")).toBe(1);
  });

  test("rejects empty book", () => {
    expect(upsertOrderbookSnapshot(snap({ bids: [], asks: [] }))).toBe(false);
  });

  test("filters out malformed levels but accepts the rest", () => {
    expect(
      upsertOrderbookSnapshot(
        snap({
          bids: [
            { price: 99, quantity: 1 },
            { price: NaN, quantity: 1 } as { price: number; quantity: number },
          ],
        }),
      ),
    ).toBe(true);
    const got = readOrderbookSnapshot("binance", "BTC/USDT");
    expect(got?.bids).toHaveLength(1);
  });

  test("normalizes symbol case", () => {
    upsertOrderbookSnapshot(snap({ symbol: "btc/usdt" }));
    expect(countOrderbookSnapshots("binance", "BTC/USDT")).toBe(1);
  });
});

describe("orderbookCache — read path", () => {
  test("reads most-recent before atOrBeforeTakenAt", () => {
    upsertOrderbookSnapshot(snap({ takenAt: 1_000 }));
    upsertOrderbookSnapshot(snap({ takenAt: 2_000 }));
    upsertOrderbookSnapshot(snap({ takenAt: 3_000 }));
    const got = readOrderbookSnapshot("binance", "BTC/USDT", { atOrBeforeTakenAt: 2_500 });
    expect(got?.takenAt).toBe(2_000);
  });

  test("returns null on cache miss", () => {
    expect(readOrderbookSnapshot("binance", "BTC/USDT")).toBeNull();
  });

  test("listOrderbookSnapshots returns window ascending", () => {
    upsertOrderbookSnapshot(snap({ takenAt: 3_000 }));
    upsertOrderbookSnapshot(snap({ takenAt: 1_000 }));
    upsertOrderbookSnapshot(snap({ takenAt: 2_000 }));
    const out = listOrderbookSnapshots("binance", "BTC/USDT");
    expect(out.map((s) => s.takenAt)).toEqual([1_000, 2_000, 3_000]);
  });

  test("listOrderbookSnapshots respects fromTakenAt + toTakenAt", () => {
    for (const t of [1_000, 2_000, 3_000, 4_000, 5_000]) {
      upsertOrderbookSnapshot(snap({ takenAt: t }));
    }
    const out = listOrderbookSnapshots("binance", "BTC/USDT", {
      fromTakenAt: 2_000,
      toTakenAt: 4_000,
    });
    expect(out.map((s) => s.takenAt)).toEqual([2_000, 3_000, 4_000]);
  });
});

describe("orderbookCache — asOfStoredAt replay", () => {
  test("excludes snapshots stored after cutoff", async () => {
    upsertOrderbookSnapshot(snap({ takenAt: 1_000 }));
    await new Promise((r) => setTimeout(r, 5));
    const cutoff = Date.now();
    await new Promise((r) => setTimeout(r, 5));
    upsertOrderbookSnapshot(snap({ takenAt: 2_000 }));

    const replay = readOrderbookSnapshot("binance", "BTC/USDT", { asOfStoredAt: cutoff });
    expect(replay?.takenAt).toBe(1_000);

    const live = readOrderbookSnapshot("binance", "BTC/USDT");
    expect(live?.takenAt).toBe(2_000);
  });

  test("past asOf returns null", () => {
    upsertOrderbookSnapshot(snap());
    expect(
      readOrderbookSnapshot("binance", "BTC/USDT", { asOfStoredAt: Date.now() - 1_000_000 }),
    ).toBeNull();
  });
});

describe("orderbookCache — prune", () => {
  test("drops rows stored before threshold", async () => {
    upsertOrderbookSnapshot(snap({ takenAt: 1_000 }));
    await new Promise((r) => setTimeout(r, 10));
    const cutoff = Date.now();
    await new Promise((r) => setTimeout(r, 10));
    upsertOrderbookSnapshot(snap({ takenAt: 2_000 }));

    const removed = pruneOrderbookCacheBefore(cutoff);
    expect(removed).toBe(1);
    expect(countOrderbookSnapshots("binance", "BTC/USDT")).toBe(1);
  });
});
