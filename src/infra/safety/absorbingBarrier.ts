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

import { flagEnv } from "../config/flagResolver.ts";

export const ABSORBING_BARRIER_FLAG_ENV = "GORDON_ABSORBING_BARRIER";

export function isAbsorbingBarrierEnabled(
  env: NodeJS.ProcessEnv = flagEnv(),
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

/* -------------------------------------------------------------------------
 * Inception loss barrier (OOM-RL / STDAW, twenty months of live capital).
 *
 * The prop-firm barrier above trails the equity high-water mark, and a
 * trailing reference forgives. An account can lose 18%, grind back to a new
 * high, lose 18% again, and never once sit 20% below its peak, having by then
 * destroyed more than a third of the principal the operator actually
 * committed. "How much have I given back from my best" and "how much of what
 * I was given is gone" are different facts about the same account, and the
 * operator is entitled to both, so this barrier is reported alongside the
 * trailing one rather than replacing it.
 *
 * The paper states its terminal condition point-in-time: L_t = 1 - W_t / W_0,
 * terminate at L_t >= tau, tau = 0.20. Point-in-time inception loss is
 * pointwise dominated by trailing give-back the moment the account prints a
 * high above inception (HWM >= W_0 implies 1 - W_t/HWM >= 1 - W_t/W_0), so on
 * its own it can never bind before the trailing barrier and carries no
 * information the trailing barrier lacks. What survives the recover-and-lose
 * cycle is CUMULATIVE destroyed capital: every completed peak-to-trough
 * decline plus the open one, measured against reference capital. That
 * quantity dominates the paper's L_t (it contains the current decline from a
 * peak that is at least the reference), so tripping on it also honours the
 * published condition. Both numbers are reported.
 *
 * Costing note from the same corpus, because it belongs next to any survival
 * metric: a strategy with excellent simulated returns at 6700% annualised
 * turnover was erased entirely by 8 basis points of real per-side friction.
 * Turnover has to be costed before a plan is approved, not measured after.
 *
 * No clock and no I/O. Sequencing comes from the order in which the caller
 * folds equity observations through the state, so replays are deterministic.
 * ---------------------------------------------------------------------- */

export type TerminalBarrierKind = "trailing_high_water" | "inception";

export interface AbsorbingBarrierConfig {
  /**
   * tau: fraction of reference capital whose cumulative destruction halts the
   * operator. Undefined leaves the barrier inactive.
   */
  inceptionLossFraction?: number;
  /** Fraction of the high-water mark whose give-back halts the operator. */
  trailingDrawdownFraction?: number;
}

export interface AbsorbingBarrierState {
  /** Inception equity plus net external flows. See recordExternalFlow. */
  referenceCapitalUsd: number;
  highWaterMarkUsd: number;
  /** Sum of peak-to-trough declines from episodes a new high has closed. */
  closedEpisodeLossUsd: number;
  /** Lowest equity seen since the current high-water mark was set. */
  troughSinceHighWaterUsd: number;
  lastEquityUsd: number;
  tripped: boolean;
  trippedBy: TerminalBarrierKind | null;
  trippedAtEquityUsd: number | null;
  trippedAtLossFraction: number | null;
}

export interface TerminalBarrierReading {
  kind: TerminalBarrierKind;
  /** False when the config supplies no limit for this barrier. */
  active: boolean;
  lossFraction: number;
  limitFraction: number | null;
  /** limitFraction - lossFraction. Zero or negative means breached. */
  headroomFraction: number;
  /** Equity at which this barrier would trip. */
  triggerEquityUsd: number | null;
}

export interface AbsorbingBarrierEvaluation {
  state: AbsorbingBarrierState;
  tripped: boolean;
  /** Which limit stopped the operator. An operator seeing a halt needs this. */
  boundBy: TerminalBarrierKind | null;
  inception: TerminalBarrierReading;
  trailing: TerminalBarrierReading;
  /** The paper's L_t = 1 - W_t / W_ref, reported for comparability. */
  inceptionPointInTimeLossFraction: number;
}

export function createAbsorbingBarrierState(
  inceptionEquityUsd: number,
): AbsorbingBarrierState {
  return {
    referenceCapitalUsd: inceptionEquityUsd,
    highWaterMarkUsd: inceptionEquityUsd,
    closedEpisodeLossUsd: 0,
    troughSinceHighWaterUsd: inceptionEquityUsd,
    lastEquityUsd: inceptionEquityUsd,
    tripped: false,
    trippedBy: null,
    trippedAtEquityUsd: null,
    trippedAtLossFraction: null,
  };
}

/**
 * Deposits positive, withdrawals negative.
 *
 * Reference capital tracks NET CONTRIBUTED capital rather than freezing at
 * inception, because a frozen reference misreads cash movement as trading
 * result in both directions: withdraw a third of a flat account and a frozen
 * barrier reports a 33% loss nobody incurred, double the account with a
 * deposit and losing the whole original principal no longer reaches tau. The
 * high-water mark and the trough shift by the same flow so neither barrier
 * sees a step change, while closedEpisodeLossUsd is untouched: capital
 * already destroyed stays destroyed no matter what is paid in afterwards.
 */
export function recordExternalFlow(
  state: AbsorbingBarrierState,
  flowUsd: number,
): AbsorbingBarrierState {
  return {
    ...state,
    referenceCapitalUsd: state.referenceCapitalUsd + flowUsd,
    highWaterMarkUsd: state.highWaterMarkUsd + flowUsd,
    troughSinceHighWaterUsd: state.troughSinceHighWaterUsd + flowUsd,
    lastEquityUsd: state.lastEquityUsd + flowUsd,
  };
}

function makeReading(
  kind: TerminalBarrierKind,
  lossFraction: number,
  limitFraction: number | undefined,
  triggerEquityUsd: number | null,
): TerminalBarrierReading {
  if (limitFraction === undefined) {
    return {
      kind,
      active: false,
      lossFraction,
      limitFraction: null,
      headroomFraction: Number.POSITIVE_INFINITY,
      triggerEquityUsd: null,
    };
  }
  return {
    kind,
    active: true,
    lossFraction,
    limitFraction,
    headroomFraction: limitFraction - lossFraction,
    triggerEquityUsd,
  };
}

/**
 * Folds one equity observation into the state and reports both barriers.
 *
 * An empty config leaves both barriers inactive and can never trip. That
 * default is a deliberate safety choice, not an oversight: callers that
 * predate this barrier must not begin halting because a module gained a
 * feature. Halting is opt-in per operator mandate.
 */
export function evaluateAbsorbingBarrier(
  state: AbsorbingBarrierState,
  currentEquityUsd: number,
  config: AbsorbingBarrierConfig = {},
): AbsorbingBarrierEvaluation {
  const next: AbsorbingBarrierState = { ...state, lastEquityUsd: currentEquityUsd };

  if (currentEquityUsd > next.highWaterMarkUsd) {
    next.closedEpisodeLossUsd +=
      next.highWaterMarkUsd - next.troughSinceHighWaterUsd;
    next.highWaterMarkUsd = currentEquityUsd;
    next.troughSinceHighWaterUsd = currentEquityUsd;
  } else if (currentEquityUsd < next.troughSinceHighWaterUsd) {
    next.troughSinceHighWaterUsd = currentEquityUsd;
  }

  const openDeclineUsd = next.highWaterMarkUsd - currentEquityUsd;
  const cumulativeLossUsd = next.closedEpisodeLossUsd + openDeclineUsd;

  const inceptionLoss = cumulativeLossUsd / next.referenceCapitalUsd;
  const trailingLoss = openDeclineUsd / next.highWaterMarkUsd;
  const pointInTimeLoss =
    (next.referenceCapitalUsd - currentEquityUsd) / next.referenceCapitalUsd;

  const inceptionTrigger =
    config.inceptionLossFraction === undefined
      ? null
      : next.highWaterMarkUsd -
        (config.inceptionLossFraction * next.referenceCapitalUsd -
          next.closedEpisodeLossUsd);
  const trailingTrigger =
    config.trailingDrawdownFraction === undefined
      ? null
      : next.highWaterMarkUsd * (1 - config.trailingDrawdownFraction);

  const inception = makeReading(
    "inception",
    inceptionLoss,
    config.inceptionLossFraction,
    inceptionTrigger,
  );
  const trailing = makeReading(
    "trailing_high_water",
    trailingLoss,
    config.trailingDrawdownFraction,
    trailingTrigger,
  );

  if (!next.tripped) {
    const breached = [trailing, inception].filter(
      (r) => r.active && r.headroomFraction <= 0,
    );
    if (breached.length > 0) {
      // The deepest breach governs: on this equity path it is the limit that
      // would have stopped the operator earliest.
      const binding = breached.reduce((worst, r) =>
        r.headroomFraction < worst.headroomFraction ? r : worst,
      );
      next.tripped = true;
      next.trippedBy = binding.kind;
      next.trippedAtEquityUsd = currentEquityUsd;
      next.trippedAtLossFraction = binding.lossFraction;
    }
  }

  return {
    state: next,
    tripped: next.tripped,
    boundBy: next.trippedBy,
    inception,
    trailing,
    inceptionPointInTimeLossFraction: pointInTimeLoss,
  };
}

export function absorbingBarrierToPayload(
  evaluation: AbsorbingBarrierEvaluation,
): Record<string, unknown> {
  const readings = [evaluation.trailing, evaluation.inception]
    .filter((r) => r.active)
    .map((r) => ({
      kind: r.kind,
      lossFraction: Number(r.lossFraction.toFixed(4)),
      limitFraction: r.limitFraction,
      headroomFraction: Number(r.headroomFraction.toFixed(4)),
    }));
  return {
    kind: "absorbing_barrier.terminal_evaluated",
    tripped: evaluation.tripped,
    boundBy: evaluation.boundBy,
    trippedAtEquityUsd: evaluation.state.trippedAtEquityUsd,
    referenceCapitalUsd: evaluation.state.referenceCapitalUsd,
    pointInTimeLossFraction: Number(
      evaluation.inceptionPointInTimeLossFraction.toFixed(4),
    ),
    barriers: readings,
  };
}
