/**
 * Implementation Shortfall — Perold (1988) + Wagner decomposition.
 *
 * Canonical institutional post-trade TCA primitive. Decomposes the gap
 * between the "paper" trade (filled instantly at decision price) and
 * the actually realized trade into four buckets:
 *
 *   1. Delay cost     — market moved between decision and order entry
 *   2. Market impact  — price moved against us as we executed
 *   3. Opportunity    — missed gain on the unexecuted portion
 *   4. Fees           — explicit commissions / venue fees
 *
 *   IS_total = delay + impact + opportunity + fees   (positive = cost)
 *
 * Side convention: BUY=+1, SELL=-1. A BUY whose price went up between
 * decision and arrival is a positive delay cost; a SELL whose price
 * went down is a positive delay cost. The math is symmetric.
 *
 * Reference: Kissell, "Algorithmic Trading Methods" (2nd ed., 2020),
 * ch. 3 — also Perold (1988) "The implementation shortfall: paper vs
 * reality" and Wagner-Edwards (1993).
 *
 * Composes with:
 *   - `frictionTracker` — supplies fee/slippage records per fill
 *   - operator post-trade review — surfaces "where did your edge
 *     leak" by bucket
 *   - capacitySweep / efficientTradingFrontier — pretrade cost
 *     forecast vs realized IS for calibration drift
 *
 * Pure compute. Numerical types only; the caller resolves timestamps
 * to prices.
 */

export type Side = "BUY" | "SELL";

export interface ImplementationShortfallInput {
  /** Price observed when the decision to trade was made (the "paper" price). */
  decisionPrice: number;
  /**
   * Price observed when the order actually hit the market.
   * If you don't track this separately, pass decisionPrice and the delay
   * bucket will be zero (the impact bucket then absorbs all execution drift).
   */
  arrivalPrice: number;
  /** Volume-weighted average fill price across all fills. */
  avgFillPrice: number;
  /**
   * Reference price for the unexecuted residual — typically the close
   * of the day the order was active, or the price at which the order
   * was cancelled.
   */
  closePrice: number;
  /** Quantity the operator decided to trade. */
  decisionQuantity: number;
  /** Quantity actually filled. Must satisfy 0 ≤ filledQuantity ≤ decisionQuantity. */
  filledQuantity: number;
  /** BUY or SELL. */
  side: Side;
  /** Explicit fees paid in account currency (commissions, exchange fees, taxes). Default 0. */
  fees?: number;
}

export interface ShortfallBuckets {
  /** Cost in account currency (positive = cost to the trader). */
  delayCost: number;
  marketImpactCost: number;
  opportunityCost: number;
  fees: number;
  totalCost: number;
}

export interface ImplementationShortfallResult extends ShortfallBuckets {
  /** Cost expressed in bps of notional decision value (decisionQty * decisionPrice). */
  delayCostBps: number;
  marketImpactCostBps: number;
  opportunityCostBps: number;
  feesBps: number;
  totalCostBps: number;
  /** Fraction of the decision quantity that was actually filled (0..1). */
  fillRate: number;
  /** Which bucket dominates the total (largest absolute value). */
  dominantBucket: "delay" | "impact" | "opportunity" | "fees" | "none";
  reasoning: string;
}

function sideMultiplier(side: Side): number {
  return side === "BUY" ? 1 : -1;
}

function pickDominantBucket(b: ShortfallBuckets): ImplementationShortfallResult["dominantBucket"] {
  const entries: [ImplementationShortfallResult["dominantBucket"], number][] = [
    ["delay", Math.abs(b.delayCost)],
    ["impact", Math.abs(b.marketImpactCost)],
    ["opportunity", Math.abs(b.opportunityCost)],
    ["fees", Math.abs(b.fees)],
  ];
  let dom: ImplementationShortfallResult["dominantBucket"] = "none";
  let best = 0;
  for (const [name, mag] of entries) {
    if (mag > best) {
      dom = name;
      best = mag;
    }
  }
  return dom;
}

export function computeImplementationShortfall(
  input: ImplementationShortfallInput,
): ImplementationShortfallResult {
  if (input.decisionQuantity <= 0) {
    throw new Error("decisionQuantity must be > 0");
  }
  if (input.filledQuantity < 0 || input.filledQuantity > input.decisionQuantity) {
    throw new Error(
      `filledQuantity ${input.filledQuantity} out of range [0, ${input.decisionQuantity}]`,
    );
  }
  if (input.decisionPrice <= 0) {
    throw new Error("decisionPrice must be > 0");
  }

  const s = sideMultiplier(input.side);
  const decisionQty = input.decisionQuantity;
  const filledQty = input.filledQuantity;
  const unfilledQty = decisionQty - filledQty;
  const fees = input.fees ?? 0;

  // Perold-Wagner decomposition, all in account currency.
  //
  // For a BUY (s=+1): cost when prices rise between checkpoints.
  // For a SELL (s=-1): cost when prices fall between checkpoints.
  // The multiplier flips both impact and opportunity correctly.
  const delayCost = s * (input.arrivalPrice - input.decisionPrice) * decisionQty;
  const marketImpactCost = s * (input.avgFillPrice - input.arrivalPrice) * filledQty;
  const opportunityCost = s * (input.closePrice - input.decisionPrice) * unfilledQty;
  const totalCost = delayCost + marketImpactCost + opportunityCost + fees;

  const notional = decisionQty * input.decisionPrice;
  const toBps = (cost: number) => (notional > 0 ? (cost / notional) * 1e4 : 0);

  const buckets: ShortfallBuckets = {
    delayCost,
    marketImpactCost,
    opportunityCost,
    fees,
    totalCost,
  };
  const dominantBucket = pickDominantBucket(buckets);

  const fillRate = filledQty / decisionQty;
  const reasoning =
    `IS ${input.side} ${filledQty}/${decisionQty} (fill ${(fillRate * 100).toFixed(1)}%): ` +
    `delay ${toBps(delayCost).toFixed(1)}bps, impact ${toBps(marketImpactCost).toFixed(1)}bps, ` +
    `opportunity ${toBps(opportunityCost).toFixed(1)}bps, fees ${toBps(fees).toFixed(1)}bps ` +
    `→ total ${toBps(totalCost).toFixed(1)}bps (dominant: ${dominantBucket})`;

  return {
    ...buckets,
    delayCostBps: toBps(delayCost),
    marketImpactCostBps: toBps(marketImpactCost),
    opportunityCostBps: toBps(opportunityCost),
    feesBps: toBps(fees),
    totalCostBps: toBps(totalCost),
    fillRate,
    dominantBucket,
    reasoning,
  };
}

export function implementationShortfallToPayload(
  result: ImplementationShortfallResult,
): Record<string, unknown> {
  return {
    kind: "implementation_shortfall.computed",
    fillRate: Number(result.fillRate.toFixed(4)),
    dominantBucket: result.dominantBucket,
    totalCostBps: Number(result.totalCostBps.toFixed(2)),
    breakdownBps: {
      delay: Number(result.delayCostBps.toFixed(2)),
      impact: Number(result.marketImpactCostBps.toFixed(2)),
      opportunity: Number(result.opportunityCostBps.toFixed(2)),
      fees: Number(result.feesBps.toFixed(2)),
    },
  };
}
