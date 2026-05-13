/**
 * Realistic Cost Model + Capacity Sweep.
 *
 * Port of the cost-and-capacity methodology from the AI-Quant article.
 *
 * Constant fee-bps is a lie. Real trading cost is composed of:
 *   1. Half-spread     ≈ baseSpread + spreadVolCoef * realizedVol
 *   2. Market impact   ≈ impactCoef * sqrt(orderSize / ADV) * 1e4   (in bps)
 *   3. Venue/clearing  ≈ flat per-venue bps
 *
 * The square-root impact law is the canonical empirical regularity (Almgren,
 * Thierry-Foucault, et al.). Linear at small size, sub-linear at large size.
 *
 * The *capacity sweep* is the methodology that matters: take a strategy's
 * intended position sizes and sweep them against ADV, computing realized
 * Sharpe after costs at each size point. The curve tells you where the
 * strategy stops working — its capacity.
 *
 * This module is research-side. Gordon's live cost models (venue-specific,
 * adapter-level) stay separate.
 */

export interface CostModelParams {
  /** Base half-spread in bps before vol adjustment. Default 1.5. */
  baseSpreadBps: number;
  /**
   * Vol multiplier on half-spread. cost += vol * coef where vol is the
   * realized vol fraction (e.g. 0.02 = 2%/day). Default 5.
   */
  spreadVolCoef: number;
  /**
   * Impact coefficient: bps = coef * sqrt(orderSize / adv) * 100.
   * Default 10 yields ~10 bps at 1% of ADV.
   */
  impactCoef: number;
  /** Venue fee in bps. */
  venueBps: number;
}

export interface VenueParams {
  /** Venue id (lit / dark / rfq / amm / ...). */
  id: string;
  venueBps: number;
}

export const DEFAULT_VENUES: readonly VenueParams[] = [
  { id: "lit", venueBps: 0.3 },
  { id: "dark", venueBps: 0.2 },
  { id: "rfq", venueBps: 0.5 },
  { id: "amm", venueBps: 5.0 },
] as const;

export const DEFAULT_COST_PARAMS: CostModelParams = {
  baseSpreadBps: 1.5,
  spreadVolCoef: 5,
  impactCoef: 10,
  venueBps: 0.3,
};

export interface CostBreakdownInput {
  /** Order size in same units as ADV (typically shares or notional). */
  orderSize: number;
  /** Average daily volume in same units. */
  adv: number;
  /** Realized vol as a fraction (e.g. 0.02 = 2%). */
  vol: number;
  /** Venue id or full venue params. Default 'lit'. */
  venue?: string | VenueParams;
}

export interface CostBreakdown {
  halfSpreadBps: number;
  impactBps: number;
  venueBps: number;
  totalBps: number;
  /** ADV fraction = orderSize / adv. */
  advFraction: number;
}

function resolveVenue(
  venue: string | VenueParams | undefined,
  params: CostModelParams,
): number {
  if (venue === undefined) return params.venueBps;
  if (typeof venue === "string") {
    const found = DEFAULT_VENUES.find((v) => v.id === venue);
    return found?.venueBps ?? params.venueBps;
  }
  return venue.venueBps;
}

/** Compute the full cost breakdown in bps for a single order. */
export function realisticCostBps(
  input: CostBreakdownInput,
  params: CostModelParams = DEFAULT_COST_PARAMS,
): CostBreakdown {
  if (input.adv <= 0) {
    throw new Error("ADV must be > 0");
  }
  if (input.orderSize < 0) {
    throw new Error("Order size must be >= 0");
  }
  const halfSpreadBps = (params.baseSpreadBps + params.spreadVolCoef * input.vol) / 2;
  const advFraction = input.orderSize / input.adv;
  const impactBps = params.impactCoef * Math.sqrt(advFraction) * 100;
  const venueBps = resolveVenue(input.venue, params);
  return {
    halfSpreadBps,
    impactBps,
    venueBps,
    totalBps: halfSpreadBps + impactBps + venueBps,
    advFraction,
  };
}

// ============================================================================
// Capacity sweep
// ============================================================================

export interface CapacitySweepInput {
  /** Gross Sharpe BEFORE costs. */
  grossSharpe: number;
  /** Annualized return without costs. */
  grossReturnAnn: number;
  /** Annualized vol (used to convert cost bps → Sharpe drag). */
  volAnn: number;
  /** Average daily volume to size against. */
  adv: number;
  /** Realized vol (fraction). */
  vol: number;
  /** Average daily turnover for the strategy (one-way, fraction of position). */
  turnoverPerDay: number;
  /** Days per year for annualization. Default 252. */
  daysPerYear?: number;
  /** Venue id or override params. */
  venue?: string | VenueParams;
  /** Cost-model params. Default DEFAULT_COST_PARAMS. */
  costParams?: CostModelParams;
  /** Order-size points to evaluate. Default log-spaced 1bp .. 10% ADV. */
  sizePoints?: number[];
}

export interface CapacityPoint {
  orderSize: number;
  advFraction: number;
  costBps: number;
  netReturnAnn: number;
  netSharpe: number;
}

export interface CapacityCurve {
  points: CapacityPoint[];
  /** Largest order size where netSharpe >= 0.5 (default capacity threshold). */
  capacityAtMinSharpe: number | null;
  /** Threshold used. */
  minSharpe: number;
}

function defaultSizePoints(adv: number): number[] {
  // Log-spaced from 0.0001% to 10% of ADV
  const out: number[] = [];
  for (let exp = -6; exp <= -1; exp += 0.5) {
    out.push(adv * Math.pow(10, exp));
  }
  return out;
}

/**
 * Compute net Sharpe as a function of order size. Costs scale with sqrt(ADV
 * fraction); annualized cost drag = (cost bps / 1e4) * turnoverPerDay * daysPerYear.
 *
 * Returns the size at which net Sharpe falls below `minSharpe` (default 0.5)
 * — the strategy's effective capacity at this turnover.
 */
export function capacitySweep(
  input: CapacitySweepInput,
  minSharpe: number = 0.5,
): CapacityCurve {
  if (input.adv <= 0) throw new Error("ADV must be > 0");
  if (input.volAnn <= 0) throw new Error("Annualized vol must be > 0");

  const daysPerYear = input.daysPerYear ?? 252;
  const sizes = input.sizePoints ?? defaultSizePoints(input.adv);
  const costParams = input.costParams ?? DEFAULT_COST_PARAMS;

  const points: CapacityPoint[] = sizes.map((orderSize) => {
    const cost = realisticCostBps(
      { orderSize, adv: input.adv, vol: input.vol, venue: input.venue },
      costParams,
    );
    const costDragAnn = (cost.totalBps / 1e4) * input.turnoverPerDay * daysPerYear;
    const netReturnAnn = input.grossReturnAnn - costDragAnn;
    const netSharpe = netReturnAnn / input.volAnn;
    return {
      orderSize,
      advFraction: cost.advFraction,
      costBps: cost.totalBps,
      netReturnAnn,
      netSharpe,
    };
  });

  // Capacity = largest size where netSharpe >= minSharpe
  let capacity: number | null = null;
  for (const p of points) {
    if (p.netSharpe >= minSharpe) {
      if (capacity === null || p.orderSize > capacity) capacity = p.orderSize;
    }
  }

  return { points, capacityAtMinSharpe: capacity, minSharpe };
}

export function capacityToPayload(curve: CapacityCurve): Record<string, unknown> {
  return {
    kind: "capacity.sweep_recorded",
    minSharpe: curve.minSharpe,
    capacityAtMinSharpe: curve.capacityAtMinSharpe,
    pointCount: curve.points.length,
    points: curve.points.map((p) => ({
      orderSize: p.orderSize,
      advFraction: p.advFraction,
      costBps: p.costBps,
      netSharpe: p.netSharpe,
    })),
  };
}
