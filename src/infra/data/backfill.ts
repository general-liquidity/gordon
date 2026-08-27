/**
 * Deep-history OHLCV backfill ingester.
 *
 * `exchange.getCandles(symbol, tf, limit, since)` (CCXT fetchOHLCV under the
 * hood) caps a single call at ~500-1000 candles. Multi-year history needs a
 * paginated loop that walks `since` forward one page at a time. This module
 * is the loop — READ-ONLY (only getCandles is ever called), resumable
 * (persists each page to ohlcvCache before advancing the cursor, so a crash
 * mid-run loses at most one page), and defensively capped (maxCandles /
 * maxPages so a bad range can't run forever).
 *
 * On completion it registers/updates a dataset row in the systematic store
 * (start/end/count/quality) so dataset-first backtest reads can find it.
 *
 * Pattern note: this is the WRITE side of the ArcticDB-style cache; the READ
 * side (readCandles) and the gap-fill orchestration (ensureDataset, in
 * systematic/service.ts) build on top of what this persists.
 */

import type { Exchange } from "../exchange/types.ts";
import { createModuleLogger } from "../logger/index.ts";
import { readCandles, upsertCandles, type CachedCandle } from "./ohlcvCache.ts";
import { saveDatasetRecord } from "../domain/systematic/store.ts";
import { scoreDatasetQuality } from "../domain/systematic/service.ts";
import type { DatasetRecord, MarketFamily } from "../domain/systematic/types.ts";

const logger = createModuleLogger("backfill");

/** Candles requested per page. CCXT venues cap fetchOHLCV around 500-1000;
 *  1000 is the common ceiling, and venues that return fewer simply do. */
export const MAX_LIMIT = 1000;

/** Hard ceiling on total candles a single backfill can pull — guards a
 *  mis-specified range (e.g. 1m bars over 5 years) from running forever. */
export const DEFAULT_MAX_CANDLES = 200_000;

/** Minimum inter-page delay (ms) when the exchange's own rateLimit is unknown
 *  or smaller. Keeps us polite to public endpoints even without keys. */
const MIN_PAGE_DELAY_MS = 250;

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

function timeframeMs(timeframe: string): number {
  return TIMEFRAME_MS[timeframe] ?? TIMEFRAME_MS["1h"]!;
}

export interface BackfillOptions {
  exchange: Exchange;
  symbol: string;
  timeframe: string;
  /** Range start, ms epoch. The cursor begins here and walks forward. */
  since: number;
  /** Range end, ms epoch. Defaults to now. */
  until?: number;
  /** Defensive cap on total candles fetched. Default DEFAULT_MAX_CANDLES. */
  maxCandles?: number;
  /** Per-page progress callback — receives the running fetched count. */
  onProgress?: (fetched: number) => void;
}

export interface BackfillResult {
  /** Total distinct candles fetched (after de-dup) within the range. */
  candles: number;
  /** Number of detected gaps (missing-bar runs) vs expected cadence. */
  gaps: number;
  /** First bar open-time actually fetched, ms epoch (0 when none). */
  from: number;
  /** Last bar open-time actually fetched, ms epoch (0 when none). */
  to: number;
  /** Pages requested from the exchange. */
  pages: number;
  /** Dataset row id registered in the systematic store (null when no data). */
  datasetId: string | null;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** CCXT exposes `rateLimit` (ms between calls) on the underlying client; the
 *  CcxtAdapter doesn't surface it on the Exchange interface, so probe it
 *  defensively and fall back to the polite minimum. */
function pageDelayMs(exchange: Exchange): number {
  const probed = exchange as { rateLimit?: number; client?: { rateLimit?: number } };
  const rl = probed.rateLimit ?? probed.client?.rateLimit;
  return Math.max(Number.isFinite(rl) ? Number(rl) : 0, MIN_PAGE_DELAY_MS);
}

/**
 * Paginated deep-history backfill. Walks `since` forward page-by-page until
 * `until`/now is reached or a page returns fewer than 2 candles (no further
 * progress possible). Persists each page to ohlcvCache before advancing the
 * cursor (crash-safe), then registers a dataset record on completion.
 *
 * READ-ONLY: only `exchange.getCandles` is ever invoked.
 */
export async function backfillOHLCV(opts: BackfillOptions): Promise<BackfillResult> {
  const symbol = opts.symbol.trim();
  const timeframe = opts.timeframe.trim();
  const venue = opts.exchange.exchangeId;
  const tfMs = timeframeMs(timeframe);
  const until = opts.until ?? Date.now();
  const maxCandles = Math.max(1, opts.maxCandles ?? DEFAULT_MAX_CANDLES);
  const delay = pageDelayMs(opts.exchange);

  let cursor = opts.since;
  let pages = 0;
  let fetched = 0;
  let from = 0;
  let to = 0;
  // Last bar open-time we've already accepted — the de-dupe / advance anchor.
  let lastAcceptedTs = -1;

  while (cursor <= until && fetched < maxCandles) {
    pages += 1;
    const page = await opts.exchange.getCandles(symbol, timeframe, MAX_LIMIT, cursor);

    // < 2 candles means the venue has nothing further to give from this
    // cursor (a single bar is usually just the cursor bar echoed back).
    if (!page || page.length < 2) break;

    let pageAccepted = 0;
    const toPersist: CachedCandle[] = [];
    for (const c of page) {
      const ts = c.openTime;
      if (!Number.isFinite(ts)) continue;
      if (ts <= lastAcceptedTs) continue; // de-dupe overlap from since-alignment
      if (ts > until) continue;
      toPersist.push({
        openTime: ts,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
        closeTime: c.closeTime,
      });
      lastAcceptedTs = ts;
      if (from === 0) from = ts;
      to = ts;
      pageAccepted += 1;
    }

    if (toPersist.length > 0) {
      // Persist BEFORE advancing the cursor so a crash resumes cleanly.
      upsertCandles(venue, symbol, timeframe, toPersist);
      fetched += pageAccepted;
      opts.onProgress?.(fetched);
    }

    // Advance the cursor to one timeframe past the last bar this venue
    // returned (use the raw last page bar, not lastAcceptedTs, so a page
    // entirely above `until` still terminates the loop on the next check).
    const lastPageTs = page[page.length - 1]!.openTime;
    const nextCursor = lastPageTs + tfMs;
    if (nextCursor <= cursor) break; // no forward progress — venue stalled
    cursor = nextCursor;

    // If the venue handed back a short page (fewer than we asked for AND
    // nothing new was accepted), we've drained available history.
    if (pageAccepted === 0 && page.length < MAX_LIMIT) break;

    if (cursor <= until && fetched < maxCandles) {
      await sleep(delay);
    }
  }

  const gaps = countGaps(venue, symbol, timeframe, from, to, tfMs);
  const datasetId =
    fetched > 0
      ? registerDataset({ venue, symbol, timeframe, from, to, candles: fetched, tfMs })
      : null;

  logger.info("Backfill complete", {
    venue,
    symbol,
    timeframe,
    candles: String(fetched),
    pages: String(pages),
    gaps: String(gaps),
  });

  return { candles: fetched, gaps, from, to, pages, datasetId };
}

/** Count missing-bar runs over the persisted range by reading back what we
 *  just wrote and comparing successive open-times against the cadence. */
function countGaps(
  venue: string,
  symbol: string,
  timeframe: string,
  from: number,
  to: number,
  tfMs: number,
): number {
  if (from === 0 || to <= from) return 0;
  const rows = readCandles(venue, symbol, timeframe, { fromTs: from, toTs: to });
  let gaps = 0;
  for (let i = 1; i < rows.length; i += 1) {
    const delta = rows[i]!.openTime - rows[i - 1]!.openTime;
    if (delta > tfMs * 1.5) gaps += 1;
  }
  return gaps;
}

function marketFamilyForVenue(): MarketFamily {
  // Backfill currently runs against crypto exchanges (CCXT). Brokers fetch
  // via their own historical path; if a backfill is ever wired for stocks
  // this is the single place to branch.
  return "crypto";
}

function registerDataset(params: {
  venue: string;
  symbol: string;
  timeframe: string;
  from: number;
  to: number;
  candles: number;
  tfMs: number;
}): string {
  const { venue, symbol, timeframe, from, to, candles } = params;
  const datasetId = `${venue}:${symbol.toUpperCase()}:${timeframe}:${from}:${to}`;
  const now = new Date().toISOString();

  // Re-read the persisted range to score quality on real cached bars rather
  // than the in-flight page buffer — keeps the quality figure consistent
  // with what a later dataset-first read will actually load.
  const rows = readCandles(venue, symbol, timeframe, { fromTs: from, toTs: to });
  const quality = scoreDatasetQuality(
    rows.map((r) => ({
      timestamp: r.openTime,
      open: r.open,
      high: r.high,
      low: r.low,
      close: r.close,
      volume: r.volume,
    })),
    timeframe,
    from,
    to,
  );

  const record: DatasetRecord = {
    datasetId,
    kind: "raw_ohlc",
    marketFamily: marketFamilyForVenue(),
    symbol: symbol.toUpperCase(),
    timeframe,
    sourceId: venue,
    sourceKind: "cache",
    startTime: from,
    endTime: to,
    candleCount: candles,
    quality,
    createdAt: now,
    updatedAt: now,
  };
  saveDatasetRecord(record);
  return datasetId;
}
