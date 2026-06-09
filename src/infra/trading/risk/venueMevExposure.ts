/**
 * Venue MEV Exposure Classification
 *
 * Per Eric Budish's market-design analysis (a16z crypto research seminar,
 * 2025): every continuous-limit-order-book venue carries a structural
 * "sniping tax" baked into bid-ask spreads from races on symmetric
 * public information. Crypto adds a second tax layer — the public
 * mempool — where transactions sit visible before execution, opening
 * the door to reordering attacks (MEV).
 *
 * Gordon trades on multiple venues with very different MEV exposure
 * profiles. This module classifies them so the risk classifier can
 * surface the exposure as a 13th pre-trade dimension.
 *
 * Classification tiers:
 *
 *   low        — CEX with no public pre-trade leakage. Standard
 *                continuous-LOB sniping tax exists (Budish's 33% of
 *                spread) but no mempool MEV. Binance, Coinbase,
 *                Kraken, OKX, Gemini, Bitfinex, Binance.US.
 *
 *   medium     — CEX with partial pre-trade information leakage
 *                (e.g., venues with permissive public order feeds,
 *                certain DEX-adjacent CEXes). Hyperliquid's on-chain
 *                orderbook lives here — public commitment but no
 *                generic re-ordering attack surface.
 *
 *   high       — Public mempool venue. Standard DEXes on Ethereum
 *                L1, BSC, etc. Transactions sit in the mempool
 *                visible before execution; sandwich + frontrun MEV
 *                is a documented tax. Uniswap-style AMMs.
 *
 *   protected  — MEV-protected venue. CoW Swap (batch auction with
 *                CoW-matching + solver competition), Flashbots
 *                Protect-style private RPCs, MEV-Share. Small
 *                residual overhead but no sandwich exposure.
 *
 *   unknown    — Operator hasn't classified the venue. Treated as
 *                if `medium` for scoring (precautionary).
 *
 * The score the classifier applies:
 *
 *   low         →  0  (no flag — standard spread covers it)
 *   protected   →  5  (minimal overhead from auction batching)
 *   medium      → 25  (moderate — operator should be aware)
 *   high        → 60  (substantial — operator should consider routing
 *                      through a protected venue for size)
 *   unknown     → 30  (defaults to "treat like medium" — precautionary)
 *
 * Weight in classifier: 1.0 (matches volatility dimension, lower than
 * the load-bearing position-size + drawdown dimensions).
 */

import type { NativeExchangeId } from "../../exchange/types.ts";

export type VenueMevTier = "low" | "medium" | "high" | "protected" | "unknown";

export interface VenueMevExposure {
  /** Operator-facing label. */
  tier: VenueMevTier;
  /** Numeric score the risk classifier applies. */
  score: number;
  /** Short operator-readable reason. */
  reason: string;
}

const TIER_SCORES: Record<VenueMevTier, number> = {
  low: 0,
  protected: 5,
  medium: 25,
  high: 60,
  unknown: 30,
};

/**
 * Default classification for Gordon's native venue ids. Operators can
 * override per-trade via the riskClassifier `venueMevExposure` input
 * (e.g., when routing a uniswap trade through Flashbots Protect, pass
 * `protected` explicitly).
 */
const NATIVE_VENUE_TIERS: Record<NativeExchangeId, VenueMevTier> = {
  binance: "low",
  binance_us: "low",
  coinbase: "low",
  kraken: "low",
  bitfinex: "low",
  okx: "low",
  gemini: "low",
  robinhood: "low",
  hyperliquid: "medium",
};

const TIER_REASONS: Record<VenueMevTier, string> = {
  low: "CEX with no public mempool — standard CLOB spread covers MEV exposure",
  protected:
    "MEV-protected venue (batch auction / private RPC) — minimal residual overhead",
  medium:
    "Partial pre-trade leakage — operator should monitor sandwich/frontrun exposure",
  high:
    "Public mempool — sandwich and frontrun attacks are documented; consider an MEV-protected venue for size",
  unknown:
    "Venue not classified — treating as moderate exposure (operator should classify)",
};

/**
 * Look up MEV exposure for a Gordon native venue id. Returns `unknown`
 * for venue ids not in the native list (operator can override).
 */
export function classifyNativeVenue(venueId: string): VenueMevExposure {
  const tier = (NATIVE_VENUE_TIERS as Record<string, VenueMevTier>)[venueId] ?? "unknown";
  return {
    tier,
    score: TIER_SCORES[tier],
    reason: TIER_REASONS[tier],
  };
}

/**
 * Classify a CCXT-routed venue. CCXT covers 90+ exchanges with varying
 * MEV profiles. Without per-venue knowledge we treat CCXT venues as
 * `low` when the exchange id is in a known-CEX list, else `unknown`.
 *
 * The known-CEX list is conservative — only the major CCXT venues
 * Gordon has tested. Operators trading via `ccxt:<other_venue>` should
 * pass an explicit override.
 */
const KNOWN_CCXT_CEX_VENUES = new Set([
  "binance",
  "coinbase",
  "kraken",
  "bitfinex",
  "okx",
  "kucoin",
  "bybit",
  "mexc",
  "gate",
  "bitget",
  "huobi",
  "htx",
  "bingx",
  "cryptocom",
  "deribit",
  "bitstamp",
  "gemini",
]);

export function classifyCcxtVenue(ccxtSubId: string): VenueMevExposure {
  const tier: VenueMevTier = KNOWN_CCXT_CEX_VENUES.has(ccxtSubId) ? "low" : "unknown";
  return {
    tier,
    score: TIER_SCORES[tier],
    reason: TIER_REASONS[tier],
  };
}

/**
 * Single entry point: given a venue id (native or `ccxt:<sub-id>`),
 * return its classification.
 */
export function classifyVenue(venueId: string): VenueMevExposure {
  if (venueId.startsWith("ccxt:")) {
    return classifyCcxtVenue(venueId.slice("ccxt:".length));
  }
  return classifyNativeVenue(venueId);
}

/**
 * Operator override constructor — when the caller knows the venue
 * profile better than Gordon's defaults (e.g., routing through
 * Flashbots Protect, using CoW Swap), they can pass an explicit
 * tier with a custom reason.
 */
export function buildVenueMevExposure(
  tier: VenueMevTier,
  reasonOverride?: string,
): VenueMevExposure {
  return {
    tier,
    score: TIER_SCORES[tier],
    reason: reasonOverride ?? TIER_REASONS[tier],
  };
}
