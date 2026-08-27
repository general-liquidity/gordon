/**
 * Multi-venue execution routing.
 *
 * Given an order intent (symbol + side + quantity), collects quotes from
 * every provided execution venue and returns a ranked list by effective
 * execution price (quote + fees). Lets agents and planners pick the best
 * venue for an order rather than defaulting to "whichever is active".
 *
 * Scope of this first cut: ranks across venues the caller has already
 * authenticated (and passed in as `Exchange` instances). Extending to
 * public-only quote fetching across unauth'd venues requires a separate
 * refactor of the exchange-client auth path and is explicitly out of scope.
 *
 * Fee estimates come from a static lookup per exchange + side; users
 * running elevated tiers (maker rebates, VIP schedules) may see different
 * realized fees. The estimate is for RANKING, not for accounting.
 */

import type { Exchange, ExchangeId } from "../exchange/types.ts";

export type OrderSide = "buy" | "sell";

export interface OrderIntent {
  symbol: string;
  side: OrderSide;
  /** Order size in base asset. */
  quantity: number;
}

export interface VenueQuote {
  venueId: ExchangeId;
  /** Price per 1 unit of base asset (as returned by `Exchange.getPrice`). */
  price: number;
  /** Estimated taker fee fraction (e.g. 0.001 = 10 bps). */
  feeBps: number;
  /**
   * Effective execution price after fees. For a BUY, fees increase cost
   * (price × (1+fee)). For a SELL, fees reduce proceeds (price × (1-fee)).
   */
  effectivePrice: number;
  /** Notional = price × quantity (pre-fee). */
  notional: number;
  /** Fees paid in quote asset. */
  feeCost: number;
}

export interface QuoteFailure {
  venueId: ExchangeId;
  error: string;
}

export interface ExecutionRecommendation {
  intent: OrderIntent;
  /** Ranked best → worst. For BUY: ascending effective price. For SELL: descending. */
  ranked: VenueQuote[];
  /** Venues that failed to quote (timeouts, API errors, unsupported symbol). */
  failed: QuoteFailure[];
  /**
   * Savings vs the worst-ranked venue in quote-asset terms. Zero when only
   * one venue responded. Positive means routing here beats the fallback.
   */
  estimatedSavings: number;
}

// ---------------------------------------------------------------------------
// Static fee-tier estimates (basis points, taker side).
//
// Sources: each venue's default retail fee schedule at time of writing.
// Tuned conservative (taker, no VIP, no rebates). Override per-user by
// passing `feeOverrides` to `routeOrder`.
// ---------------------------------------------------------------------------

export const DEFAULT_TAKER_FEE_BPS: Partial<Record<ExchangeId, number>> = {
  binance: 10,
  binance_us: 10,
  coinbase: 60,
  kraken: 26,
  bitfinex: 20,
  hyperliquid: 3, // perps — maker 1 / taker 3.5 default
  robinhood: 0,
  okx: 10,
  gemini: 40,
};

const FALLBACK_FEE_BPS = 20;

/**
 * Collect quotes from each venue in parallel. Gracefully handles per-venue
 * failures — a 500 from one venue does not prevent others from contributing.
 */
export async function collectVenueQuotes(
  intent: OrderIntent,
  venues: readonly Exchange[],
  feeOverrides?: Partial<Record<ExchangeId, number>>,
): Promise<{ quotes: VenueQuote[]; failures: QuoteFailure[] }> {
  const results = await Promise.allSettled(
    venues.map((v) => quoteForVenue(v, intent, feeOverrides)),
  );

  const quotes: VenueQuote[] = [];
  const failures: QuoteFailure[] = [];

  for (let i = 0; i < results.length; i += 1) {
    const r = results[i];
    const v = venues[i];
    if (!v) continue;
    if (r && r.status === "fulfilled" && r.value) {
      quotes.push(r.value);
    } else if (r && r.status === "rejected") {
      failures.push({
        venueId: v.exchangeId,
        error: r.reason instanceof Error ? r.reason.message : String(r.reason),
      });
    }
  }

  return { quotes, failures };
}

async function quoteForVenue(
  venue: Exchange,
  intent: OrderIntent,
  feeOverrides?: Partial<Record<ExchangeId, number>>,
): Promise<VenueQuote> {
  const price = await venue.getPrice(intent.symbol);
  const feeBps =
    feeOverrides?.[venue.exchangeId] ?? DEFAULT_TAKER_FEE_BPS[venue.exchangeId] ?? FALLBACK_FEE_BPS;
  const feeFraction = feeBps / 10_000;
  const effectivePrice =
    intent.side === "buy" ? price * (1 + feeFraction) : price * (1 - feeFraction);
  const notional = price * intent.quantity;
  const feeCost = notional * feeFraction;

  return {
    venueId: venue.exchangeId,
    price,
    feeBps,
    effectivePrice,
    notional,
    feeCost,
  };
}

/**
 * Rank quotes by effective execution price. Buy: ascending (cheapest first).
 * Sell: descending (highest proceeds first).
 */
export function rankQuotes(quotes: VenueQuote[], side: OrderSide): VenueQuote[] {
  const sorted = [...quotes];
  sorted.sort((a, b) => {
    return side === "buy"
      ? a.effectivePrice - b.effectivePrice
      : b.effectivePrice - a.effectivePrice;
  });
  return sorted;
}

/**
 * End-to-end: collect quotes from venues, rank them, compute savings vs
 * worst-ranked responder. Never throws on partial failures — callers can
 * inspect `failed` to log or surface to the user.
 */
export async function routeOrder(
  intent: OrderIntent,
  venues: readonly Exchange[],
  options: {
    feeOverrides?: Partial<Record<ExchangeId, number>>;
  } = {},
): Promise<ExecutionRecommendation> {
  const { quotes, failures } = await collectVenueQuotes(intent, venues, options.feeOverrides);
  const ranked = rankQuotes(quotes, intent.side);

  let estimatedSavings = 0;
  if (ranked.length >= 2) {
    const best = ranked[0]!;
    const worst = ranked[ranked.length - 1]!;
    estimatedSavings =
      intent.side === "buy"
        ? (worst.effectivePrice - best.effectivePrice) * intent.quantity
        : (best.effectivePrice - worst.effectivePrice) * intent.quantity;
  }

  return {
    intent,
    ranked,
    failed: failures,
    estimatedSavings,
  };
}

/**
 * Human-readable rendering of a routing recommendation. Suitable for tool
 * output and audit trails.
 */
export function formatRecommendation(rec: ExecutionRecommendation): string {
  const lines: string[] = [
    `Routing ${rec.intent.side.toUpperCase()} ${rec.intent.quantity} ${rec.intent.symbol}`,
  ];
  if (rec.ranked.length === 0) {
    lines.push("  No venues responded with a quote.");
  } else {
    for (let i = 0; i < rec.ranked.length; i += 1) {
      const q = rec.ranked[i]!;
      const mark = i === 0 ? "✓" : " ";
      lines.push(
        `  ${mark} ${q.venueId.padEnd(12)} price=${q.price.toFixed(4)} fee=${q.feeBps}bps effective=${q.effectivePrice.toFixed(4)}`,
      );
    }
  }
  if (rec.failed.length > 0) {
    lines.push(`  Failed: ${rec.failed.map((f) => `${f.venueId} (${f.error})`).join(", ")}`);
  }
  if (rec.estimatedSavings > 0) {
    lines.push(
      `  Est. savings routing here vs worst: ${rec.estimatedSavings.toFixed(4)} quote-units`,
    );
  }
  return lines.join("\n");
}
