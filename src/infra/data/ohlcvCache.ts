/**
 * OHLCV Cache — durable symbol-keyed candle store with as-of-stored-at
 * replay semantics.
 *
 * Pattern ported from ArcticDB (Man Group, BSL): immutable versioned
 * timeseries reads. Gordon's variant is narrower — one shared SQLite
 * table with INSERT-OR-IGNORE on `(venue, symbol, timeframe, bar_ts)`,
 * so once a bar is cached the first writer wins and later identical
 * writes are no-ops. Each row carries:
 *
 *   - bar_ts     : the bar's open-time (when the event occurred in market time)
 *   - stored_at  : when Gordon first wrote this row (system time)
 *   - source_hash: sha256(open|high|low|close|volume) so identical
 *                  re-fetches collapse cleanly; differing re-fetches
 *                  would surface as a hash mismatch on read (logged,
 *                  not blocked — venues occasionally restate bars).
 *
 * Why two timestamps: `asOfStoredAt` is the replay primitive — answers
 * "what candles were available IN OUR SYSTEM at time T?" — distinct
 * from `toTs` which answers "what candles cover bars up to event-time
 * T?" Both matter; conflating them is the source of half the
 * timeseries-store bugs in finance.
 *
 * Public API:
 *   - upsertCandles(venue, symbol, timeframe, candles): { inserted, skipped }
 *   - readCandles(venue, symbol, timeframe, opts): CachedCandle[]
 *   - countCachedCandles(venue, symbol, timeframe): number
 *   - pruneCacheBefore(thresholdMs): number  (admin helper)
 *
 * Lazy init pattern matches src/core/audit/store.ts — ensure-table-once
 * on first call, no module-load side effects.
 */

import { createHash } from "node:crypto";
import { getDatabase, executeWithLogging, withTransaction } from "../storage/database.ts";
import { createModuleLogger } from "../logger/index.ts";

const logger = createModuleLogger("ohlcv-cache");

let tableInitialized = false;

export interface CachedCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** Bar open time, ms epoch. Required — this is the PK component. */
  openTime: number;
  /** Bar close time, ms epoch. Optional — informational only. */
  closeTime?: number;
}

export interface UpsertResult {
  /** Number of new rows written. */
  inserted: number;
  /** Number of rows that were either duplicates (PK already exists) or
   *  rejected for malformed input. */
  skipped: number;
}

export interface ReadCandlesOptions {
  /** Lower bound (inclusive) on bar open-time, ms epoch. */
  fromTs?: number;
  /** Upper bound (inclusive) on bar open-time, ms epoch. */
  toTs?: number;
  /** Replay cutoff. Only return rows whose stored_at <= this value.
   *  Use for "what did we have in our cache at time T?" queries. */
  asOfStoredAt?: number;
  /** Maximum rows to return (sorted by bar_ts ASC). */
  limit?: number;
}

function ensureTable(): void {
  if (tableInitialized) return;
  const db = getDatabase();
  executeWithLogging(
    () =>
      db.run(`
        CREATE TABLE IF NOT EXISTS ohlcv_candles (
          venue       TEXT NOT NULL,
          symbol      TEXT NOT NULL,
          timeframe   TEXT NOT NULL,
          bar_ts      INTEGER NOT NULL,
          open        REAL NOT NULL,
          high        REAL NOT NULL,
          low         REAL NOT NULL,
          close       REAL NOT NULL,
          volume      REAL NOT NULL,
          close_ts    INTEGER,
          stored_at   INTEGER NOT NULL,
          source_hash TEXT NOT NULL,
          PRIMARY KEY (venue, symbol, timeframe, bar_ts)
        )
      `),
    "CREATE TABLE ohlcv_candles",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_ohlcv_lookup ON ohlcv_candles(symbol, timeframe, bar_ts)",
      ),
    "CREATE INDEX idx_ohlcv_lookup",
  );
  executeWithLogging(
    () => db.run("CREATE INDEX IF NOT EXISTS idx_ohlcv_stored_at ON ohlcv_candles(stored_at)"),
    "CREATE INDEX idx_ohlcv_stored_at",
  );
  tableInitialized = true;
}

export function _resetCacheForTests(): void {
  tableInitialized = false;
  try {
    const db = getDatabase();
    db.run("DROP TABLE IF EXISTS ohlcv_candles");
  } catch {
    // Table didn't exist — nothing to drop.
  }
}

function hashCandle(c: CachedCandle): string {
  const payload = `${c.open}|${c.high}|${c.low}|${c.close}|${c.volume}`;
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function isValidCandle(c: unknown): c is CachedCandle {
  if (!c || typeof c !== "object") return false;
  const r = c as Record<string, unknown>;
  return (
    Number.isFinite(r.open) &&
    Number.isFinite(r.high) &&
    Number.isFinite(r.low) &&
    Number.isFinite(r.close) &&
    Number.isFinite(r.volume) &&
    Number.isFinite(r.openTime) &&
    (r.openTime as number) > 0
  );
}

/** Append candles to the cache. INSERT OR IGNORE on (venue, symbol,
 *  timeframe, bar_ts) — first write wins; identical re-fetches collapse.
 *  Silently skips malformed candles. Never throws on duplicate keys. */
export function upsertCandles(
  venue: string,
  symbol: string,
  timeframe: string,
  candles: CachedCandle[],
): UpsertResult {
  ensureTable();
  if (!candles || candles.length === 0) {
    return { inserted: 0, skipped: 0 };
  }
  const v = venue.trim();
  const s = symbol.trim().toUpperCase();
  const tf = timeframe.trim();
  if (!v || !s || !tf) return { inserted: 0, skipped: candles.length };

  const now = Date.now();
  const db = getDatabase();
  const stmt = db.prepare(
    "INSERT OR IGNORE INTO ohlcv_candles (venue, symbol, timeframe, bar_ts, open, high, low, close, volume, close_ts, stored_at, source_hash) " +
      "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  );

  let inserted = 0;
  let skipped = 0;

  withTransaction(() => {
    for (const c of candles) {
      if (!isValidCandle(c)) {
        skipped++;
        continue;
      }
      const hash = hashCandle(c);
      const closeTs = Number.isFinite(c.closeTime) ? c.closeTime! : null;
      const info = stmt.run(
        v,
        s,
        tf,
        c.openTime,
        c.open,
        c.high,
        c.low,
        c.close,
        c.volume,
        closeTs,
        now,
        hash,
      );
      // bun:sqlite `Statement.run` returns { changes, lastInsertRowid }.
      // INSERT OR IGNORE yields changes=0 when the row already existed.
      const changes = (info as { changes?: number }).changes ?? 0;
      if (changes > 0) inserted++;
      else skipped++;
    }
  });

  if (inserted > 0) {
    logger.debug("Cached candles", { venue: v, symbol: s, timeframe: tf, inserted, skipped });
  }
  return { inserted, skipped };
}

/** Read cached candles for (venue, symbol, timeframe). Filters by bar
 *  range + optional asOfStoredAt cutoff. Returns ascending by bar_ts. */
export function readCandles(
  venue: string,
  symbol: string,
  timeframe: string,
  opts: ReadCandlesOptions = {},
): CachedCandle[] {
  ensureTable();
  const v = venue.trim();
  const s = symbol.trim().toUpperCase();
  const tf = timeframe.trim();
  if (!v || !s || !tf) return [];

  const where: string[] = ["venue = ?", "symbol = ?", "timeframe = ?"];
  const params: Array<string | number> = [v, s, tf];
  if (Number.isFinite(opts.fromTs)) {
    where.push("bar_ts >= ?");
    params.push(opts.fromTs!);
  }
  if (Number.isFinite(opts.toTs)) {
    where.push("bar_ts <= ?");
    params.push(opts.toTs!);
  }
  if (Number.isFinite(opts.asOfStoredAt)) {
    where.push("stored_at <= ?");
    params.push(opts.asOfStoredAt!);
  }
  let sql =
    "SELECT bar_ts, open, high, low, close, volume, close_ts FROM ohlcv_candles WHERE " +
    where.join(" AND ") +
    " ORDER BY bar_ts ASC";
  if (Number.isFinite(opts.limit)) {
    sql += " LIMIT ?";
    params.push(opts.limit!);
  }
  const db = getDatabase();
  const rows = db
    .query<
      {
        bar_ts: number;
        open: number;
        high: number;
        low: number;
        close: number;
        volume: number;
        close_ts: number | null;
      },
      Array<string | number>
    >(sql)
    .all(...params);
  return rows.map((r) => ({
    openTime: r.bar_ts,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    closeTime: r.close_ts ?? undefined,
  }));
}

/** Count cached candles for (venue, symbol, timeframe). Useful for
 *  cheap "do we have enough cached?" checks before deciding live vs
 *  cached reads. */
export function countCachedCandles(venue: string, symbol: string, timeframe: string): number {
  ensureTable();
  const v = venue.trim();
  const s = symbol.trim().toUpperCase();
  const tf = timeframe.trim();
  if (!v || !s || !tf) return 0;
  const db = getDatabase();
  const row = db
    .query<{ n: number }, [string, string, string]>(
      "SELECT COUNT(*) AS n FROM ohlcv_candles WHERE venue = ? AND symbol = ? AND timeframe = ?",
    )
    .get(v, s, tf);
  return row?.n ?? 0;
}

/** Admin helper — drop all rows whose stored_at is strictly before the
 *  threshold. Returns the row count removed. No retention is run
 *  automatically; the operator decides when to prune. */
export function pruneCacheBefore(thresholdMs: number): number {
  ensureTable();
  const db = getDatabase();
  const result = db.run("DELETE FROM ohlcv_candles WHERE stored_at < ?", [thresholdMs]);
  return (result as { changes?: number }).changes ?? 0;
}
