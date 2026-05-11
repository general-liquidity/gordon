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
