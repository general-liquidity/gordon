/**
 * Candle Fetcher (Public API, No Auth)
 *
 * Lightweight helper for proactive producers that need OHLC candles without
 * depending on Gordon's connected-exchange singleton or a specific historical
 * data client. Uses Binance's public klines endpoint — no API key needed,
 * standard rate limits (~1200 req/min weighted).
 *
 * Why a separate fetcher? Producers run on a periodic tick and need to work
 * even when Gordon isn't connected to a specific venue. Binance public data
 * is available to anyone and covers every major crypto symbol. For non-
 * crypto symbols the fetch will fail gracefully and the producer returns [].
 */

import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("proactive-candle-fetch");

export interface ProactiveCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Small in-memory cache so multiple producers on the same tick don't thrash
// the API for the same candles.
interface CacheEntry {
  fetchedAt: number;
  candles: ProactiveCandle[];
}
const candleCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute — fresh enough for 15min+ producers

const BINANCE_TIMEFRAME_MAP: Record<string, string> = {
  "1m": "1m", "5m": "5m", "15m": "15m", "30m": "30m",
  "1h": "1h", "4h": "4h", "1d": "1d",
};

/**
 * Fetch recent OHLC candles for a symbol from Binance public API.
 * Symbol should be in exchange format (BTCUSDT, ETHUSDT, SOLUSDT).
 * Returns an empty array on any failure — producers should treat as "no data".
 */
export async function fetchRecentCandles(
  symbol: string,
  timeframe: string,
  limit: number,
): Promise<ProactiveCandle[]> {
  const interval = BINANCE_TIMEFRAME_MAP[timeframe] ?? "1h";
  const normalized = normalizeSymbol(symbol);
  const cacheKey = `${normalized}:${interval}:${limit}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.candles;
  }

  const url = `https://api.binance.com/api/v3/klines?symbol=${normalized}&interval=${interval}&limit=${Math.min(Math.max(limit, 1), 1000)}`;
  try {
    const res = await fetch(url, {
      signal: AbortSignal.timeout(10_000),
      headers: { "User-Agent": "gordon-cli/0.7" },
    });
    if (!res.ok) {
      logger.debug("Binance klines returned non-OK", { symbol: normalized, status: res.status });
      return [];
    }
    const raw = (await res.json()) as Array<[
      number, string, string, string, string, string, number, ...unknown[]
    ]>;

    const candles: ProactiveCandle[] = raw.map((row) => ({
      timestamp: row[0],
      open: Number(row[1]),
      high: Number(row[2]),
      low: Number(row[3]),
      close: Number(row[4]),
      volume: Number(row[5]),
    }));

    candleCache.set(cacheKey, { fetchedAt: Date.now(), candles });
    // Trim cache if it grows large
    if (candleCache.size > 50) {
      const oldestKey = candleCache.keys().next().value;
      if (oldestKey) candleCache.delete(oldestKey);
    }
    return candles;
  } catch (err) {
    logger.debug("Binance candle fetch failed", { symbol: normalized, err: String(err) });
    return [];
  }
}

function normalizeSymbol(symbol: string): string {
  // Already exchange-format
  if (/^[A-Z]{3,12}USDT?$/.test(symbol)) return symbol.toUpperCase();
  // Strip common prefixes and append USDT
  const upper = symbol.toUpperCase().replace(/[-/_]/g, "");
  if (upper.endsWith("USDT") || upper.endsWith("USD")) return upper;
  return `${upper}USDT`;
}

/**
 * Default watchlist used by producers when no active positions exist.
 * Kept short — three core liquid symbols.
 */
export const DEFAULT_WATCHLIST: readonly string[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

/**
 * Resolve the set of symbols a producer should monitor. Tries to pull active
 * symbols from the Gordon position store; falls back to DEFAULT_WATCHLIST if
 * the store isn't accessible or is empty. Always dedupes and caps at 10 so a
 * bloated portfolio doesn't hammer the public API.
 */
export async function resolveMonitoredSymbols(): Promise<string[]> {
  const symbols = new Set<string>(DEFAULT_WATCHLIST);
  try {
    // Dynamic import so producers don't fail to load if the store moves.
    const mod = await import("../../../core/positions/store.ts" as string) as {
      getPositionStore?: () => Promise<{ getActive: () => Promise<Array<{ symbol: string }>> }>;
    };
    if (typeof mod.getPositionStore === "function") {
      const store = await mod.getPositionStore();
      const positions = await store.getActive();
      for (const p of positions) {
        if (p.symbol) symbols.add(normalizeSymbol(p.symbol));
      }
    }
  } catch {
    // Position store unavailable — fall back to defaults
  }
  return [...symbols].slice(0, 10);
}
