/**
 * Order-book cost calculator — clean-room implementation.
 *
 * Walks an order book to estimate the effective fill price + slippage +
 * fee for a given trade size, then aggregates a comparison across
 * multiple venues so callers can answer "where does this fill cheapest
 * right now?".
 *
 * Algorithm (public knowledge from any exchange microstructure text):
 *  1. Sort the relevant side (asks for buys, bids for sells) by price.
 *  2. Accumulate fills level by level until the requested size is met
 *     (or the book runs out — that's an "insufficient liquidity" error).
 *  3. Effective fill = total quote spent / total base filled.
 *  4. Reference = best-side or midpoint, configurable.
 *  5. Slippage = max(0, signed delta(reference, effective)) — never
 *     negative (price improvement isn't slippage).
 *  6. Fee = configured taker rate × notional, in either side of the pair.
 *  7. All-in cost (for buys) = quote spent + fee-in-quote.
 *     All-in proceeds (for sells) = quote received - fee-in-quote.
 *
 * Decimal math via Number is fine here — we're displaying estimates, not
 * settling. If we ever need exact basis-point precision (e.g. for
 * algorithmic execution decisions), swap to a Decimal lib then.
 */

import type { OrderBook, OrderBookEntry } from "../types.ts";

export type Side = "buy" | "sell";

/** Where the reference price comes from. 'best' = top of the relevant
 *  book side (best ask for buys, best bid for sells). 'mid' = midpoint
 *  of best bid + best ask. */
export type ReferenceBasis = "best" | "mid";

export interface FeeRate {
  /** Taker rate as a decimal (e.g. 0.001 = 10 bps = 0.1%). */
  taker: number;
  /** Maker rate as a decimal. Currently unused — preview assumes taker. */
  maker?: number;
}

export interface CostInput {
  /** Display name for the venue ("Binance", "Coinbase", etc.). */
  venue: string;
  /** Order-book snapshot. Must have at least one bid AND one ask. */
  book: OrderBook;
  /** Trade direction. */
  side: Side;
  /** Size in BASE asset units (e.g. 0.5 BTC). */
  sizeBase: number;
  /** Fee rates for this venue + this user's tier. */
  fee: FeeRate;
  /** Defaults to 'best'. */
  referenceBasis?: ReferenceBasis;
}

export interface CostBreakdown {
  venue: string;
  side: Side;
  sizeBase: number;
  /** Volume-weighted average fill price across consumed levels. */
  effectivePrice: number;
  /** Reference price used for slippage. */
  referencePrice: number;
  /** Number of book levels consumed. */
  levelsConsumed: number;
  /** Quote spent (buy) or received (sell) BEFORE fees. */
  notionalQuote: number;
  /** Slippage as a fraction of reference price (>= 0). */
  slippageRate: number;
  /** Slippage in absolute quote terms (>= 0). */
  slippageQuote: number;
  /** Fee in absolute quote terms (taker rate × notional). */
  feeQuote: number;
  /**
   * The single-figure "all-in" cost the caller should compare across
   * venues:
   *   - For buys: total quote required = notional + fee + slippage cost
   *   - For sells: net quote received = notional − fee (slippage already
   *     reflected in notional, so don't double-count)
   * Lower is better for buys; higher is better for sells.
   */
  allInQuote: number;
}

export interface CostError {
  venue: string;
  side: Side;
  /** Human-readable reason this venue couldn't price the trade. */
  error: string;
}

/** Walk one side of a book to consume `sizeBase`. */
function walkBook(
  side: Side,
  book: OrderBook,
  sizeBase: number,
): { notionalQuote: number; effectivePrice: number; levelsConsumed: number } {
  const levels: OrderBookEntry[] = side === "buy" ? book.asks : book.bids;
  if (!levels.length) throw new Error("Empty book side");

  let remaining = sizeBase;
  let notional = 0;
  let levelsConsumed = 0;

  for (const lvl of levels) {
    if (lvl.price <= 0 || lvl.quantity <= 0) continue;
    const take = Math.min(remaining, lvl.quantity);
    notional += take * lvl.price;
    remaining -= take;
    levelsConsumed++;
    if (remaining <= 0) break;
  }

  if (remaining > 0) {
    const filled = sizeBase - remaining;
    throw new Error(
      `Insufficient liquidity: requested ${sizeBase}, filled ${filled.toFixed(8)} ` +
        `across ${levelsConsumed} levels`,
    );
  }

  const effectivePrice = sizeBase > 0 ? notional / sizeBase : 0;
  return { notionalQuote: notional, effectivePrice, levelsConsumed };
}

function referenceFor(side: Side, book: OrderBook, basis: ReferenceBasis): number {
  const bestBid = book.bids[0]?.price ?? 0;
  const bestAsk = book.asks[0]?.price ?? 0;
  if (basis === "mid") {
    if (bestBid > 0 && bestAsk > 0) return (bestBid + bestAsk) / 2;
    return bestAsk || bestBid;
  }
  return side === "buy" ? bestAsk : bestBid;
}

export function computeCost(input: CostInput): CostBreakdown {
  const { venue, book, side, sizeBase, fee } = input;
  if (sizeBase <= 0) throw new Error("Size must be positive");
  if (!book.asks?.length || !book.bids?.length) throw new Error("Empty order book");

  const { notionalQuote, effectivePrice, levelsConsumed } = walkBook(side, book, sizeBase);
  const referencePrice = referenceFor(side, book, input.referenceBasis ?? "best");

  // Slippage is always non-negative — price improvement isn't slippage.
  const rawDelta =
    side === "buy" ? effectivePrice - referencePrice : referencePrice - effectivePrice;
  const slippageQuotePerUnit = Math.max(0, rawDelta);
  const slippageQuote = slippageQuotePerUnit * sizeBase;
  const slippageRate = referencePrice > 0 ? slippageQuotePerUnit / referencePrice : 0;

  const feeQuote = notionalQuote * fee.taker;

  // Buys: total cost grows with fee. Sells: proceeds shrink by fee.
  const allInQuote = side === "buy" ? notionalQuote + feeQuote : notionalQuote - feeQuote;

  return {
    venue,
    side,
    sizeBase,
    effectivePrice,
    referencePrice,
    levelsConsumed,
    notionalQuote,
    slippageRate,
    slippageQuote,
    feeQuote,
    allInQuote,
  };
}

/**
 * Compare a single trade across multiple venues and return them sorted
 * best-to-worst on the all-in metric. Per-venue errors are collected
 * separately so a missing book on one venue doesn't sink the whole
 * comparison.
 */
export interface ComparisonResult {
  /** Sorted best to worst. For buys: lowest allInQuote first. */
  ranked: CostBreakdown[];
  /** Venues that couldn't price the trade. */
  errors: CostError[];
  /**
   * The all-in delta (in quote terms) between the best venue and each
   * other venue, signed so positive = "this venue is more expensive than
   * the best one for buys" (or "this venue pays less than the best for
   * sells"). Useful for displaying a "save $X by choosing Binance" line.
   */
  savingsVsBest: Record<string, number>;
}

export function compareVenues(inputs: CostInput[]): ComparisonResult {
  const ranked: CostBreakdown[] = [];
  const errors: CostError[] = [];

  for (const inp of inputs) {
    try {
      ranked.push(computeCost(inp));
    } catch (e) {
      errors.push({
        venue: inp.venue,
        side: inp.side,
        error: e instanceof Error ? e.message : String(e),
      });
    }
  }

  if (ranked.length === 0) return { ranked, errors, savingsVsBest: {} };

  // For buys: lower allInQuote is better. For sells: higher is better.
  const buyMode = ranked[0]!.side === "buy";
  ranked.sort((a, b) => (buyMode ? a.allInQuote - b.allInQuote : b.allInQuote - a.allInQuote));

  const best = ranked[0]!.allInQuote;
  const savingsVsBest: Record<string, number> = {};
  for (const r of ranked) {
    savingsVsBest[r.venue] = buyMode ? r.allInQuote - best : best - r.allInQuote;
  }

  return { ranked, errors, savingsVsBest };
}
