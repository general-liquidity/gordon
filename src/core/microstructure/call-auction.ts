/**
 * Call-auction uncross primitive.
 *
 * A single-price call auction (market-on-open / market-on-close, the equity
 * opening/closing cross) collects buy and sell interest and clears everything
 * at ONE equilibrium price. The uncross rule, in exchange priority order:
 *
 *   1. Maximize executable (matched) volume.
 *   2. Break ties by minimizing the order imbalance |demand - supply|.
 *   3. Break remaining ties at the midpoint of the surviving price range.
 *
 * At a candidate price P, demand is the quantity of all buy interest willing to
 * pay at least P (limit price >= P), and supply is the quantity of all sell
 * interest willing to accept at most P (limit price <= P). Matched volume is
 * min(demand, supply). Demand is non-increasing in P and supply is
 * non-decreasing in P, so the volume-maximizing prices form a contiguous band;
 * the optimum always sits at one of the submitted limit prices, so only those
 * are enumerated.
 *
 * Market orders (no limit price) are unconditional: a market buy adds to demand
 * at every candidate price, a market sell adds to supply at every candidate
 * price. Represent them with price = +Infinity (buy) / price = 0 or -Infinity
 * (sell) at the boundary, or pass `market: true`.
 *
 * Pure and deterministic: no clock, no randomness, no allocation of the input.
 */

export interface AuctionOrder {
  /** Limit price. Ignored when `market` is true. */
  price: number;
  /** Order quantity (base units). Non-positive quantities are ignored. */
  quantity: number;
  /** When true, the order executes at any clearing price (market-on-open/close). */
  market?: boolean;
}

export interface UncrossResult {
  /** Equilibrium clearing price, or null when nothing crosses. */
  price: number | null;
  /** Matched (executable) volume at the clearing price. */
  volume: number;
  /** Residual order imbalance |demand - supply| at the clearing price. */
  imbalance: number;
}

const NO_CROSS: UncrossResult = { price: null, volume: 0, imbalance: 0 };

/** Total demand at price p: market buys + limit buys with price >= p. */
function demandAt(bids: AuctionOrder[], p: number): number {
  let q = 0;
  for (const b of bids) {
    if (b.quantity <= 0) continue;
    if (b.market === true || b.price >= p) q += b.quantity;
  }
  return q;
}

/** Total supply at price p: market sells + limit sells with price <= p. */
function supplyAt(asks: AuctionOrder[], p: number): number {
  let q = 0;
  for (const a of asks) {
    if (a.quantity <= 0) continue;
    if (a.market === true || a.price <= p) q += a.quantity;
  }
  return q;
}

/**
 * Find the single equilibrium clearing price that maximizes matched volume.
 *
 * @param bids buy interest (limit or market)
 * @param asks sell interest (limit or market)
 * @returns clearing price + matched volume + residual imbalance; null price when no cross exists
 */
export function uncross(bids: AuctionOrder[], asks: AuctionOrder[]): UncrossResult {
  if (bids.length === 0 || asks.length === 0) return NO_CROSS;

  // Candidate prices: the distinct limit prices from both sides. Market orders
  // carry no price and only shift the demand/supply curves at those candidates.
  const candidates = new Set<number>();
  for (const b of bids) {
    if (b.quantity > 0 && b.market !== true && Number.isFinite(b.price)) candidates.add(b.price);
  }
  for (const a of asks) {
    if (a.quantity > 0 && a.market !== true && Number.isFinite(a.price)) candidates.add(a.price);
  }
  if (candidates.size === 0) return NO_CROSS;

  const prices = Array.from(candidates).sort((x, y) => x - y);

  let bestVolume = -1;
  let bestImbalance = Number.POSITIVE_INFINITY;
  const tied: number[] = [];

  for (const p of prices) {
    const demand = demandAt(bids, p);
    const supply = supplyAt(asks, p);
    const matched = Math.min(demand, supply);
    if (matched <= 0) continue;
    const imbalance = Math.abs(demand - supply);

    if (matched > bestVolume || (matched === bestVolume && imbalance < bestImbalance)) {
      bestVolume = matched;
      bestImbalance = imbalance;
      tied.length = 0;
      tied.push(p);
    } else if (matched === bestVolume && imbalance === bestImbalance) {
      tied.push(p);
    }
  }

  if (bestVolume <= 0) return NO_CROSS;

  // Midpoint of the surviving (sorted) price band as the final deterministic tie-break.
  const price = (tied[0]! + tied[tied.length - 1]!) / 2;
  return { price, volume: bestVolume, imbalance: bestImbalance };
}
