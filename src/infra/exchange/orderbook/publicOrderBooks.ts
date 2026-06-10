/**
 * Public order-book fetchers — credential-free read-only access to the
 * top crypto venues for pre-trade cost comparison.
 *
 * All venues route through `createPublicExchange()` (CCXT, no auth).
 * Fee rates are public-knowledge taker baselines.
 */

import type { OrderBook } from "../types.ts";
import { createPublicExchange } from "../publicFactory.ts";
import type { ExchangeId } from "../types.ts";

export type PublicVenue = "binance" | "coinbase" | "kraken" | "okx";

export interface PublicVenueConfig {
  /** Display name for output. */
  label: string;
  /** Taker fee in basis points (1 bp = 0.01%). */
  takerBps: number;
  /** Maker fee in basis points. Currently informational only — preview
   *  flows assume taker fills. */
  makerBps: number;
  /** Translates a generic symbol like "BTCUSDT" into the venue's native
   *  product id (e.g. Coinbase wants "BTC-USD"). */
  toNativeSymbol(symbol: string): string;
  /** Fetches and normalizes the order book. Returns null if the venue
   *  doesn't list this pair. Throws on transport failure. */
  fetchBook(symbol: string, levels: number, signal?: AbortSignal): Promise<OrderBook | null>;
}

async function fetchBookViaCcxt(
  venue: ExchangeId,
  symbol: string,
  levels: number,
  signal?: AbortSignal,
): Promise<OrderBook | null> {
  if (signal?.aborted) return null;
  try {
    const exchange = createPublicExchange(venue);
    const book = await exchange.getOrderBook(symbol, levels);
    return {
      lastUpdateId: book.lastUpdateId,
      bids: book.bids,
      asks: book.asks,
    };
  } catch {
    return null;
  }
}

const binance: PublicVenueConfig = {
  label: "Binance",
  takerBps: 10,
  makerBps: 10,
  toNativeSymbol: (s) => s.toUpperCase().replace(/[\-_/]/g, ""),
  fetchBook: (symbol, levels, signal) => fetchBookViaCcxt("binance", symbol, levels, signal),
};

// ---------- Coinbase --------------------------------------------------------

const coinbase: PublicVenueConfig = {
  label: "Coinbase",
  takerBps: 60, // 0.60% Advanced base taker. Real fees vary by 30-day volume tier.
  makerBps: 40,
  toNativeSymbol: (s) => {
    // BTCUSDT → BTC-USD (Coinbase quotes vs USD/USDT/USDC, "-" separated).
    const upper = s.toUpperCase().replace(/[\-_/]/g, "");
    const fiats = ["USDT", "USDC", "USD", "EUR", "GBP"];
    for (const f of fiats) {
      if (upper.endsWith(f)) {
        const base = upper.slice(0, -f.length);
        // Coinbase prefers USD over USDT for USD-stable pairs.
        const quote = f === "USDT" ? "USD" : f;
        return `${base}-${quote}`;
      }
    }
    return upper;
  },
  fetchBook: (symbol, levels, signal) => fetchBookViaCcxt("coinbase", symbol, levels, signal),
};

// ---------- Kraken ----------------------------------------------------------

const kraken: PublicVenueConfig = {
  label: "Kraken",
  takerBps: 26, // 0.26% spot baseline
  makerBps: 16,
  toNativeSymbol: (s) => {
    // Kraken uses XBT instead of BTC for Bitcoin and a "ZUSD"-ish family
    // for fiat. Their /Depth endpoint accepts the modern ticker form
    // (XBTUSD, ETHUSD), so map BTC↔XBT and drop the T from USDT for
    // non-tether pairs.
    let upper = s.toUpperCase().replace(/[\-_/]/g, "");
    upper = upper.replace(/^BTC/, "XBT");
    if (upper.endsWith("USDT")) upper = upper.slice(0, -4) + "USDT";
    return upper;
  },
  fetchBook: (symbol, levels, signal) => fetchBookViaCcxt("kraken", symbol, levels, signal),
};

// ---------- OKX -------------------------------------------------------------

const okx: PublicVenueConfig = {
  label: "OKX",
  takerBps: 10, // 0.10% spot baseline
  makerBps: 8,
  toNativeSymbol: (s) => {
    // BTCUSDT → BTC-USDT; preserve hyphen if already present.
    if (s.includes("-")) return s.toUpperCase();
    const upper = s.toUpperCase().replace(/[_/]/g, "");
    const fiats = ["USDT", "USDC", "USD"];
    for (const f of fiats) {
      if (upper.endsWith(f)) return `${upper.slice(0, -f.length)}-${f}`;
    }
    return upper;
  },
  fetchBook: (symbol, levels, signal) => fetchBookViaCcxt("okx", symbol, levels, signal),
};

export const PUBLIC_VENUES: Record<PublicVenue, PublicVenueConfig> = {
  binance,
  coinbase,
  kraken,
  okx,
};

/**
 * Fetch order books from a list of venues in parallel. Returns one
 * entry per venue with either a normalized OrderBook or an error.
 * Failures on individual venues don't block the others.
 */
export interface PublicBookResult {
  venue: PublicVenue;
  label: string;
  takerBps: number;
  book: OrderBook | null;
  error?: string;
}

export async function fetchPublicBooks(
  symbol: string,
  venues: PublicVenue[],
  levels = 100,
  signal?: AbortSignal,
): Promise<PublicBookResult[]> {
  const results = await Promise.allSettled(
    venues.map(async (v): Promise<PublicBookResult> => {
      const cfg = PUBLIC_VENUES[v];
      try {
        const book = await cfg.fetchBook(symbol, levels, signal);
        return { venue: v, label: cfg.label, takerBps: cfg.takerBps, book };
      } catch (e) {
        return {
          venue: v,
          label: cfg.label,
          takerBps: cfg.takerBps,
          book: null,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );
  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { venue: venues[i]!, label: PUBLIC_VENUES[venues[i]!].label, takerBps: PUBLIC_VENUES[venues[i]!].takerBps, book: null, error: String(r.reason) },
  );
}

// ---------- USD conversion --------------------------------------------------

const USD_STABLES = new Set(["USD", "USDT", "USDC", "BUSD", "TUSD", "FDUSD", "DAI", "USDP"]);

/**
 * Decide whether a quote asset is already USD-equivalent. For non-USD
 * quotes (EUR, GBP, BTC, ETH...) callers can pass a price oracle to
 * convert. If the quote IS USD-equivalent, the conversion is identity.
 */
export function isUsdQuote(quoteAsset: string): boolean {
  return USD_STABLES.has(quoteAsset.toUpperCase());
}

/** Split a generic symbol like "BTCUSDT" into base + quote. Returns
 *  null if the suffix isn't a known fiat / stable. Used to compute the
 *  USD conversion target. */
export function splitSymbol(symbol: string): { base: string; quote: string } | null {
  const upper = symbol.toUpperCase().replace(/[\-_/]/g, "");
  const candidates = ["USDT", "USDC", "FDUSD", "TUSD", "BUSD", "DAI", "USDP", "USD", "EUR", "GBP", "JPY", "BTC", "ETH"];
  // Sort longest-first so USDT wins over USD when scanning BTCUSDT.
  candidates.sort((a, b) => b.length - a.length);
  for (const q of candidates) {
    if (upper.endsWith(q) && upper.length > q.length) {
      return { base: upper.slice(0, -q.length), quote: q };
    }
  }
  return null;
}
