/**
 * Candle Fetcher (Public API, No Auth)
 *
 * Lightweight helper for proactive producers that need OHLC candles without
 * depending on Gordon's connected-exchange singleton. Uses the public CCXT
 * adapter (default venue: binance) so producers work even when no venue is
 * authenticated.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { createPublicExchange } from "../../exchange/publicFactory.ts";
import type { ExchangeId } from "../../exchange/types.ts";

const logger = createModuleLogger("proactive-candle-fetch");

export interface ProactiveCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CacheEntry {
  fetchedAt: number;
  candles: ProactiveCandle[];
}
const candleCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 60 * 1000;

const DEFAULT_PUBLIC_VENUE: ExchangeId = "binance";

/**
 * Fetch recent OHLC candles for a symbol via a public CCXT adapter.
 * Returns an empty array on any failure — producers should treat as "no data".
 */
export async function fetchRecentCandles(
  symbol: string,
  timeframe: string,
  limit: number,
  venue: ExchangeId = DEFAULT_PUBLIC_VENUE,
): Promise<ProactiveCandle[]> {
  const normalized = normalizeSymbol(symbol);
  const cacheKey = `${venue}:${normalized}:${timeframe}:${limit}`;
  const cached = candleCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.candles;
  }

  try {
    const exchange = createPublicExchange(venue);
    const raw = await exchange.getCandles(
      normalized,
      timeframe,
      Math.min(Math.max(limit, 1), 1000),
    );

    const candles: ProactiveCandle[] = raw.map((row) => ({
      timestamp: row.openTime,
      open: row.open,
      high: row.high,
      low: row.low,
      close: row.close,
      volume: row.volume,
    }));

    candleCache.set(cacheKey, { fetchedAt: Date.now(), candles });
    if (candleCache.size > 50) {
      const oldestKey = candleCache.keys().next().value;
      if (oldestKey) candleCache.delete(oldestKey);
    }
    return candles;
  } catch (err) {
    logger.debug("Public candle fetch failed", { symbol: normalized, venue, err: String(err) });
    return [];
  }
}

function normalizeSymbol(symbol: string): string {
  if (/^[A-Z]{3,12}USDT?$/.test(symbol)) return symbol.toUpperCase();
  const upper = symbol.toUpperCase().replace(/[-/_]/g, "");
  if (upper.endsWith("USDT") || upper.endsWith("USD")) return upper;
  return `${upper}USDT`;
}

export const DEFAULT_WATCHLIST: readonly string[] = ["BTCUSDT", "ETHUSDT", "SOLUSDT"];

export async function resolveMonitoredSymbols(): Promise<string[]> {
  const symbols = new Set<string>(DEFAULT_WATCHLIST);
  try {
    const mod = (await import("../../../core/positions/store.ts" as string)) as {
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
