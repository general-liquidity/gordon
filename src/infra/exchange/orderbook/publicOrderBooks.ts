/**
 * Public order-book fetchers — credential-free read-only access to the
 * top crypto venues for pre-trade cost comparison.
 *
 * All four venues expose a public depth/book endpoint that doesn't
 * require auth. We hit them in parallel and normalize to our internal
 * OrderBook shape so compareVenues() can rank apples to apples.
 *
 * Per-venue notes:
 *   - Binance: /api/v3/depth?symbol=BTCUSDT&limit=100
 *   - Coinbase: /products/BTC-USD/book?level=2 (top 50 levels both sides)
 *   - Kraken: /0/public/Depth?pair=XBTUSD&count=100
 *   - OKX: /api/v5/market/books?instId=BTC-USDT&sz=100
 *
 * Fee rates are public-knowledge taker baselines (no auth needed to
 * look them up either). Real users with VIP tiers / token discounts
 * will pay less; surfacing the baseline as a CONSERVATIVE upper bound
 * is the right tradeoff.
 */

import type { OrderBook, OrderBookEntry } from "../types.ts";
import { createPublicExchange } from "../publicFactory.ts";

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

const FETCH_TIMEOUT_MS = 4_000;

/** Wrap fetch with an abort timeout so a stuck venue doesn't block the
 *  whole comparison. */
async function fetchJson(url: string, externalSignal?: AbortSignal): Promise<unknown> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  const onAbort = () => ctrl.abort();
  externalSignal?.addEventListener("abort", onAbort);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) {
      // 404 typically means the venue doesn't list the symbol — treat as
      // "not available" rather than a transport error.
      if (res.status === 404) return null;
      throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
    }
    return res.json();
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onAbort);
  }
}

function toEntries(rows: Array<[string | number, string | number]> | undefined): OrderBookEntry[] {
  if (!rows) return [];
  const out: OrderBookEntry[] = [];
  for (const r of rows) {
    const price = Number(r[0]);
    const quantity = Number(r[1]);
    if (Number.isFinite(price) && Number.isFinite(quantity) && price > 0 && quantity > 0) {
      out.push({ price, quantity });
    }
  }
  return out;
}

// ---------- Binance --------------------------------------------------------

const binance: PublicVenueConfig = {
  label: "Binance",
  takerBps: 10, // 0.10% spot baseline
  makerBps: 10,
  toNativeSymbol: (s) => s.toUpperCase().replace(/[\-_/]/g, ""),
  async fetchBook(symbol, levels, signal) {
    if (signal?.aborted) return null;
    try {
      const exchange = createPublicExchange("binance");
      const book = await exchange.getOrderBook(symbol, levels);
      return {
        lastUpdateId: book.lastUpdateId,
        bids: book.bids,
        asks: book.asks,
      };
    } catch {
      return null;
    }
  },
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
  async fetchBook(symbol, _levels, signal) {
    const native = this.toNativeSymbol(symbol);
    const data = (await fetchJson(
      `https://api.exchange.coinbase.com/products/${encodeURIComponent(native)}/book?level=2`,
      signal,
    )) as { bids?: [string, string, number][]; asks?: [string, string, number][] } | null;
    if (!data) return null;
    // Coinbase rows are [price, size, num_orders] — first two columns match.
    const bids = toEntries(data.bids?.map((r) => [r[0], r[1]] as [string, string]));
    const asks = toEntries(data.asks?.map((r) => [r[0], r[1]] as [string, string]));
    return { lastUpdateId: 0, bids, asks };
  },
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
  async fetchBook(symbol, levels, signal) {
    const native = this.toNativeSymbol(symbol);
    const data = (await fetchJson(
      `https://api.kraken.com/0/public/Depth?pair=${encodeURIComponent(native)}&count=${Math.min(levels, 500)}`,
      signal,
    )) as { result?: Record<string, { bids: [string, string, number][]; asks: [string, string, number][] }>; error?: string[] } | null;
    if (!data) return null;
    if (data.error && data.error.length > 0) {
      // Kraken signals "unknown asset pair" via an error array, not a 404.
      if (data.error.some((e) => e.includes("Unknown asset pair"))) return null;
      throw new Error(`Kraken: ${data.error.join("; ")}`);
    }
    const result = data.result;
    if (!result) return null;
    const firstKey = Object.keys(result)[0];
    if (!firstKey) return null;
    const book = result[firstKey];
    if (!book) return null;
    const bids = toEntries(book.bids.map((r) => [r[0], r[1]] as [string, string]));
    const asks = toEntries(book.asks.map((r) => [r[0], r[1]] as [string, string]));
    return { lastUpdateId: 0, bids, asks };
  },
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
  async fetchBook(symbol, levels, signal) {
    const native = this.toNativeSymbol(symbol);
    const data = (await fetchJson(
      `https://www.okx.com/api/v5/market/books?instId=${encodeURIComponent(native)}&sz=${Math.min(levels, 400)}`,
      signal,
    )) as { code?: string; data?: Array<{ bids: [string, string, string, string][]; asks: [string, string, string, string][] }> } | null;
    if (!data || data.code !== "0") return null;
    const top = data.data?.[0];
    if (!top) return null;
    const bids = toEntries(top.bids.map((r) => [r[0], r[1]] as [string, string]));
    const asks = toEntries(top.asks.map((r) => [r[0], r[1]] as [string, string]));
    return { lastUpdateId: 0, bids, asks };
  },
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
