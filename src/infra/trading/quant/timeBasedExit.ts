/**
 * Time-Based Early-Exit Decision — TM2.
 *
 * If a trade has been open significantly longer than the strategy's
 * average winning trade duration, it is behaving abnormally — not
 * like a winner. The longer it overshoots the average, the stronger
 * the signal to cut early and accept whatever current P&L is rather
 * than wait for stoploss or target.
 *
 * Calibration: the avgWinningDuration parameter should come from
 * observed durations of historical winning trades (Gordon's backtest
 * engine tracks per-trade entry/exit timestamps). thresholdMultiplier
 * is operator-discretion; typical values are 5–10× average winning
 * duration.
 *
 * Pedigree: prop-trading discipline; specifically articulated by Spicy
 * (2025) in his mean-reversion strategy article.
 *
 * Pure compute. No I/O.
 */

export const TIME_BASED_EXIT_FLAG_ENV = "GORDON_TIME_BASED_EXIT";

export function isTimeBasedExitEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[TIME_BASED_EXIT_FLAG_ENV] === "1" || env[TIME_BASED_EXIT_FLAG_ENV] === "true";
}

export interface TimeBasedExitInput {
  /** Time-in-trade so far. Any consistent unit (seconds, minutes, ms). */
  timeInTrade: number;
  /** Average winning-trade duration (same unit). Must be > 0. */
  avgWinningDuration: number;
  /**
   * Threshold multiplier: cut when timeInTrade ≥ avgWinningDuration ×
   * thresholdMultiplier. Default 5 (cut at 5× average winning duration).
   */
  thresholdMultiplier?: number;
}

export interface TimeBasedExitResult {
  /** timeInTrade / avgWinningDuration. */
  durationRatio: number;
  /** Effective threshold multiplier used. */
  thresholdMultiplier: number;
  /** True if durationRatio ≥ thresholdMultiplier. */
  thresholdCrossed: boolean;
  /** Trade verdict. */
  verdict: "hold" | "cut";
  reasoning: string;
}

const DEFAULT_THRESHOLD = 5;

export function computeTimeBasedExit(input: TimeBasedExitInput): TimeBasedExitResult {
  if (input.timeInTrade < 0) {
    throw new Error("timeInTrade must be ≥ 0");
  }
  if (input.avgWinningDuration <= 0) {
    throw new Error("avgWinningDuration must be > 0");
  }
  const thresholdMultiplier = input.thresholdMultiplier ?? DEFAULT_THRESHOLD;
  if (thresholdMultiplier <= 1) {
    throw new Error("thresholdMultiplier must be > 1 (no point cutting at or below average duration)");
  }

  const durationRatio = input.timeInTrade / input.avgWinningDuration;
  const thresholdCrossed = durationRatio >= thresholdMultiplier;
  const verdict: "hold" | "cut" = thresholdCrossed ? "cut" : "hold";

  const reasoning =
    `time-in-trade=${input.timeInTrade.toFixed(2)} vs avg-winning-duration=${input.avgWinningDuration.toFixed(2)} ` +
    `→ ratio=${durationRatio.toFixed(2)}× (threshold=${thresholdMultiplier}×) → ${verdict}` +
    `${thresholdCrossed ? " (abnormally long for a winning trade)" : ""}.`;

  return { durationRatio, thresholdMultiplier, thresholdCrossed, verdict, reasoning };
}

export function timeBasedExitToPayload(result: TimeBasedExitResult): Record<string, unknown> {
  return {
    kind: "time_based_exit.computed",
    durationRatio: Number(result.durationRatio.toFixed(4)),
    thresholdMultiplier: result.thresholdMultiplier,
    thresholdCrossed: result.thresholdCrossed,
    verdict: result.verdict,
  };
}
