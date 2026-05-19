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

// ============================================================================
// Efficient Trading Frontier (Kissell ch. 14-15 / Almgren-Chriss)
// ============================================================================
//
// For a *fixed* order size, longer execution horizons reduce expected
// market impact (lower participation rate per slot → smaller per-trade
// price push) but increase timing risk (variance of mid-price drift
// over the longer window). The trader's optimal horizon depends on
// risk aversion λ.
//
// Expected impact cost (bps), Almgren-Chriss style:
//   E[impact] ≈ impactCoef * sqrt(participationRate) * 100
//   where participationRate = orderSize / (adv * horizonDays)
//
// Timing risk (bps, one stdev of price drift over the horizon):
//   σ[drift] ≈ vol * sqrt(horizonDays / daysPerYear) * 1e4
//
// Total cost objective:
//   J(T) = E[impact](T) + λ * σ[drift](T)
//
// The frontier is the parametric curve {(σ, E[impact]) : T > 0}; the
// optimal horizon under risk aversion λ minimizes J(T).

export interface FrontierInput {
  /** Order size to execute (same units as ADV). */
  orderSize: number;
  /** Average daily volume in same units. */
  adv: number;
  /** Realized intraday vol as a fraction (e.g. 0.02 = 2% daily). */
  vol: number;
  /** Annualized vol — used to convert horizon-σ to bps. Default = vol * sqrt(daysPerYear). */
  volAnn?: number;
  /** Risk aversion λ — weight on timing risk in the objective. Default 1. */
  riskAversion?: number;
  /** Horizon points (in days) to evaluate. Default 0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10. */
  horizonDays?: number[];
  /** Days per year for annualization. Default 252. */
  daysPerYear?: number;
  /** Venue id or override params. */
  venue?: string | VenueParams;
  /** Cost-model params. Default DEFAULT_COST_PARAMS. */
  costParams?: CostModelParams;
}

export interface FrontierPoint {
  horizonDays: number;
  participationRate: number;
  expectedImpactBps: number;
  /** One-stdev of price drift over the horizon, in bps. */
  timingRiskBps: number;
  /** Half-spread + venue + impact, in bps. */
  expectedCostBps: number;
  /** J = expectedCost + λ * timingRisk. */
  totalObjectiveBps: number;
}

export interface EfficientTradingFrontier {
  points: FrontierPoint[];
  /** Horizon (days) that minimizes the cost-risk objective J. */
  optimalHorizonDays: number;
  /** Risk aversion used. */
  riskAversion: number;
  /** orderSize / adv — useful for capacity callouts. */
  orderSizeAdvFraction: number;
}

const DEFAULT_HORIZON_DAYS: number[] = [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10];

/**
 * Sweep execution horizons for a fixed order size and return the
 * cost-vs-timing-risk frontier plus the horizon that minimizes the
 * weighted objective J(T) = impact(T) + λ * σ(T).
 *
 * Concrete shape used in fund TCA: rendered as a curve with horizon
 * on x-axis, expected cost on y-axis (impact line) plus a one-stdev
 * timing-risk band. The minimizer of J is the "patient" point; the
 * far-left horizon is the "aggressive" point.
 */
export function efficientTradingFrontier(input: FrontierInput): EfficientTradingFrontier {
  if (input.orderSize <= 0) throw new Error("orderSize must be > 0");
  if (input.adv <= 0) throw new Error("adv must be > 0");
  if (input.vol < 0) throw new Error("vol must be >= 0");

  const horizons = input.horizonDays ?? DEFAULT_HORIZON_DAYS;
  const daysPerYear = input.daysPerYear ?? 252;
  const lambda = input.riskAversion ?? 1;
  const volAnn = input.volAnn ?? input.vol * Math.sqrt(daysPerYear);
  const costParams = input.costParams ?? DEFAULT_COST_PARAMS;
  const venueBps = resolveVenue(input.venue, costParams);

  const orderSizeAdvFraction = input.orderSize / input.adv;
  const halfSpreadBps = (costParams.baseSpreadBps + costParams.spreadVolCoef * input.vol) / 2;

  const points: FrontierPoint[] = horizons.map((T) => {
    if (T <= 0) throw new Error(`horizonDays entries must be > 0 (got ${T})`);
    const participationRate = input.orderSize / (input.adv * T);
    const expectedImpactBps =
      costParams.impactCoef * Math.sqrt(participationRate) * 100;
    const timingRiskBps = volAnn * Math.sqrt(T / daysPerYear) * 1e4;
    const expectedCostBps = halfSpreadBps + expectedImpactBps + venueBps;
    const totalObjectiveBps = expectedCostBps + lambda * timingRiskBps;
    return {
      horizonDays: T,
      participationRate,
      expectedImpactBps,
      timingRiskBps,
      expectedCostBps,
      totalObjectiveBps,
    };
  });

  let optimalHorizonDays = points[0]!.horizonDays;
  let bestObjective = points[0]!.totalObjectiveBps;
  for (const p of points) {
    if (p.totalObjectiveBps < bestObjective) {
      bestObjective = p.totalObjectiveBps;
      optimalHorizonDays = p.horizonDays;
    }
  }

  return {
    points,
    optimalHorizonDays,
    riskAversion: lambda,
    orderSizeAdvFraction,
  };
}

export function efficientTradingFrontierToPayload(
  frontier: EfficientTradingFrontier,
): Record<string, unknown> {
  return {
    kind: "efficient_trading_frontier.computed",
    optimalHorizonDays: frontier.optimalHorizonDays,
    riskAversion: frontier.riskAversion,
    orderSizeAdvFraction: Number(frontier.orderSizeAdvFraction.toFixed(6)),
    pointCount: frontier.points.length,
    points: frontier.points.map((p) => ({
      horizonDays: p.horizonDays,
      participationRate: Number(p.participationRate.toFixed(6)),
      expectedImpactBps: Number(p.expectedImpactBps.toFixed(2)),
      timingRiskBps: Number(p.timingRiskBps.toFixed(2)),
      expectedCostBps: Number(p.expectedCostBps.toFixed(2)),
      totalObjectiveBps: Number(p.totalObjectiveBps.toFixed(2)),
    })),
  };
}
