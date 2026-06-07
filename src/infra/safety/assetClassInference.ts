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

const DEFI_VENUES = new Set([
  "uniswap",
  "agentkit",
  "solanakit",
  "polkadotkit",
  "base_onchain",
  "cdp",
]);

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

// Metals / precious commodities (symbol tokens). XAU=gold, XAG=silver,
// XPT=platinum, XPD=palladium. (GLD/SLV ETFs are deliberately NOT here —
// those are us_equity and classified by venue.)
const METAL_TOKENS = ["XAU", "XAG", "XPT", "XPD", "GOLD", "SILVER", "PLATINUM", "PALLADIUM"];

// Crypto bases / stable quotes for symbol-level detection on multi-asset venues.
const CRYPTO_QUOTES = ["USDT", "USDC", "BUSD", "DAI", "TUSD", "USDD"];
const CRYPTO_BASES = new Set([
  "BTC", "XBT", "ETH", "SOL", "XRP", "DOGE", "ADA", "BNB", "AVAX",
  "MATIC", "LTC", "DOT", "LINK", "TRX", "TON", "SUI", "ARB", "OP", "PEPE", "SHIB",
]);

/**
 * Infer asset class from a SYMBOL. Needed for multi-asset venues (e.g. a single
 * sim/broker that quotes EURUSD, XAUUSD and BTCUSD side by side) where the venue
 * name can't disambiguate. Returns fx / commodity / crypto, or "unknown" when the
 * symbol doesn't clearly match (e.g. a bare equity ticker — defer to venue).
 */
export function inferAssetClassFromSymbol(
  symbol: string | undefined | null,
): InferredAssetClass {
  if (!symbol) return "unknown";
  const s = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (!s) return "unknown";

  // Metals first (XAUUSD normalizes to 6 chars but isn't an FX pair).
  if (METAL_TOKENS.some((t) => s.includes(t))) return "commodity";

  // Crypto: a stable quote as the SUFFIX (quote currency), or a known crypto
  // base prefix. endsWith (not includes) so FX pairs like USDCHF/USDCAD — which
  // contain "USDC" as a prefix — aren't mis-tagged as crypto.
  if (CRYPTO_QUOTES.some((q) => s.endsWith(q))) return "crypto";
  for (const base of CRYPTO_BASES) {
    if (s.startsWith(base)) return "crypto";
  }

  // FX: exactly two ISO-4217 codes (EURUSD, GBPJPY), optionally with a separator
  // (already stripped). Reject crypto-looking 6-letter strings via the fiat check.
  if (s.length === 6 && FIAT_CODES.has(s.slice(0, 3)) && FIAT_CODES.has(s.slice(3, 6))) {
    return "fx";
  }

  return "unknown";
}

/**
 * Combined inference: the symbol is more specific than the venue on multi-asset
 * venues, so prefer a definite symbol-level class (fx/commodity/crypto) and fall
 * back to the venue (crypto/us_equity/defi) otherwise.
 */
export function inferAssetClass(
  venue: string | undefined | null,
  symbol: string | undefined | null,
): InferredAssetClass {
  const bySymbol = inferAssetClassFromSymbol(symbol);
  if (bySymbol !== "unknown") return bySymbol;
  return inferAssetClassFromVenue(venue);
}
