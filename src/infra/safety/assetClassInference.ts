/**
 * Asset-class inference from venue.
 *
 * Shared helper used by the anti-rot safety primitives (tradingUniverse,
 * thesisCoherence, strategyMandates) so they can score plans on asset
 * class without each one re-deriving the mapping.
 */

const CRYPTO_VENUES = new Set([
  "binance",
  "binanceus",
  "coinbase",
  "kraken",
  "okx",
  "bybit",
  "kucoin",
  "gemini",
  "bitfinex",
  "mexc",
  "gate",
  "huobi",
  "bitstamp",
  "hyperliquid",
]);

const US_EQUITY_VENUES = new Set([
  "alpaca",
  "interactivebrokers",
  "ibkr",
  "trading212",
  "t212",
  "schwab",
  "fidelity",
  "tdameritrade",
  "etrade",
]);

const DEFI_VENUES = new Set<string>();

export type InferredAssetClass =
  | "crypto"
  | "us_equity"
  | "defi"
  | "fx"
  | "commodity"
  | "unknown";

export function inferAssetClassFromVenue(
  venue: string | undefined | null,
): InferredAssetClass {
  if (!venue) return "unknown";
  const v = venue.toLowerCase().trim();
  if (CRYPTO_VENUES.has(v)) return "crypto";
  if (US_EQUITY_VENUES.has(v)) return "us_equity";
  if (DEFI_VENUES.has(v)) return "defi";
  // Heuristic fallback: anything containing 'swap'/'pool'/'dex' → defi
  if (v.includes("swap") || v.includes("dex") || v.includes("pool")) return "defi";
  return "unknown";
}

// ISO-4217 codes seen in retail FX (majors + common minors/EM).
const FIAT_CODES = new Set([
  "USD", "EUR", "GBP", "JPY", "CHF", "CAD", "AUD", "NZD",
  "CNH", "CNY", "HKD", "SGD", "SEK", "NOK", "DKK", "PLN",
  "MXN", "ZAR", "TRY", "HUF", "CZK", "ILS", "INR", "KRW", "THB",
]);

// Precious-metal ISO-4217 codes (X-prefixed): XAU=gold, XAG=silver,
// XPT=platinum, XPD=palladium. (GLD/SLV ETFs are deliberately NOT here —
// those are us_equity and classified by venue/catalog.)
const METAL_CODES = ["XAU", "XAG", "XPT", "XPD"];
const METAL_WORDS = ["GOLD", "SILVER", "PLATINUM", "PALLADIUM"];

/**
 * Infer asset class from a SYMBOL using only STRUCTURAL rules — definitional
 * shapes that don't go stale, NOT an enumerated membership list:
 *   - FX:        two ISO-4217 fiat codes (EURUSD, GBP/JPY).
 *   - commodity: a precious-metal ISO code (XAU/XAG/XPT/XPD) or metal word.
 *
 * It deliberately does NOT try to recognize CRYPTO or EQUITY from the symbol:
 * those universes are open and ever-growing, so the source of truth is the
 * venue's own symbol catalog (each integration already pulls the full tradable
 * list + instrument type from the API). For those, pass the API's classification
 * as `explicit` to `inferAssetClass`, or rely on the venue. Returns "unknown"
 * when the symbol isn't a definitional FX/metal shape.
 */
export function inferAssetClassFromSymbol(
  symbol: string | undefined | null,
): InferredAssetClass {
  if (!symbol) return "unknown";
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "unknown";

  // Metals first (XAUUSD normalizes to 6 chars but isn't an FX pair).
  if (METAL_CODES.some((c) => s.startsWith(c)) || METAL_WORDS.some((w) => s.includes(w))) {
    return "commodity";
  }

  // FX: exactly two ISO-4217 fiat codes (EURUSD, GBPJPY). The fiat check rejects
  // crypto-looking 6-letter strings (BTC/ETH/etc. aren't fiat codes).
  if (s.length === 6 && FIAT_CODES.has(s.slice(0, 3)) && FIAT_CODES.has(s.slice(3, 6))) {
    return "fx";
  }

  return "unknown";
}

/** Map an API-supplied instrument category/type to an InferredAssetClass (or unknown). */
function normalizeExplicit(explicit: string | undefined | null): InferredAssetClass {
  if (!explicit) return "unknown";
  const e = explicit.toLowerCase().trim();
  if (e === "crypto" || e === "cryptocurrency" || e === "digital") return "crypto";
  if (e === "fx" || e === "forex" || e === "currency") return "fx";
  if (e === "commodity" || e === "commodities" || e === "metal" || e === "metals") return "commodity";
  if (e === "us_equity" || e === "equity" || e === "equities" || e === "stock" || e === "stocks") {
    return "us_equity";
  }
  if (e === "defi") return "defi";
  return "unknown";
}

/**
 * Combined asset-class resolution, most-authoritative first:
 *   1. `explicit` — the venue/API's own instrument category (the source of truth
 *      for crypto/equity, whose symbol universes are pulled from the API catalog).
 *   2. structural symbol shape (fx / commodity) — definitional, never enumerated.
 *   3. the venue (crypto / us_equity / defi).
 * Returns "unknown" when none is informative.
 */
export function inferAssetClass(
  venue: string | undefined | null,
  symbol: string | undefined | null,
  explicit?: string | undefined | null,
): InferredAssetClass {
  const byExplicit = normalizeExplicit(explicit);
  if (byExplicit !== "unknown") return byExplicit;
  const bySymbol = inferAssetClassFromSymbol(symbol);
  if (bySymbol !== "unknown") return bySymbol;
  return inferAssetClassFromVenue(venue);
}
