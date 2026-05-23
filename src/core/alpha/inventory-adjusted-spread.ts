/**
 * Inventory-Adjusted Optimal Market-Making Spread (Avellaneda-Stoikov)
 *
 * Two-sided market-maker quoting primitive: given current inventory,
 * risk aversion, asset volatility, and order-arrival intensity,
 * compute the reservation price (skewed away from mid by inventory)
 * and the optimal half-spread on each side. The maker who's already
 * long tightens the ask (wants to unload) and widens the bid (doesn't
 * want more longs); short inventory reverses both.
 *
 * Distinct from:
 *   - `optimalLimitDepth.ts` (CJ3)  — single-sided POSTING depth for
 *                                     executing a target. This primitive
 *                                     is two-sided market-making with
 *                                     inventory skew.
 *   - `position-sizer.ts` (Kelly)   — expected-utility-optimal sizing,
 *                                     no inventory state, no per-side
 *                                     quote setpoint.
 *   - `wipeout-cap-sizer.ts`        — worst-case-bounded sizing.
 *   - `internalBatch.ts`            — post-decision matching, not
 *                                     pre-decision quoting.
 *
 * Composes with: any market-maker workflow. Operator supplies
 * inventory state + market parameters; primitive returns
 * (reservationPrice, bidDepth, askDepth, bidPrice, askPrice).
 *
 * Model (Avellaneda-Stoikov 2008, simplified):
 *
 *   Reservation price:
 *     r(s, q, t) = s − q · γ · σ² · (T − t)
 *
 *   Optimal spread (symmetric around r):
 *     δ_total = γ · σ² · (T − t) + (2/γ) · ln(1 + γ/k)
 *
 *   Bid/ask:
 *     bid = r − δ_total/2
 *     ask = r + δ_total/2
 *
 * where:
 *   s = mid price
 *   q = signed inventory (positive = long)
 *   γ = risk aversion coefficient
 *   σ = volatility (per period)
 *   T − t = time horizon remaining (in same units as σ)
 *   k = order-arrival intensity decay
 *
 * Pure function.
 */

export interface InventoryAdjustedSpreadInput {
  /** Current mid price. */
  midPrice: number;
  /**
   * Signed inventory position. Positive = long, negative = short.
   * Units must match the operator's expectation (typically shares or
   * base-currency units).
   */
  inventory: number;
  /**
   * Risk aversion coefficient γ. Higher = more eager to skew quotes
   * to flatten inventory. Default 0.1.
   */
  riskAversion?: number;
  /**
   * Per-period volatility σ of the mid. Same units as price changes
   * over one period of T.
   */
  volatility: number;
  /**
   * Time horizon remaining (T − t). Same time units as σ. For an
   * intraday market-maker, this might be "minutes until close." For
   * a multi-day operator, it might be "days until inventory must be
   * flattened."
   */
  timeRemaining: number;
  /**
   * Order-arrival intensity decay k. The fill-rate function is
   * proportional to exp(−k · δ) where δ is the depth from mid. Higher
   * k = fills drop off faster as you widen the quote.
   */
  intensityDecay: number;
  /**
   * Optional inventory band that triggers "stop quoting one side"
   * behavior. If |inventory| ≥ this, the offending side is widened to
   * effectively pull the quote. Default Infinity (no pull).
   */
  inventoryHardLimit?: number;
}

export type SpreadVerdict =
  | "two_sided"
  | "long_capped"
  | "short_capped"
  | "invalid_inputs";

export interface InventoryAdjustedSpreadResult {
  midPrice: number;
  reservationPrice: number;
  /** r − s. Negative when long (want to sell); positive when short. */
  reservationSkew: number;
  /** Optimal total spread δ_total. */
  totalSpread: number;
  /** Per-side half-spread. */
  halfSpread: number;
  bidPrice: number;
  askPrice: number;
  /** Inventory-pull boolean: true if hard-limit-side was pulled. */
  bidPulled: boolean;
  askPulled: boolean;
  verdict: SpreadVerdict;
  summary: string;
}

const DEFAULT_RISK_AVERSION = 0.1;
const DEFAULT_INVENTORY_LIMIT = Infinity;

export function computeInventoryAdjustedSpread(
  input: InventoryAdjustedSpreadInput,
): InventoryAdjustedSpreadResult {
  const gamma = input.riskAversion ?? DEFAULT_RISK_AVERSION;
  const invLimit = input.inventoryHardLimit ?? DEFAULT_INVENTORY_LIMIT;

  if (
    !(input.midPrice > 0) ||
    !(input.volatility >= 0) ||
    !(input.timeRemaining > 0) ||
    !(input.intensityDecay > 0) ||
    !(gamma > 0)
  ) {
    return {
      midPrice: input.midPrice,
      reservationPrice: input.midPrice,
      reservationSkew: 0,
      totalSpread: 0,
      halfSpread: 0,
      bidPrice: input.midPrice,
      askPrice: input.midPrice,
      bidPulled: false,
      askPulled: false,
      verdict: "invalid_inputs",
      summary: "Invalid inputs: midPrice/timeRemaining/intensityDecay/gamma must be > 0; volatility ≥ 0.",
    };
  }

  const variance = input.volatility * input.volatility;
  // Inventory-skewed reservation price
  const reservationSkew = -input.inventory * gamma * variance * input.timeRemaining;
  const reservationPrice = input.midPrice + reservationSkew;

  // Optimal total spread
  const inventoryTerm = gamma * variance * input.timeRemaining;
  const competitiveTerm = (2 / gamma) * Math.log(1 + gamma / input.intensityDecay);
  const totalSpread = inventoryTerm + competitiveTerm;
  const halfSpread = totalSpread / 2;

  let bidPrice = reservationPrice - halfSpread;
  let askPrice = reservationPrice + halfSpread;
  let bidPulled = false;
  let askPulled = false;
  let verdict: SpreadVerdict = "two_sided";

  // Inventory hard-limit pull: when too long, widen the bid (don't
  // accept more longs); when too short, widen the ask
  if (Number.isFinite(invLimit) && Math.abs(input.inventory) >= invLimit) {
    if (input.inventory > 0) {
      bidPrice = reservationPrice - halfSpread * 10;
      bidPulled = true;
      verdict = "long_capped";
    } else if (input.inventory < 0) {
      askPrice = reservationPrice + halfSpread * 10;
      askPulled = true;
      verdict = "short_capped";
    }
  }

  const summary =
    `Mid ${input.midPrice.toFixed(4)}, inventory ${input.inventory >= 0 ? "+" : ""}${input.inventory}. ` +
    `Reservation ${reservationPrice.toFixed(4)} (skew ${reservationSkew >= 0 ? "+" : ""}${reservationSkew.toFixed(4)}). ` +
    `Spread ${totalSpread.toFixed(4)} → bid ${bidPrice.toFixed(4)}, ask ${askPrice.toFixed(4)}. ` +
    `Verdict: ${verdict}` +
    (bidPulled ? "; BID PULLED (over-long inventory)" : "") +
    (askPulled ? "; ASK PULLED (over-short inventory)" : "") +
    ".";

  return {
    midPrice: input.midPrice,
    reservationPrice: parseFloat(reservationPrice.toFixed(8)),
    reservationSkew: parseFloat(reservationSkew.toFixed(8)),
    totalSpread: parseFloat(totalSpread.toFixed(8)),
    halfSpread: parseFloat(halfSpread.toFixed(8)),
    bidPrice: parseFloat(bidPrice.toFixed(8)),
    askPrice: parseFloat(askPrice.toFixed(8)),
    bidPulled,
    askPulled,
    verdict,
    summary,
  };
}

export function formatInventoryAdjustedSpread(
  result: InventoryAdjustedSpreadResult,
): string {
  const lines = [
    `Inventory-Adjusted Spread — ${result.verdict.toUpperCase()}`,
    "",
    `  Mid price:         ${result.midPrice.toFixed(4)}`,
    `  Reservation price: ${result.reservationPrice.toFixed(4)}`,
    `  Reservation skew:  ${result.reservationSkew >= 0 ? "+" : ""}${result.reservationSkew.toFixed(4)}`,
    `  Total spread:      ${result.totalSpread.toFixed(4)}`,
    `  Half spread:       ${result.halfSpread.toFixed(4)}`,
    "",
    `  Bid:               ${result.bidPrice.toFixed(4)}${result.bidPulled ? "  ← PULLED" : ""}`,
    `  Ask:               ${result.askPrice.toFixed(4)}${result.askPulled ? "  ← PULLED" : ""}`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
