/**
 * get_candles output filter — keep summary stats + last N candles verbatim.
 *
 * Raw: array of ~100-500 OHLCV candles. Most are middle-of-the-distribution
 * and contribute nothing to the model's decision; only extremes, the recent
 * tail, and regime signals matter.
 *
 * Filter strategy:
 *   - Summary stats (count, time range, open→close move, high/low extremes)
 *   - Last N candles verbatim (default 20)
 *   - Top 3 highest-volume candles (regime-significant)
 *   - Drop the middle
 *
 * Bypass when:
 *   - Input is not an array of candle-shaped objects
 *   - Array length is already small (<= keepRecent + 5)
 *   - Looks like a tool-error envelope
 */

import { passthrough, safeStringifyLength, looksLikeError, type FilterResult } from "./types.ts";

interface Candle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  timestamp?: number | string;
  openTime?: number | string;
  closeTime?: number | string;
  [k: string]: unknown;
}

interface CandlesContainer {
  candles?: unknown;
  data?: unknown;
  klines?: unknown;
}

const KEEP_RECENT = 20;
const KEEP_TOP_VOLUME = 3;
const MIN_FOR_COMPRESSION = KEEP_RECENT + 5; // 25

function isCandle(v: unknown): v is Candle {
  if (typeof v !== "object" || v === null) return false;
  const c = v as Record<string, unknown>;
  return (
    typeof c.open === "number" &&
    typeof c.high === "number" &&
    typeof c.low === "number" &&
    typeof c.close === "number"
  );
}

function pickArray(raw: unknown): Candle[] | null {
  if (Array.isArray(raw) && raw.length > 0 && isCandle(raw[0])) {
    return raw.filter(isCandle);
  }
  if (typeof raw === "object" && raw !== null) {
    const c = raw as CandlesContainer;
    const candidate = c.candles ?? c.data ?? c.klines;
    if (Array.isArray(candidate) && candidate.length > 0 && isCandle(candidate[0])) {
      return candidate.filter(isCandle);
    }
  }
  return null;
}

function timestampOf(c: Candle): number | undefined {
  if (typeof c.timestamp === "number") return c.timestamp;
  if (typeof c.timestamp === "string") {
    const n = Date.parse(c.timestamp);
    return Number.isFinite(n) ? n : undefined;
  }
  if (typeof c.openTime === "number") return c.openTime;
  return undefined;
}

export function filterGetCandles(raw: unknown): FilterResult {
  if (looksLikeError(raw)) return passthrough(raw);
  const arr = pickArray(raw);
  if (!arr) return passthrough(raw);
  if (arr.length < MIN_FOR_COMPRESSION) return passthrough(raw);

  const bytesBefore = safeStringifyLength(raw);

  const first = arr[0]!;
  const last = arr[arr.length - 1]!;
  const opens = arr.map((c) => c.open);
  const closes = arr.map((c) => c.close);
  const highs = arr.map((c) => c.high);
  const lows = arr.map((c) => c.low);
  const volumes = arr.map((c) => (typeof c.volume === "number" ? c.volume : 0));

  const highIdx = highs.indexOf(Math.max(...highs));
  const lowIdx = lows.indexOf(Math.min(...lows));
  const startPrice = opens[0]!;
  const endPrice = closes[closes.length - 1]!;
  const moveFromOpenPct = ((endPrice - startPrice) / startPrice) * 100;

  // Top-volume candles, excluding the recent-tail slice (we already keep those)
  const cutoff = arr.length - KEEP_RECENT;
  const indexedVols = volumes
    .map((v, i) => ({ i, v }))
    .filter((x) => x.i < cutoff)
    .sort((a, b) => b.v - a.v)
    .slice(0, KEEP_TOP_VOLUME);

  const recentTail = arr.slice(-KEEP_RECENT);

  const filtered = {
    summary: {
      count: arr.length,
      firstTimestamp: timestampOf(first) ?? null,
      lastTimestamp: timestampOf(last) ?? null,
      open: startPrice,
      close: endPrice,
      moveFromOpenPct: Number(moveFromOpenPct.toFixed(4)),
      highPrice: highs[highIdx]!,
      highAt: highIdx,
      lowPrice: lows[lowIdx]!,
      lowAt: lowIdx,
      totalVolume: volumes.reduce((s, v) => s + v, 0),
    },
    notableVolumeCandles: indexedVols.map((x) => ({ index: x.i, candle: arr[x.i]! })),
    recentTail: recentTail,
    _meta: {
      filter: "get_candles",
      droppedCount: arr.length - recentTail.length - indexedVols.length,
      note: "summary + top-volume + recent tail. Original is reproducible via fetch.",
    },
  };

  const bytesAfter = safeStringifyLength(filtered);
  return {
    filtered,
    bytesBefore,
    bytesAfter,
    filterTag: `get_candles: ${arr.length}→${recentTail.length + indexedVols.length}`,
  };
}
