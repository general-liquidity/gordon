/**
 * Breakout-Failure-Rate Regime Detector.
 *
 * Premise (Zanger via Kyna Kosling, May 2026): "You can be in a bear-like
 * market when stocks break out and fail en masse... This type of market
 * behavior can often be the precursor to a much bigger downturn for the
 * leading averages." Detects bear-like regime BEFORE indexes confirm with
 * a -20% drawdown.
 *
 * Operates on a rolling window of breakout events with outcomes. Each
 * outcome is binary: followed_through (held for ≥N bars and printed
 * higher highs) vs failed (round-tripped back into the base or worse).
 * The rolling failure rate maps to a regime classification.
 *
 * Verdicts:
 *   - healthy_bull        : failure rate ≤ 0.30
 *   - weakening           : failure rate 0.30 – 0.50
 *   - bear_like           : failure rate 0.50 – 0.70 (Zanger's warning band)
 *   - bear_confirmed      : failure rate > 0.70
 *   - insufficient_data   : window underfilled
 *
 * Distinct from:
 *   - `infra/trading/quant/markovRegime.ts`        (HMM state inference)
 *   - `infra/trading/quant/volRegimeConvergence.ts` (vol-regime methodology)
 *   - `infra/trading/quant/marketBreadthBias.ts` (TM3 — universe return-sign
 *                                                tally; this primitive uses
 *                                                breakout-followthrough
 *                                                instead, a different axis)
 *   - `regime-detection-lag.ts`                    (meta-primitive measuring
 *                                                  detector lag)
 *
 * Composes with:
 *   - `marketBreadthBias` (TM3) — stack both regime axes for cross-confirmation
 *   - `institutional-footprint` (LV27) — supplies breakout-with-context events
 *     to feed this primitive's window
 *
 * Pure function. Caller maintains the rolling breakout-event log.
 */

export type BreakoutOutcome = "followed_through" | "failed" | "pending";

export interface BreakoutEvent {
  /** Symbol the breakout occurred on. */
  symbol: string;
  /** Bar / time index when the breakout happened. */
  breakoutAt: number;
  /** Bar / time index when the outcome was evaluated. */
  evaluatedAt?: number;
  outcome: BreakoutOutcome;
}

export interface BreakoutFailureRegimeOptions {
  /**
   * Minimum number of evaluated events (non-pending) required for a
   * verdict. Default 10.
   */
  minEvaluatedEvents?: number;
  /**
   * Window size (most recent N events) used in the rolling computation.
   * Default 30.
   */
  windowSize?: number;
  /** Failure-rate band edges. Override defaults if needed. */
  healthyBullCeiling?: number;
  weakeningCeiling?: number;
  bearLikeCeiling?: number;
}

export type BreakoutFailureRegimeVerdict =
  | "healthy_bull"
  | "weakening"
  | "bear_like"
  | "bear_confirmed"
  | "insufficient_data";

export interface BreakoutFailureRegimeResult {
  totalEvents: number;
  evaluatedEvents: number;
  pendingEvents: number;
  windowUsed: number;
  failed: number;
  followedThrough: number;
  failureRate: number;
  followThroughRate: number;
  verdict: BreakoutFailureRegimeVerdict;
  /** 0..1 score (higher = closer to bear_confirmed). */
  bearishScore: number;
  summary: string;
}

const DEFAULT_MIN_EVAL = 10;
const DEFAULT_WINDOW = 30;
const DEFAULT_HEALTHY_CEIL = 0.30;
const DEFAULT_WEAKENING_CEIL = 0.50;
const DEFAULT_BEARLIKE_CEIL = 0.70;

export function analyzeBreakoutFailureRegime(
  events: ReadonlyArray<BreakoutEvent>,
  options: BreakoutFailureRegimeOptions = {},
): BreakoutFailureRegimeResult {
  const minEval = options.minEvaluatedEvents ?? DEFAULT_MIN_EVAL;
  const windowSize = options.windowSize ?? DEFAULT_WINDOW;
  const healthyCeil = options.healthyBullCeiling ?? DEFAULT_HEALTHY_CEIL;
  const weakeningCeil = options.weakeningCeiling ?? DEFAULT_WEAKENING_CEIL;
  const bearLikeCeil = options.bearLikeCeiling ?? DEFAULT_BEARLIKE_CEIL;

  if (
    !(healthyCeil < weakeningCeil && weakeningCeil < bearLikeCeil && bearLikeCeil <= 1)
  ) {
    return {
      totalEvents: events.length,
      evaluatedEvents: 0,
      pendingEvents: 0,
      windowUsed: 0,
      failed: 0,
      followedThrough: 0,
      failureRate: 0,
      followThroughRate: 0,
      verdict: "insufficient_data",
      bearishScore: 0,
      summary: "Invalid threshold band ordering.",
    };
  }

  // Take the most recent windowSize events (by breakoutAt order assumed)
  const sorted = [...events].sort((a, b) => a.breakoutAt - b.breakoutAt);
  const windowed = sorted.slice(-windowSize);
  const evaluated = windowed.filter((e) => e.outcome !== "pending");
  const pending = windowed.length - evaluated.length;
  const failed = evaluated.filter((e) => e.outcome === "failed").length;
  const followed = evaluated.filter((e) => e.outcome === "followed_through").length;

  if (evaluated.length < minEval) {
    return {
      totalEvents: events.length,
      evaluatedEvents: evaluated.length,
      pendingEvents: pending,
      windowUsed: windowed.length,
      failed,
      followedThrough: followed,
      failureRate: 0,
      followThroughRate: 0,
      verdict: "insufficient_data",
      bearishScore: 0,
      summary: `Only ${evaluated.length} evaluated events (need ${minEval}).`,
    };
  }

  const failureRate = failed / evaluated.length;
  const followThroughRate = followed / evaluated.length;

  let verdict: BreakoutFailureRegimeVerdict;
  if (failureRate <= healthyCeil) verdict = "healthy_bull";
  else if (failureRate <= weakeningCeil) verdict = "weakening";
  else if (failureRate <= bearLikeCeil) verdict = "bear_like";
  else verdict = "bear_confirmed";

  const bearishScore = parseFloat(Math.min(1, failureRate).toFixed(4));

  const summary =
    `${verdict.toUpperCase()} — ${failed}/${evaluated.length} failed (${(failureRate * 100).toFixed(1)}%), ` +
    `${followed} followed through (${(followThroughRate * 100).toFixed(1)}%). ` +
    `Window ${windowed.length} events (${pending} pending). ` +
    `${verdict === "bear_like" ? "Zanger warning band — fierce rallies may trick re-entry; size down or sit out." : ""}`;

  return {
    totalEvents: events.length,
    evaluatedEvents: evaluated.length,
    pendingEvents: pending,
    windowUsed: windowed.length,
    failed,
    followedThrough: followed,
    failureRate: parseFloat(failureRate.toFixed(6)),
    followThroughRate: parseFloat(followThroughRate.toFixed(6)),
    verdict,
    bearishScore,
    summary: summary.trim(),
  };
}

export function formatBreakoutFailureRegime(
  result: BreakoutFailureRegimeResult,
): string {
  const lines = [
    `Breakout-Failure Regime — ${result.verdict.toUpperCase()} (bearish ${result.bearishScore.toFixed(2)})`,
    "",
    `  Total events:        ${result.totalEvents}`,
    `  Window used:         ${result.windowUsed}`,
    `  Evaluated:           ${result.evaluatedEvents}`,
    `  Pending:             ${result.pendingEvents}`,
    `  Failed:              ${result.failed}`,
    `  Followed through:    ${result.followedThrough}`,
    `  Failure rate:        ${(result.failureRate * 100).toFixed(1)}%`,
    `  Follow-through rate: ${(result.followThroughRate * 100).toFixed(1)}%`,
    "",
    `Summary: ${result.summary}`,
  ];
  return lines.join("\n");
}
