/**
 * Exposure Coach — top-down net-exposure ceiling from tape state.
 *
 * A capital-cap gate that sits ABOVE per-trade sizing. Where the Kelly
 * sizer answers "how big is THIS position", the coach answers "how much
 * of the book may be net long AT ALL right now". It converts three
 * top-down reads of the tape —
 *
 *   - market regime        (trend / range / volatility state)
 *   - breadth              (net advancers vs decliners, -1..1)
 *   - participation        (aggregate volume/activity vs baseline, 1=normal)
 *
 * into a deployable-capital ceiling ("you may be at most X% net long")
 * plus a discrete entries-allowed vs cash-priority verdict. The mapping
 * is fully deterministic: a regime base ceiling, adjusted linearly by
 * breadth, and by participation gated on the regime's risk direction
 * (confirmation in risk-on regimes, distribution in risk-off regimes).
 *
 * Distinct from:
 *   - `position-sizer.ts`      (per-trade Kelly / vol size; this caps the
 *                              aggregate net book)
 *   - `drawdown-tracker.ts`    (equity-drawdown throttle; this is a
 *                              tape-state throttle, orthogonal — a book
 *                              can be capped by either)
 *   - `daily-limits.ts`        (realized-loss circuit breaker)
 *   - `market-breadth-bias.ts` (classifies which STRATEGY the tape
 *                              rewards; this sets the capital CEILING)
 *
 * Pure, deterministic, no fitted parameters. Caller supplies the three
 * top-down reads; the coach returns the ceiling and posture.
 */

import type { MarketRegime } from "../regime/types.ts";

export type ExposurePosture =
  | "aggressive"
  | "constructive"
  | "neutral"
  | "defensive"
  | "cash_priority";

export interface ExposureCoachInput {
  /** Top-down market regime for the traded universe/index. */
  regime: MarketRegime;
  /**
   * Net breadth, -1..1. Positive = advancers/up-volume dominate,
   * negative = decliners dominate. Values outside [-1,1] are clamped.
   */
  breadth: number;
  /**
   * Aggregate participation (volume / tick activity) vs recent baseline,
   * as a ratio. 1 = normal, >1 elevated, <1 depressed. Default 1.
   */
  participation?: number;
}

export interface ExposureCoachOptions {
  /** Absolute cap on the net-long ceiling, percent. Default 100. */
  maxCeiling?: number;
  /**
   * Ceiling (percent) at/below which new entries are refused and the
   * book is put on cash-priority. Default 20.
   */
  entriesFloor?: number;
  /** Points of ceiling per unit of breadth (-1..1). Default 30. */
  breadthWeight?: number;
  /**
   * Points of ceiling per unit of participation deviation from 1.0,
   * signed by the regime's risk direction. Default 20.
   */
  participationWeight?: number;
  /**
   * Clamp on the absolute participation deviation used, so a 5x volume
   * spike does not dominate the mapping. Default 1.0 (i.e. participation
   * contributes at most ±participationWeight points).
   */
  maxParticipationDeviation?: number;
}

export interface ExposureCoachResult {
  regime: MarketRegime;
  /** Regime-only base ceiling before breadth/participation, percent. */
  baseCeiling: number;
  /** Ceiling contribution from breadth, percent (signed). */
  breadthAdjustment: number;
  /** Ceiling contribution from participation, percent (signed). */
  participationAdjustment: number;
  /** Final net-long exposure ceiling, percent, clamped to [0, maxCeiling]. */
  netExposureCeiling: number;
  /** Whether new long entries are permitted (false = cash-priority). */
  entriesAllowed: boolean;
  posture: ExposurePosture;
  summary: string;
}

const DEFAULT_MAX_CEILING = 100;
const DEFAULT_ENTRIES_FLOOR = 20;
const DEFAULT_BREADTH_WEIGHT = 30;
const DEFAULT_PARTICIPATION_WEIGHT = 20;
const DEFAULT_MAX_PARTICIPATION_DEVIATION = 1.0;

/**
 * Regime-only base net-long ceiling (percent). Trend-up gets the most
 * rope, trend-down the least; volatile/quiet sit in the middle-low band.
 */
const REGIME_BASE_CEILING: Record<MarketRegime, number> = {
  trending_up: 100,
  breakout: 80,
  ranging: 50,
  quiet: 40,
  volatile: 25,
  trending_down: 10,
};

/**
 * Risk direction used to sign the participation adjustment:
 *   +1 risk-on  — elevated participation CONFIRMS the move (raise ceiling)
 *   -1 risk-off — elevated participation is DISTRIBUTION (cut ceiling)
 *    0 neutral  — participation does not move the ceiling
 */
const REGIME_RISK_DIRECTION: Record<MarketRegime, number> = {
  trending_up: 1,
  breakout: 1,
  ranging: 0,
  quiet: 0,
  volatile: -1,
  trending_down: -1,
};

function clamp(x: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, x));
}

function postureFor(ceiling: number, entriesAllowed: boolean): ExposurePosture {
  if (!entriesAllowed) return "cash_priority";
  if (ceiling >= 80) return "aggressive";
  if (ceiling >= 55) return "constructive";
  if (ceiling >= 35) return "neutral";
  return "defensive";
}

/**
 * Compute the net-exposure ceiling and entries verdict from the current
 * top-down tape reads. Fully deterministic.
 */
export function computeExposureCeiling(
  input: ExposureCoachInput,
  options: ExposureCoachOptions = {},
): ExposureCoachResult {
  const maxCeiling = options.maxCeiling ?? DEFAULT_MAX_CEILING;
  const entriesFloor = options.entriesFloor ?? DEFAULT_ENTRIES_FLOOR;
  const breadthWeight = options.breadthWeight ?? DEFAULT_BREADTH_WEIGHT;
  const participationWeight =
    options.participationWeight ?? DEFAULT_PARTICIPATION_WEIGHT;
  const maxParticipationDeviation =
    options.maxParticipationDeviation ?? DEFAULT_MAX_PARTICIPATION_DEVIATION;

  const baseCeiling = REGIME_BASE_CEILING[input.regime];
  const riskDirection = REGIME_RISK_DIRECTION[input.regime];

  const breadth = clamp(input.breadth, -1, 1);
  const breadthAdjustment = breadth * breadthWeight;

  const participation = input.participation ?? 1;
  const deviation = clamp(
    participation - 1,
    -maxParticipationDeviation,
    maxParticipationDeviation,
  );
  const participationAdjustment = riskDirection * deviation * participationWeight;

  const netExposureCeiling = clamp(
    baseCeiling + breadthAdjustment + participationAdjustment,
    0,
    maxCeiling,
  );

  // Cash-priority when the ceiling is at/below the floor, OR when the
  // tape is an outright downtrend with negative breadth (a falling
  // market with participation confirming the fall).
  const forcedCash = input.regime === "trending_down" && breadth < 0;
  const entriesAllowed = netExposureCeiling > entriesFloor && !forcedCash;

  const posture = postureFor(netExposureCeiling, entriesAllowed);

  const summary =
    `${input.regime} regime -> base ${baseCeiling}%` +
    ` ${breadthAdjustment >= 0 ? "+" : ""}${breadthAdjustment.toFixed(1)} breadth` +
    ` ${participationAdjustment >= 0 ? "+" : ""}${participationAdjustment.toFixed(1)} participation` +
    ` = ${netExposureCeiling.toFixed(0)}% net-long ceiling. ` +
    (entriesAllowed
      ? `Entries allowed (${posture}).`
      : `Cash-priority${forcedCash ? " (downtrend + negative breadth)" : ""} — no new longs.`);

  return {
    regime: input.regime,
    baseCeiling,
    breadthAdjustment: parseFloat(breadthAdjustment.toFixed(2)),
    participationAdjustment: parseFloat(participationAdjustment.toFixed(2)),
    netExposureCeiling: parseFloat(netExposureCeiling.toFixed(2)),
    entriesAllowed,
    posture,
    summary,
  };
}

export function formatExposureCoach(result: ExposureCoachResult): string {
  return [
    `Exposure Coach — ${result.posture.toUpperCase()}`,
    "",
    `  Regime:              ${result.regime}`,
    `  Base ceiling:        ${result.baseCeiling}%`,
    `  Breadth adj:         ${result.breadthAdjustment >= 0 ? "+" : ""}${result.breadthAdjustment}%`,
    `  Participation adj:   ${result.participationAdjustment >= 0 ? "+" : ""}${result.participationAdjustment}%`,
    `  Net-long ceiling:    ${result.netExposureCeiling}%`,
    `  Entries:             ${result.entriesAllowed ? "ALLOWED" : "CASH-PRIORITY"}`,
    "",
    `Summary: ${result.summary}`,
  ].join("\n");
}
