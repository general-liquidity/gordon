/**
 * Economic order floor and fee-worsening split check.
 *
 * DISTINCT FROM THE VENUE MINIMUM. `SymbolFilters.minNotional`
 * (src/infra/exchange/types.ts) is the exchange's rule about what it will
 * accept: below it the order is rejected. It says nothing about whether the
 * order makes economic sense to the operator. A $30 order can clear a $10
 * venue minimum and still hand 8% of the trade to the broker. This module is
 * the operator-side test, and the two verdicts are reported separately because
 * they disagree in both directions.
 *
 * WHY THE FLOOR IS DERIVED, NOT TUNED. Auditing AI Investment Recommendations
 * as Executable Actions (2026) reads the floor straight off the fee schedule.
 * With a fixed cost c per started tranche of size T, and a tolerance tau for
 * the fraction of a trade the operator will lose to fees, MIN = c / tau. At
 * c = $2.50 and tau = 1%, MIN = $250; at a $1.00 ticket, $100; at $9.99, $999;
 * at zero commission the guardrail collapses to nothing, which is correct. A
 * derived floor stays right when the fee schedule changes; a tuned constant
 * does not.
 *
 * WHY THE SPLIT CHECK EXISTS. The fee function f(a) = ceil(a / T) * c is
 * subadditive: f(a + b) <= f(a) + f(b). Splitting one order across several
 * symbols therefore can never lower total fees and frequently raises them. The
 * test is exact: a split is fee-worsening when sum(ceil(a_i / T)) exceeds
 * ceil(sum(a_i) / T). The rule that follows is "diversify only when the split
 * is fee-neutral, otherwise consolidate". A diversification heuristic blind to
 * this pays for its own diversification twice, so fee-neutral splits are
 * admitted rather than flagged: that is the case where diversification is free.
 *
 * WHY DETERMINISTIC CODE RATHER THAN A PROMPT. The paper's headline
 * measurement: across two frontier models on adversarial scenarios, bare-prompt
 * validity was 0.60 and 0.53; stating the rules in prose moved it to 0.58 and
 * 0.57, which is nothing; supplying the arithmetic deterministically moved it
 * to 1.00 and 0.99. Admissibility failure here is computation, not judgment.
 *
 * MONEY REPRESENTATION: integer minor units (cents for a USD schedule), never
 * JavaScript floats. Every operation here is integer addition, integer
 * multiplication, or exact ceiling division, so no binary-fraction rounding can
 * enter. Tolerances and proportional fees are integer basis points for the same
 * reason. Tranche counts are integers by construction, which is a large part of
 * why this check can be exact rather than approximate.
 *
 * Pure and deterministic: no clock, no I/O.
 */

const BPS_PER_UNIT = 10_000;

/** Money in integer minor units. */
export type Minor = number;

export interface FeeSchedule {
  /** Fixed cost c charged per started tranche. */
  fixedPerTrancheMinor: Minor;
  /** Tranche size T. Each started tranche costs c, whether filled or not. */
  trancheSizeMinor: Minor;
  /** Scale-invariant component, in basis points of notional. */
  proportionalBps?: number;
  /** Per-order fee floor, charged when the computed fee falls below it. */
  minimumPerOrderMinor?: Minor;
}

export interface EconomicFloorPolicy {
  /** tau: the fraction of a trade the operator will lose to fees, in bps. */
  feeToleranceBps: number;
}

export interface ProposedOrder {
  symbol: string;
  notionalMinor: Minor;
  /** The venue's own minimum, when known. Judged separately from the floor. */
  venueMinNotionalMinor?: Minor;
}

export type AdmissibilityViolation =
  | {
      kind: "below-economic-floor";
      symbol: string;
      notionalMinor: Minor;
      floorMinor: Minor;
      shortfallMinor: Minor;
    }
  | {
      kind: "below-venue-minimum";
      symbol: string;
      notionalMinor: Minor;
      venueMinNotionalMinor: Minor;
      shortfallMinor: Minor;
    }
  | {
      kind: "fee-worsening-split";
      symbols: string[];
      splitTranches: number;
      consolidatedTranches: number;
      splitFeeMinor: Minor;
      consolidatedFeeMinor: Minor;
      excessCostMinor: Minor;
    };

interface SplitCosts {
  splitTranches: number;
  consolidatedTranches: number;
  splitFeeMinor: Minor;
  consolidatedFeeMinor: Minor;
}

export type SplitVerdict =
  | ({ kind: "single-order"; excessCostMinor: 0 } & SplitCosts)
  | ({ kind: "fee-neutral"; excessCostMinor: 0 } & SplitCosts)
  | ({ kind: "fee-worsening"; excessCostMinor: Minor } & SplitCosts);

export interface OrderVerdict {
  symbol: string;
  notionalMinor: Minor;
  clearsEconomicFloor: boolean;
  clearsVenueMinimum: boolean;
}

export interface AdmissibilityResult {
  admissible: boolean;
  economicFloorMinor: Minor;
  orders: OrderVerdict[];
  split: SplitVerdict;
  violations: AdmissibilityViolation[];
}

/** Exact ceiling division over non-negative integers. */
function ceilDiv(numerator: number, denominator: number): number {
  return Math.floor((numerator + denominator - 1) / denominator);
}

/**
 * Tranches started by a notional. Zero when the schedule has no tranche size,
 * which is how a zero-commission venue is expressed: nothing is ever started.
 */
export function trancheCount(schedule: FeeSchedule, notionalMinor: Minor): number {
  if (schedule.trancheSizeMinor <= 0 || notionalMinor <= 0) return 0;
  return ceilDiv(notionalMinor, schedule.trancheSizeMinor);
}

/** Total fee for a single order of this notional under this schedule. */
export function feeForNotional(schedule: FeeSchedule, notionalMinor: Minor): Minor {
  if (notionalMinor <= 0) return 0;
  const fixed = trancheCount(schedule, notionalMinor) * schedule.fixedPerTrancheMinor;
  const proportional = schedule.proportionalBps
    ? ceilDiv(notionalMinor * schedule.proportionalBps, BPS_PER_UNIT)
    : 0;
  const total = fixed + proportional;
  const minimum = schedule.minimumPerOrderMinor ?? 0;
  return total < minimum ? minimum : total;
}

/**
 * MIN = c / tau, with the per-order minimum folded in since it is fixed cost
 * under another name. The proportional component is deliberately excluded: it
 * costs the same fraction at every size, so no floor can amortise it away.
 */
export function economicOrderFloor(schedule: FeeSchedule, policy: EconomicFloorPolicy): Minor {
  const fixedComponent = Math.max(schedule.fixedPerTrancheMinor, schedule.minimumPerOrderMinor ?? 0);
  if (fixedComponent <= 0) return 0;
  return ceilDiv(fixedComponent * BPS_PER_UNIT, policy.feeToleranceBps);
}

/**
 * Compare paying for the notionals separately against paying for their sum.
 * Subadditivity guarantees the split is never cheaper, so the verdict is only
 * ever neutral or worsening.
 */
export function evaluateSplit(schedule: FeeSchedule, notionalsMinor: Minor[]): SplitVerdict {
  const consolidatedNotional = notionalsMinor.reduce((sum, n) => sum + n, 0);
  const consolidatedTranches = trancheCount(schedule, consolidatedNotional);
  const consolidatedFeeMinor = feeForNotional(schedule, consolidatedNotional);

  const splitTranches = notionalsMinor.reduce((sum, n) => sum + trancheCount(schedule, n), 0);
  const splitFeeMinor = notionalsMinor.reduce((sum, n) => sum + feeForNotional(schedule, n), 0);

  const costs: SplitCosts = {
    splitTranches,
    consolidatedTranches,
    splitFeeMinor,
    consolidatedFeeMinor,
  };
  const excess = splitFeeMinor - consolidatedFeeMinor;

  if (notionalsMinor.length < 2) return { kind: "single-order", ...costs, excessCostMinor: 0 };
  if (excess <= 0) return { kind: "fee-neutral", ...costs, excessCostMinor: 0 };
  return { kind: "fee-worsening", ...costs, excessCostMinor: excess };
}

export interface AdmissibilityInput {
  orders: ProposedOrder[];
  schedule: FeeSchedule;
  policy: EconomicFloorPolicy;
}

/**
 * Typed admissibility verdicts over a proposed order set. Callers branch on
 * violation kinds; nothing here returns prose.
 */
export function checkOrderAdmissibility(input: AdmissibilityInput): AdmissibilityResult {
  const { orders, schedule, policy } = input;
  const economicFloorMinor = economicOrderFloor(schedule, policy);
  const violations: AdmissibilityViolation[] = [];

  const verdicts: OrderVerdict[] = orders.map((order) => {
    const clearsEconomicFloor = order.notionalMinor >= economicFloorMinor;
    if (!clearsEconomicFloor) {
      violations.push({
        kind: "below-economic-floor",
        symbol: order.symbol,
        notionalMinor: order.notionalMinor,
        floorMinor: economicFloorMinor,
        shortfallMinor: economicFloorMinor - order.notionalMinor,
      });
    }

    const venueMin = order.venueMinNotionalMinor;
    const clearsVenueMinimum = venueMin === undefined || order.notionalMinor >= venueMin;
    if (venueMin !== undefined && !clearsVenueMinimum) {
      violations.push({
        kind: "below-venue-minimum",
        symbol: order.symbol,
        notionalMinor: order.notionalMinor,
        venueMinNotionalMinor: venueMin,
        shortfallMinor: venueMin - order.notionalMinor,
      });
    }

    return {
      symbol: order.symbol,
      notionalMinor: order.notionalMinor,
      clearsEconomicFloor,
      clearsVenueMinimum,
    };
  });

  const split = evaluateSplit(
    schedule,
    orders.map((o) => o.notionalMinor),
  );
  if (split.kind === "fee-worsening") {
    violations.push({
      kind: "fee-worsening-split",
      symbols: orders.map((o) => o.symbol),
      splitTranches: split.splitTranches,
      consolidatedTranches: split.consolidatedTranches,
      splitFeeMinor: split.splitFeeMinor,
      consolidatedFeeMinor: split.consolidatedFeeMinor,
      excessCostMinor: split.excessCostMinor,
    });
  }

  return {
    admissible: violations.length === 0,
    economicFloorMinor,
    orders: verdicts,
    split,
    violations,
  };
}
