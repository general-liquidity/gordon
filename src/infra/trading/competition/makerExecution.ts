// Maker-side execution for the dollar-neutral RV core. The competition permits
// resting limit orders, so each leg can REST as a maker (earn ~half the spread)
// instead of crossing as a taker. Two pure problems live here:
//   (1) where to rest each limit (passive side of the book, optionally improved),
//   (2) protecting against UN-HEDGING — if some legs fill and others don't, the
//       "neutral" book drifts net-directional, so once drift breaches a band we
//       complete the laggard legs as TAKER to restore neutrality.

export interface Quote {
  bid: number;
  ask: number;
}

export interface MakerLeg {
  symbol: string;
  // Signed target/filled notional: + long, − short.
  targetNotional: number;
  filledNotional: number;
}

export interface CompletionOrder {
  symbol: string;
  side: "buy" | "sell";
  notional: number;
}

/**
 * Resting limit price for a maker order.
 *
 * A BUY rests at the bid (passive — earns the spread when a seller crosses);
 * a SELL rests at the ask. `insideBps` optionally improves the price toward mid
 * by that many bps (more aggressive fill, less rebate), but never past mid, so
 * the order stays on the passive side of the book.
 */
export function makerLimitPrice(
  side: "buy" | "sell",
  quote: Quote,
  opts?: { insideBps?: number },
): number {
  const { bid, ask } = quote;
  if (!(bid > 0 && ask > 0 && ask >= bid)) {
    // Degenerate / crossed book: fall back to mid if computable, else 0.
    if (bid > 0 && ask > 0) return (bid + ask) / 2;
    return 0;
  }

  const mid = (bid + ask) / 2;
  const insideBps = opts?.insideBps ?? 0;
  const improve = insideBps / 1e4;

  if (side === "buy") {
    const price = bid * (1 + improve);
    return Math.min(price, mid);
  }
  const price = ask * (1 - improve);
  return Math.max(price, mid);
}

/**
 * Realized maker edge vs the mid at post time, in bps.
 *
 * BUY  → (refMid − fillPrice)/refMid·1e4 (positive = filled BELOW mid = good).
 * SELL → (fillPrice − refMid)/refMid·1e4 (positive = filled ABOVE mid = good).
 *
 * A maker SHOULD be positive; negative means adverse selection (the market moved
 * through the resting order before it filled).
 */
export function adverseSelectionBps(
  side: "buy" | "sell",
  fillPrice: number,
  refMid: number,
): number {
  if (!(refMid > 0)) return 0;
  if (side === "buy") {
    return ((refMid - fillPrice) / refMid) * 1e4;
  }
  return ((fillPrice - refMid) / refMid) * 1e4;
}

/**
 * Un-hedge protection for the resting-maker book.
 *
 * grossTarget = Σ|targetNotional|, netFilled = Σ filledNotional.
 * If the book is still acceptably hedged (|netFilled|/grossTarget within band,
 * default 0.15) we keep resting as maker and emit nothing. Once the net drift
 * breaches the band the book has become directional, so we lock it by completing
 * EVERY laggard leg as TAKER: each leg's gap = target − filled becomes an order.
 */
export function unhedgeCompletion(
  legs: readonly MakerLeg[],
  opts?: { maxNetFraction?: number },
): CompletionOrder[] {
  const maxNetFraction = opts?.maxNetFraction ?? 0.15;

  let grossTarget = 0;
  let netFilled = 0;
  for (const leg of legs) {
    grossTarget += Math.abs(leg.targetNotional);
    netFilled += leg.filledNotional;
  }

  if (grossTarget <= 0) return [];
  if (Math.abs(netFilled) / grossTarget <= maxNetFraction) return [];

  const tiny = 1e-9 * grossTarget;
  const orders: CompletionOrder[] = [];
  for (const leg of legs) {
    const gap = leg.targetNotional - leg.filledNotional;
    if (Math.abs(gap) > tiny) {
      orders.push({
        symbol: leg.symbol,
        side: gap > 0 ? "buy" : "sell",
        notional: Math.abs(gap),
      });
    }
  }
  return orders;
}
