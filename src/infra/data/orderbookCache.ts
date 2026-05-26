/**
 * Orderbook snapshot cache — durable record of orderbook reads.
 *
 * Companion to ohlcvCache.ts. Same ArcticDB-inspired pattern:
 * immutable rows keyed by (venue, symbol, taken_at), each carrying a
 * source hash + stored_at so replay queries can ask "what was the
 * orderbook for SYMBOL at time T as Gordon saw it?"
 *
 * Orderbook volume is bounded by sample rate (one row per
 * `get_market_data({dataType:'orderbook'})` call), not by venue tick
 * rate — so this stays cheap regardless of market activity. Trade /
 * tick storage was considered separately and deferred until a
 * concrete tick-level use case lands; the volume profile is materially
 * different there.
 */

import { createHash } from "node:crypto";
import {
  getDatabase,
  executeWithLogging,
} from "../storage/database.ts";

let tableInitialized = false;

export interface OrderbookLevel {
  price: number;
  quantity: number;
}

export interface OrderbookSnapshot {
  venue: string;
  symbol: string;
  /** ms epoch when Gordon captured this snapshot from the venue. */
  takenAt: number;
  bids: OrderbookLevel[];
  asks: OrderbookLevel[];
}

export interface StoredOrderbookSnapshot extends OrderbookSnapshot {
  storedAt: number;
  sourceHash: string;
}

function ensureTable(): void {
  if (tableInitialized) return;
  const db = getDatabase();
  executeWithLogging(
    () =>
      db.run(`
        CREATE TABLE IF NOT EXISTS orderbook_snapshots (
          venue       TEXT NOT NULL,
          symbol      TEXT NOT NULL,
          taken_at    INTEGER NOT NULL,
          bids_json   TEXT NOT NULL,
          asks_json   TEXT NOT NULL,
          stored_at   INTEGER NOT NULL,
          source_hash TEXT NOT NULL,
          PRIMARY KEY (venue, symbol, taken_at)
        )
      `),
    "CREATE TABLE orderbook_snapshots",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_orderbook_stored_at ON orderbook_snapshots(stored_at)",
      ),
    "CREATE INDEX idx_orderbook_stored_at",
  );
  executeWithLogging(
    () =>
      db.run(
        "CREATE INDEX IF NOT EXISTS idx_orderbook_lookup ON orderbook_snapshots(venue, symbol, taken_at)",
      ),
    "CREATE INDEX idx_orderbook_lookup",
  );
  tableInitialized = true;
}

export function _resetOrderbookCacheForTests(): void {
  tableInitialized = false;
  try {
    const db = getDatabase();
    db.run("DROP TABLE IF EXISTS orderbook_snapshots");
  } catch {
    // Table didn't exist — nothing to drop.
  }
}

function hashLevels(bids: OrderbookLevel[], asks: OrderbookLevel[]): string {
  const payload = JSON.stringify({
    b: bids.map((l) => [l.price, l.quantity]),
    a: asks.map((l) => [l.price, l.quantity]),
  });
  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}

function isValidLevel(l: unknown): l is OrderbookLevel {
  if (!l || typeof l !== "object") return false;
  const r = l as Record<string, unknown>;
  return Number.isFinite(r.price) && Number.isFinite(r.quantity);
}

/** Append a snapshot. INSERT OR IGNORE — first writer wins on the
 *  exact (venue, symbol, taken_at) tuple. Silently no-ops on
 *  malformed level arrays. */
export function upsertOrderbookSnapshot(snap: OrderbookSnapshot): boolean {
  ensureTable();
  const venue = snap.venue.trim();
  const symbol = snap.symbol.trim().toUpperCase();
  if (!venue || !symbol || !Number.isFinite(snap.takenAt)) return false;
  if (!Array.isArray(snap.bids) || !Array.isArray(snap.asks)) return false;
  const bids = snap.bids.filter(isValidLevel);
  const asks = snap.asks.filter(isValidLevel);
  if (bids.length === 0 || asks.length === 0) return false;

  const hash = hashLevels(bids, asks);
  const now = Date.now();
  const db = getDatabase();
  const info = db.run(
    "INSERT OR IGNORE INTO orderbook_snapshots (venue, symbol, taken_at, bids_json, asks_json, stored_at, source_hash) VALUES (?, ?, ?, ?, ?, ?, ?)",
    [
      venue,
      symbol,
      snap.takenAt,
      JSON.stringify(bids),
      JSON.stringify(asks),
      now,
      hash,
    ],
  );
  return ((info as { changes?: number }).changes ?? 0) > 0;
}

export interface ReadOrderbookOptions {
  /** Replay cutoff — only rows with stored_at <= asOfStoredAt are
   *  considered. The most-recent (highest taken_at) row before the
   *  cutoff is returned. */
  asOfStoredAt?: number;
  /** Take the most recent snapshot whose taken_at <= this value. */
  atOrBeforeTakenAt?: number;
}

/** Read the single most-recent orderbook snapshot for (venue, symbol)
 *  matching the constraints. Returns null on cache miss. Snapshots
 *  are point-in-time by design — callers usually want THE current
 *  view, not a window. Use listOrderbookSnapshots for a window. */
export function readOrderbookSnapshot(
  venue: string,
  symbol: string,
  opts: ReadOrderbookOptions = {},
): StoredOrderbookSnapshot | null {
  ensureTable();
  const v = venue.trim();
  const s = symbol.trim().toUpperCase();
  if (!v || !s) return null;
  const where: string[] = ["venue = ?", "symbol = ?"];
  const params: Array<string | number> = [v, s];
  if (Number.isFinite(opts.asOfStoredAt)) {
    where.push("stored_at <= ?");
    params.push(opts.asOfStoredAt!);
  }
  if (Number.isFinite(opts.atOrBeforeTakenAt)) {
    where.push("taken_at <= ?");
    params.push(opts.atOrBeforeTakenAt!);
  }
  const sql =
    "SELECT venue, symbol, taken_at, bids_json, asks_json, stored_at, source_hash FROM orderbook_snapshots WHERE " +
    where.join(" AND ") +
    " ORDER BY taken_at DESC LIMIT 1";
  const db = getDatabase();
  const row = db
    .query<
      {
        venue: string;
        symbol: string;
        taken_at: number;
        bids_json: string;
        asks_json: string;
        stored_at: number;
        source_hash: string;
      },
      Array<string | number>
    >(sql)
    .get(...params);
  if (!row) return null;
  return {
    venue: row.venue,
    symbol: row.symbol,
    takenAt: row.taken_at,
    bids: JSON.parse(row.bids_json) as OrderbookLevel[],
    asks: JSON.parse(row.asks_json) as OrderbookLevel[],
    storedAt: row.stored_at,
    sourceHash: row.source_hash,
  };
}

export interface ListOrderbookOptions {
  fromTakenAt?: number;
  toTakenAt?: number;
  asOfStoredAt?: number;
  limit?: number;
}

/** Read a window of snapshots sorted by taken_at ASC. Useful for
 *  microstructure backtests or replay of a sequence of book states. */
export function listOrderbookSnapshots(
  venue: string,
  symbol: string,
  opts: ListOrderbookOptions = {},
): StoredOrderbookSnapshot[] {
  ensureTable();
  const v = venue.trim();
  const s = symbol.trim().toUpperCase();
  if (!v || !s) return [];
  const where: string[] = ["venue = ?", "symbol = ?"];
  const params: Array<string | number> = [v, s];
  if (Number.isFinite(opts.fromTakenAt)) {
    where.push("taken_at >= ?");
    params.push(opts.fromTakenAt!);
  }
  if (Number.isFinite(opts.toTakenAt)) {
    where.push("taken_at <= ?");
    params.push(opts.toTakenAt!);
  }
  if (Number.isFinite(opts.asOfStoredAt)) {
    where.push("stored_at <= ?");
    params.push(opts.asOfStoredAt!);
  }
  let sql =
    "SELECT venue, symbol, taken_at, bids_json, asks_json, stored_at, source_hash FROM orderbook_snapshots WHERE " +
    where.join(" AND ") +
    " ORDER BY taken_at ASC";
  if (Number.isFinite(opts.limit)) {
    sql += " LIMIT ?";
    params.push(opts.limit!);
  }
  const db = getDatabase();
  const rows = db
    .query<
      {
        venue: string;
        symbol: string;
        taken_at: number;
        bids_json: string;
        asks_json: string;
        stored_at: number;
        source_hash: string;
      },
      Array<string | number>
    >(sql)
    .all(...params);
  return rows.map((row) => ({
    venue: row.venue,
    symbol: row.symbol,
    takenAt: row.taken_at,
    bids: JSON.parse(row.bids_json) as OrderbookLevel[],
    asks: JSON.parse(row.asks_json) as OrderbookLevel[],
    storedAt: row.stored_at,
    sourceHash: row.source_hash,
  }));
}

export function countOrderbookSnapshots(venue: string, symbol: string): number {
  ensureTable();
  const v = venue.trim();
  const s = symbol.trim().toUpperCase();
  if (!v || !s) return 0;
  const db = getDatabase();
  const row = db
    .query<{ n: number }, [string, string]>(
      "SELECT COUNT(*) AS n FROM orderbook_snapshots WHERE venue = ? AND symbol = ?",
    )
    .get(v, s);
  return row?.n ?? 0;
}

/** Admin helper — drop snapshots stored_at < threshold. */
export function pruneOrderbookCacheBefore(thresholdMs: number): number {
  ensureTable();
  const db = getDatabase();
  const result = db.run(
    "DELETE FROM orderbook_snapshots WHERE stored_at < ?",
    [thresholdMs],
  );
  return (result as { changes?: number }).changes ?? 0;
}
