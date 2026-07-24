/**
 * Absorbing-barrier distance classifier (GORDON_ABSORBING_BARRIER).
 *
 * Port of Ch 13 (Mathematics of Survival) from Ryan Wright. Wright names
 * three distinct absorbing barriers a trader must respect — once any one
 * is breached, the game stops for that operator regardless of long-run
 * ensemble averages.
 *
 *   - Broker barrier (maintenance margin / daily loss cap): hard, algorithmic.
 *   - Prop-firm barrier (trailing drawdown vs equity high-water mark): hard,
 *     but moves with you up the chart.
 *   - Psychological barrier (tilt point — the dollar amount where the
 *     prefrontal cortex shuts down and the amygdala takes over): soft, but
 *     once crossed, time-average growth turns negative.
 *
 * Gordon's existing `GORDON_RISK_DAILY_LOSS_USD` covers the broker case
 * implicitly. This module makes all three explicit and produces distances
 * in BOTH dollars and R-units, so the same shape can feed termination
 * Layer 1, plan-card display, and reminder injection.
 *
 * Returns separate `BarrierDistance` entries per kind plus a `nearest`
 * summary. Callers can decide whether to gate, warn, or annotate.
 */

export const ABSORBING_BARRIER_FLAG_ENV = "GORDON_ABSORBING_BARRIER";

export function isAbsorbingBarrierEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  // Default-on protective gate: absence = enabled. Explicit "0"/"false" opts out.
  // Dormant unless the operator supplies barrier inputs (equity/limits), so it
  // never fires spuriously with no configuration.
  const raw = env[ABSORBING_BARRIER_FLAG_ENV];
  return raw !== "0" && raw !== "false";
}

export type BarrierKind = "broker" | "prop_firm" | "psychological";

export type AlertLevel = "ok" | "watch" | "warn" | "critical" | "breached";

export interface BarrierInput {
  currentEquity: number;
  /**
   * Highest equity reached this year (or this evaluation window).
   * Required for the prop-firm trailing barrier.
   */
  equityHighWaterMark?: number;
  /**
   * Floor equity below which the broker liquidates. Provide one of these
   * two for the broker barrier; if both are provided the higher (closer
   * to current) wins.
   */
  maintenanceMarginEquity?: number;
  /** Alternative broker expression: dollars of intraday loss allowed today. */
  dailyLossBudgetUsd?: number;
  /** Trailing drawdown allowance vs high-water mark (prop-firm style). */
  propFirmTrailingDdUsd?: number;
  /**
   * Operator-set tilt threshold — the loss dollar amount where decision
   * quality collapses. Personal, no universal formula.
   */
  psychologicalTiltUsd?: number;
  /**
   * Base R unit (typical per-trade dollar risk) used to translate
   * dollar distance into R-units. Defaults to 1 if unknown.
   */
  baseRiskPerTradeUsd?: number;
}

export interface BarrierDistance {
  kind: BarrierKind;
  /** False when no input was supplied for this barrier kind. */
  active: boolean;
  /** Equity floor that triggers the barrier (dollars). */
  triggerEquity: number | null;
  /** Dollars between current equity and trigger. Negative = breached. */
  dollarsToBarrier: number;
  /** Same distance expressed as R-multiples. */
  rUnitsToBarrier: number;
  alertLevel: AlertLevel;
}

export interface BarriersResult {
  barriers: BarrierDistance[];
  nearest: BarrierKind | null;
  /** R-units to the nearest active barrier. Infinity if none active. */
  nearestRUnits: number;
}

function classifyAlert(rUnits: number): AlertLevel {
  if (rUnits < 0) return "breached";
  if (rUnits < 2) return "critical";
  if (rUnits < 5) return "warn";
  if (rUnits < 10) return "watch";
  return "ok";
}

function makeDistance(
  kind: BarrierKind,
  triggerEquity: number | null,
  currentEquity: number,
  baseR: number,
): BarrierDistance {
  if (triggerEquity === null) {
    return {
      kind,
      active: false,
      triggerEquity: null,
      dollarsToBarrier: Number.POSITIVE_INFINITY,
      rUnitsToBarrier: Number.POSITIVE_INFINITY,
      alertLevel: "ok",
    };
  }
  const dollars = currentEquity - triggerEquity;
  const rUnits = dollars / baseR;
  return {
    kind,
    active: true,
    triggerEquity,
    dollarsToBarrier: dollars,
    rUnitsToBarrier: rUnits,
    alertLevel: classifyAlert(rUnits),
  };
}

export function distanceToBarriers(input: BarrierInput): BarriersResult {
  const baseR = input.baseRiskPerTradeUsd ?? 1;

  let brokerTrigger: number | null = null;
  if (input.maintenanceMarginEquity !== undefined) {
    brokerTrigger = input.maintenanceMarginEquity;
  }
  if (input.dailyLossBudgetUsd !== undefined) {
    const dailyTrigger = input.currentEquity - input.dailyLossBudgetUsd;
    brokerTrigger = brokerTrigger === null ? dailyTrigger : Math.max(brokerTrigger, dailyTrigger);
  }

  let propFirmTrigger: number | null = null;
  if (
    input.propFirmTrailingDdUsd !== undefined &&
    input.equityHighWaterMark !== undefined
  ) {
    propFirmTrigger = input.equityHighWaterMark - input.propFirmTrailingDdUsd;
  }

  const psychTrigger =
    input.psychologicalTiltUsd !== undefined
      ? input.currentEquity - input.psychologicalTiltUsd
      : null;

  const barriers: BarrierDistance[] = [
    makeDistance("broker", brokerTrigger, input.currentEquity, baseR),
    makeDistance("prop_firm", propFirmTrigger, input.currentEquity, baseR),
    makeDistance("psychological", psychTrigger, input.currentEquity, baseR),
  ];

  const active = barriers.filter((b) => b.active);
  if (active.length === 0) {
    return { barriers, nearest: null, nearestRUnits: Number.POSITIVE_INFINITY };
  }
  const nearest = active.reduce((min, b) =>
    b.rUnitsToBarrier < min.rUnitsToBarrier ? b : min,
  );
  return { barriers, nearest: nearest.kind, nearestRUnits: nearest.rUnitsToBarrier };
}

/**
 * True when any active barrier is at the warn level or worse. Useful as
 * a hard gate before order placement.
 */
export function shouldBlockNewTrades(result: BarriersResult): boolean {
  return result.barriers.some(
    (b) => b.active && (b.alertLevel === "warn" || b.alertLevel === "critical" || b.alertLevel === "breached"),
  );
}

export function barriersToPayload(result: BarriersResult): Record<string, unknown> {
  return {
    kind: "absorbing_barrier.evaluated",
    nearest: result.nearest,
    nearestRUnits: Number.isFinite(result.nearestRUnits)
      ? Number(result.nearestRUnits.toFixed(2))
      : null,
    barriers: result.barriers
      .filter((b) => b.active)
      .map((b) => ({
        kind: b.kind,
        rUnits: Number(b.rUnitsToBarrier.toFixed(2)),
        alertLevel: b.alertLevel,
      })),
  };
}
