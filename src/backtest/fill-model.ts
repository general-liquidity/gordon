/**
 * Book-aware fill model for the backtest engine.
 *
 * The engine's default cost model prices every fill as a reference price nudged
 * by a flat rate. That flat rate is size-blind, and size is exactly where
 * execution cost lives: on real AMZN book data (Robust RL in Finance, NeurIPS
 * 2025) a 100-share buy clears entirely at the touch for a VWAP of 223.95 while
 * a 1,000-share buy walks five levels for 224.21. Those 26 bps read as roughly
 * zero under a flat rate, and the error grows non-linearly with size, so a
 * strategy's backtest flatters it precisely as it scales up. That is backwards.
 *
 * The same result makes impact DIRECTIONAL: a buy consumes asks and pays up, a
 * sell consumes bids and sells down. Nothing here perturbs price symmetrically,
 * because the market does not.
 *
 * Matching is delegated to `lob.ts` (deterministic CDA, price-time priority)
 * rather than reimplemented: this module is only the bar-loop adapter that turns
 * an aggregated depth snapshot into resting liquidity and reads a VWAP back off
 * the resulting transaction stream.
 */

import { OrderBook } from "./lob.ts";
import type { OHLC } from "./types.ts";

/** One aggregated price level of the book. */
export interface DepthLevel {
  price: number;
  /** Aggregate resting size at this price, in base units. */
  quantity: number;
}

/** Both sides of an aggregated book for a single bar. */
export interface BarDepth {
  /** Bid levels. Order is irrelevant: the matcher re-ranks by price-time priority. */
  bids: DepthLevel[];
  asks: DepthLevel[];
}

/**
 * Supplies depth for a bar. Returning undefined means "no book for this bar",
 * which the engine reports as an estimated fill rather than guessing.
 */
export type BarDepthProvider = (bar: OHLC, barIndex: number) => BarDepth | undefined | null;

export interface BookFillConfig {
  depth: BarDepthProvider;
  /** Cap on levels consumed per fill. Unset walks the whole book. */
  maxLevels?: number;
}

export type FillSource =
  /** Fully filled by walking the book. Priced at realized VWAP. */
  | "book"
  /** Book ran out before the order did. Priced at the VWAP of what actually filled. */
  | "book_partial"
  /** No depth for this bar: priced at the flat rate. */
  | "estimated";

export interface BookFill {
  /** Realized VWAP of the consumed levels, or the flat-rate price when estimated. */
  price: number;
  requestedQuantity: number;
  /** What the book could actually absorb. Below requested only when source is "book_partial". */
  filledQuantity: number;
  levelsConsumed: number;
  source: FillSource;
  /**
   * True when the price did not come from real depth. Callers that mix book and
   * estimated fills without tracking this cannot read their own results.
   */
  estimated: boolean;
}

/** One recorded fill, for post-run inspection of how a backtest was priced. */
export interface FillRecord extends BookFill {
  barIndex: number;
  timestamp: number;
  side: "BUY" | "SELL";
  /** Price the flat-rate model would have produced, for comparison. */
  referencePrice: number;
}

/**
 * Walk `quantity` through the passive side of `depth` and return the realized
 * VWAP.
 *
 * Depth exhaustion is never papered over: the remainder is NOT priced at the
 * last level, it simply does not fill, and the result comes back as
 * "book_partial" so the caller decides what a partially fillable order means.
 */
export function walkBookFill(
  depth: BarDepth,
  side: "BUY" | "SELL",
  quantity: number,
  maxLevels?: number
): BookFill {
  const passive = side === "BUY" ? depth.asks : depth.bids;
  const usable = passive.filter((l) => l.quantity > 0 && Number.isFinite(l.price));

  if (quantity <= 0 || usable.length === 0) {
    return {
      price: 0,
      requestedQuantity: quantity,
      filledQuantity: 0,
      levelsConsumed: 0,
      source: "book_partial",
      estimated: false,
    };
  }

  const book = new OrderBook();
  const makerSide = side === "BUY" ? "sell" : "buy";
  const levels = maxLevels === undefined ? usable : rankedLevels(usable, side).slice(0, maxLevels);
  for (let i = 0; i < levels.length; i++) {
    const level = levels[i]!;
    book.submit({ id: `maker_${i}`, side: makerSide, price: level.price, quantity: level.quantity });
  }

  // A market order takes each maker at the MAKER's price, which is precisely
  // walking the book. `price` is ignored for market orders.
  const fills = book.submit({
    id: "taker",
    side: side === "BUY" ? "buy" : "sell",
    price: 0,
    quantity,
    type: "market",
  });

  let notional = 0;
  let filled = 0;
  const prices = new Set<number>();
  for (const fill of fills) {
    notional += fill.price * fill.quantity;
    filled += fill.quantity;
    prices.add(fill.price);
  }

  const complete = filled >= quantity - 1e-12;
  return {
    price: filled > 0 ? notional / filled : 0,
    requestedQuantity: quantity,
    filledQuantity: filled,
    levelsConsumed: prices.size,
    source: complete ? "book" : "book_partial",
    estimated: false,
  };
}

/** Best-first ordering, so a level cap keeps the levels nearest the touch. */
function rankedLevels(levels: DepthLevel[], side: "BUY" | "SELL"): DepthLevel[] {
  return [...levels].sort((a, b) => (side === "BUY" ? a.price - b.price : b.price - a.price));
}
