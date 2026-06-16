/**
 * Book-imbalance primitives over a raw L2 snapshot expressed as parallel
 * arrays (the shape the Model to Market parquet ladders arrive in:
 * `bidprices`/`bidsizes`/`askprices`/`asksizes`, up to 5 levels each).
 *
 * Sibling to `order-book-imbalance.ts`, which works over an
 * `OrderBookSnapshot` of `{price, quantity}` levels and adds rolling
 * standardization / fair-price machinery. This file is the lower-level,
 * allocation-free primitive: it takes the four parallel arrays directly so a
 * tick-loop (or the Python feature extractor's TS mirror) can compute the raw
 * imbalance / microprice / spread without building intermediate objects.
 *
 * Math:
 *   Imbalance:  (Σ bidSizes − Σ askSizes) / (Σ bidSizes + Σ askSizes) ∈ [−1, +1]
 *               positive = bid-heavy. Optional depth-weighting weights nearer
 *               (top-of-book) levels more, so a thick far level doesn't drown a
 *               thin top-of-book.
 *   Microprice: (bestBid·askSize + bestAsk·bidSize) / (bidSize + askSize)
 *               size-weighted top-of-book — leans toward the THICKER side
 *               (more size on the bid pushes the microprice up toward the ask).
 *   Spread:     bestAsk − bestBid.
 *   WeightedMid: plain top-of-book mid (bestBid + bestAsk) / 2.
 *
 * Defensive at this boundary only: ladders may be empty, uneven, or carry
 * NaN/negative sizes. Negative sizes are clamped to 0; missing levels are
 * skipped. This is the validation boundary — downstream callers trust the
 * outputs.
 */

export interface L2Ladder {
  bidPrices: number[];
  bidSizes: number[];
  askPrices: number[];
  askSizes: number[];
}

export interface ImbalanceOptions {
  /**
   * Depth-weight nearer levels. When true, level i (0 = top of book) is
   * weighted 1/(i+1) so the top of book dominates. Default false (flat sum).
   */
  depthWeighted?: boolean;
}

/** Sum sizes, clamping negatives/NaN to 0, optionally weighting nearer levels more. */
function sumSizes(sizes: number[], depthWeighted: boolean): number {
  let total = 0;
  for (let i = 0; i < sizes.length; i++) {
    const s = sizes[i];
    const clamped = typeof s === "number" && s > 0 ? s : 0;
    total += depthWeighted ? clamped / (i + 1) : clamped;
  }
  return total;
}

/**
 * Order-book imbalance ∈ [−1, +1]. Positive = bid-heavy.
 * Empty / zero-size book → 0.
 */
export function orderBookImbalance(
  bidSizes: number[],
  askSizes: number[],
  options: ImbalanceOptions = {},
): number {
  const weighted = options.depthWeighted ?? false;
  const bid = sumSizes(bidSizes, weighted);
  const ask = sumSizes(askSizes, weighted);
  const denom = bid + ask;
  if (denom === 0) return 0;
  return (bid - ask) / denom;
}

/** First level with a finite, positive price/size pair, else undefined. */
function topOfBook(prices: number[], sizes: number[]): { price: number; size: number } | undefined {
  const price = prices[0];
  const size = sizes[0];
  if (typeof price !== "number" || !Number.isFinite(price)) return undefined;
  return { price, size: typeof size === "number" && size > 0 ? size : 0 };
}

/**
 * Size-weighted top-of-book microprice. Leans toward the thicker side.
 *
 * Empty-side guards (documented):
 *   - Both sides empty → 0.
 *   - One side empty → the available side's best price.
 *   - Both present but zero total size → falls back to the plain mid.
 */
export function microprice(
  bidPrices: number[],
  bidSizes: number[],
  askPrices: number[],
  askSizes: number[],
): number {
  const bid = topOfBook(bidPrices, bidSizes);
  const ask = topOfBook(askPrices, askSizes);

  if (!bid && !ask) return 0;
  if (!bid) return ask!.price;
  if (!ask) return bid.price;

  const totalSize = bid.size + ask.size;
  if (totalSize === 0) return (bid.price + ask.price) / 2;

  // Weight each side's price by the OPPOSITE side's size → leans to the thicker side.
  return (bid.price * ask.size + ask.price * bid.size) / totalSize;
}

/**
 * Top-of-book spread (bestAsk − bestBid). Returns NaN when either side is
 * empty (no defined spread).
 */
export function topOfBookSpread(bidPrices: number[], askPrices: number[]): number {
  const bid = bidPrices[0];
  const ask = askPrices[0];
  if (typeof bid !== "number" || !Number.isFinite(bid)) return NaN;
  if (typeof ask !== "number" || !Number.isFinite(ask)) return NaN;
  return ask - bid;
}

/**
 * Plain top-of-book mid (bestBid + bestAsk) / 2.
 * One side empty → the available side's best price. Both empty → 0.
 */
export function weightedMid(bidPrices: number[], askPrices: number[]): number {
  const bid = bidPrices[0];
  const ask = askPrices[0];
  const haveBid = typeof bid === "number" && Number.isFinite(bid);
  const haveAsk = typeof ask === "number" && Number.isFinite(ask);
  if (haveBid && haveAsk) return (bid! + ask!) / 2;
  if (haveBid) return bid!;
  if (haveAsk) return ask!;
  return 0;
}
