/**
 * Walk-forward Information Coefficient harness.
 *
 * The post's "11-step combination engine" implicitly demands rolling
 * out-of-sample IC estimation (steps 5 and 7 drop the most-recent
 * observations to prevent in-sample fitting). The base `trackIc`
 * computes one IC across the supplied series — fine for a current
 * snapshot but it can't answer "is this signal robust under
 * walk-forward?"
 *
 * This module rolls a window through (signal, return) history and
 * computes IC at each step, producing a time series of IC values
 * that surface:
 *
 *   - Mean / median / min / max IC across windows
 *   - Fraction of windows where IC > 0
 *   - Longest streaks of negative / positive IC (regime-of-failure
 *     detection)
 *   - Time-trend slope (does the signal degrade over time?)
 *   - Robustness verdict that's distinct from the snapshot verdict
 *
 * The verdict cascades most-severe-first:
 *
 *   insufficient_data — fewer than 5 valid windows
 *   unstable          — IC std > 0.2 OR longest negative streak > 5
 *   degrading         — trend slope < -0.001
 *   fragile           — positiveFraction in [0.4, 0.7] OR std in (0.1, 0.2]
 *   robust            — positiveFraction > 0.7 AND std ≤ 0.1 AND |mean IC| > 0.05
 *
 * Cost-adjustment is delegated to `trackIc`'s `transactionCostBps`
 * option — when set, the per-window snapshots include the edge
 * breakdown, and the aggregate result reports the fraction of
 * windows where net edge > 0.
 */

import { trackIc, type IcSnapshot, type IcOptions } from "./ic-tracker.ts";
import {
  mean as arrayMean,
  sampleStd,
  trendSlope as computeTrendSlope,
} from "./helpers.ts";

export type WalkForwardVerdict =
  | "robust"
  | "fragile"
  | "degrading"
  | "unstable"
  | "insufficient_data";

export interface WalkForwardWindow {
  windowIndex: number;
  startIdx: number;
  endIdx: number;
  /** IC for this window, null if the snapshot couldn't be computed. */
  ic: number | null;
  /** Sub-window verdict for the window's IcSnapshot. */
  verdict: IcSnapshot["verdict"];
}

export interface WalkForwardIcOptions {
  /** Number of observations per window. Default 60. */
  windowSize?: number;
  /** Step size between window starts. Default = windowSize / 4 (75% overlap). */
  stepSize?: number;
  /**
   * Purge bars (López de Prado): label horizon / forward-return lookahead.
   * Drops the last `purgeBars` observations from EACH window before computing
   * its IC — those observations' forward-return labels extend past the window
   * edge and overlap subsequent (overlapping) windows. Default 0 (no purge).
   */
  purgeBars?: number;
  /**
   * Embargo bars (López de Prado): additional gap added between consecutive
   * window starts (on top of `stepSize`) to skip serially-correlated bars
   * shared by overlapping windows. Default 0 (no embargo).
   */
  embargoBars?: number;
  /** IC-tracker options to pass to each window (excluding minSampleSize, which is enforced per-window). Set `icOptions.method = "spearman"` for rank-IC. */
  icOptions?: Omit<IcOptions, "minSampleSize">;
  /** Minimum samples required per window. Default 30. */
  minSampleSize?: number;
  /** Std threshold above which IC variance flags instability. Default 0.2. */
  instabilityStdThreshold?: number;
  /** Std threshold above which IC variance flags fragility. Default 0.1. */
  fragilityStdThreshold?: number;
  /** Longest-negative-streak threshold flagging instability. Default 5. */
  maxNegativeStreak?: number;
  /** Trend slope below which the signal is labeled degrading. Default -0.001. */
  degradationSlopeThreshold?: number;
  /** positiveFraction at or above which the signal is labeled robust. Default 0.7. */
  robustPositiveFraction?: number;
  /** positiveFraction at or above which (and below robust) the signal is labeled fragile. Default 0.4. */
  fragilePositiveFraction?: number;
  /** |mean IC| floor for a robust verdict. Default 0.05. */
  robustMeanIcThreshold?: number;
}

export interface WalkForwardIcResult {
  signalName: string;
  windowSize: number;
  stepSize: number;
  /** Per-window snapshots (lightweight — IC + start/end indices + verdict only). */
  windows: WalkForwardWindow[];
  /** Number of windows with a non-null IC. */
  validWindowCount: number;
  meanIc: number;
  medianIc: number;
  stdIc: number;
  minIc: number;
  maxIc: number;
  /** Fraction of valid windows where IC > 0 (∈ [0, 1]). */
  positiveFraction: number;
  /** Longest run of consecutive windows where IC ≤ 0. */
  longestNegativeStreak: number;
  /** Longest run of consecutive windows where IC > 0. */
  longestPositiveStreak: number;
  /** Time-trend slope across valid window IC series. Negative = degrading. */
  trendSlope: number;
  /**
   * Optional cost-aware companion: fraction of valid windows where the
   * implied net edge (after `transactionCostBps`) is positive. Present
   * only when `icOptions.transactionCostBps > 0`.
   */
  costSurvivingFraction?: number;
  verdict: WalkForwardVerdict;
  summary: string;
}

const DEFAULT_OPTIONS: Required<Omit<WalkForwardIcOptions, "icOptions">> = {
  windowSize: 60,
  stepSize: 15, // 1/4 of windowSize
  purgeBars: 0,
  embargoBars: 0,
  minSampleSize: 30,
  instabilityStdThreshold: 0.2,
  fragilityStdThreshold: 0.1,
  maxNegativeStreak: 5,
  degradationSlopeThreshold: -0.001,
  robustPositiveFraction: 0.7,
  fragilePositiveFraction: 0.4,
  robustMeanIcThreshold: 0.05,
};

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[mid - 1]! + sorted[mid]!) / 2
    : sorted[mid]!;
}

function longestStreak(values: number[], predicate: (v: number) => boolean): number {
  let longest = 0;
  let current = 0;
  for (const v of values) {
    if (predicate(v)) {
      current += 1;
      if (current > longest) longest = current;
    } else {
      current = 0;
    }
  }
  return longest;
}

/**
 * Walk a window through the signal/return history and compute IC at
 * each step.
 *
 * The caller is responsible for any alignment that prevents
 * look-ahead — `forwardReturns[i]` should be the return realized
 * AFTER observing `signalValues[i]`. The harness then walks the
 * already-aligned series in time order.
 */
export function walkForwardIc(
  signalName: string,
  signalValues: number[],
  forwardReturns: number[],
  options: WalkForwardIcOptions = {},
): WalkForwardIcResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const icOpts = options.icOptions ?? {};
  const n = Math.min(signalValues.length, forwardReturns.length);

  const baseResult: Omit<WalkForwardIcResult, "verdict" | "summary"> = {
    signalName,
    windowSize: opts.windowSize,
    stepSize: opts.stepSize,
    windows: [],
    validWindowCount: 0,
    meanIc: 0,
    medianIc: 0,
    stdIc: 0,
    minIc: 0,
    maxIc: 0,
    positiveFraction: 0,
    longestNegativeStreak: 0,
    longestPositiveStreak: 0,
    trendSlope: 0,
  };

  if (n < opts.windowSize) {
    return {
      ...baseResult,
      verdict: "insufficient_data",
      summary: `${signalName}: ${n} observations < window size ${opts.windowSize}`,
    };
  }

  const windows: WalkForwardWindow[] = [];
  const validIcs: number[] = [];
  const validNetEdgesBps: number[] = [];

  const purgeBars = Math.max(0, Math.floor(opts.purgeBars));
  const embargoBars = Math.max(0, Math.floor(opts.embargoBars));
  const stride = opts.stepSize + embargoBars;

  let windowIndex = 0;
  for (let start = 0; start + opts.windowSize <= n; start += stride) {
    const end = start + opts.windowSize;
    // Purge: drop the last `purgeBars` observations of the window — their
    // forward-return labels extend past the window edge.
    const purgedEnd = end - purgeBars;
    const winSignal = signalValues.slice(start, purgedEnd);
    const winReturn = forwardReturns.slice(start, purgedEnd);
    const snap = trackIc(`${signalName}@${start}-${purgedEnd}`, winSignal, winReturn, {
      ...icOpts,
      minSampleSize: opts.minSampleSize,
    });
    const ic = snap.ic;
    windows.push({
      windowIndex,
      startIdx: start,
      endIdx: purgedEnd - 1,
      ic,
      verdict: snap.verdict,
    });
    if (ic !== null) validIcs.push(ic);
    if (snap.edge) {
      validNetEdgesBps.push(snap.edge.impliedNetEdgeBps);
    }
    windowIndex += 1;
  }

  if (validIcs.length < 5) {
    return {
      ...baseResult,
      windows,
      validWindowCount: validIcs.length,
      verdict: "insufficient_data",
      summary:
        `${signalName}: ${validIcs.length} valid windows < 5 needed for walk-forward analysis`,
    };
  }

  const meanIc = arrayMean(validIcs);
  const medianIc = median(validIcs);
  const stdIc = sampleStd(validIcs);
  const minIc = Math.min(...validIcs);
  const maxIc = Math.max(...validIcs);
  const positiveCount = validIcs.filter((v) => v > 0).length;
  const positiveFraction = positiveCount / validIcs.length;
  const longestNeg = longestStreak(validIcs, (v) => v <= 0);
  const longestPos = longestStreak(validIcs, (v) => v > 0);
  const slope = computeTrendSlope(validIcs);

  // Cost-aware companion when transactionCostBps was passed through
  let costSurvivingFraction: number | undefined;
  if (
    (icOpts as IcOptions).transactionCostBps !== undefined &&
    (icOpts as IcOptions).transactionCostBps! > 0 &&
    validNetEdgesBps.length > 0
  ) {
    const survived = validNetEdgesBps.filter((v) => v > 0).length;
    costSurvivingFraction = survived / validNetEdgesBps.length;
  }

  // Verdict cascade (most-severe first)
  let verdict: WalkForwardVerdict;
  if (stdIc > opts.instabilityStdThreshold || longestNeg > opts.maxNegativeStreak) {
    verdict = "unstable";
  } else if (slope < opts.degradationSlopeThreshold) {
    verdict = "degrading";
  } else if (
    positiveFraction >= opts.robustPositiveFraction &&
    stdIc <= opts.fragilityStdThreshold &&
    Math.abs(meanIc) >= opts.robustMeanIcThreshold
  ) {
    verdict = "robust";
  } else if (
    positiveFraction >= opts.fragilePositiveFraction ||
    (stdIc > opts.fragilityStdThreshold && stdIc <= opts.instabilityStdThreshold)
  ) {
    verdict = "fragile";
  } else {
    // Default fallback when none of the bands match — call it fragile
    // rather than robust to err on caution
    verdict = "fragile";
  }

  const costSuffix =
    costSurvivingFraction !== undefined
      ? `, ${(costSurvivingFraction * 100).toFixed(0)}% cost-surviving`
      : "";
  const summary =
    `${signalName}: ${validIcs.length} valid windows, ` +
    `mean IC ${meanIc.toFixed(3)} (σ=${stdIc.toFixed(3)}), ` +
    `${(positiveFraction * 100).toFixed(0)}% positive, ` +
    `longest neg streak ${longestNeg}, ` +
    `slope ${slope.toFixed(4)}${costSuffix} → ${verdict}`;

  return {
    signalName,
    windowSize: opts.windowSize,
    stepSize: opts.stepSize,
    windows,
    validWindowCount: validIcs.length,
    meanIc,
    medianIc,
    stdIc,
    minIc,
    maxIc,
    positiveFraction,
    longestNegativeStreak: longestNeg,
    longestPositiveStreak: longestPos,
    trendSlope: slope,
    costSurvivingFraction,
    verdict,
    summary,
  };
}
