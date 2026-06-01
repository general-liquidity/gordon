/**
 * Information Coefficient (IC) tracker — per-signal quality diagnostic.
 *
 * The IC of a signal is the correlation between its prediction and
 * the realized forward return. Institutional signals typically sit
 * in IC ∈ [0.05, 0.15] — small, but meaningful when combined.
 *
 * What this module surfaces:
 *
 *   - Point-estimate IC (Pearson correlation of signal vs forward return)
 *   - Rolling sub-window IC series → IC standard deviation + CV
 *   - Trend slope over the sub-window IC series → decay / stable / strengthening
 *   - 95% CI on the IC point estimate (approximate)
 *   - Verdict: active / decaying / noise / unstable / insufficient_data
 *
 * The verdict is the load-bearing operator-facing output. It codifies:
 *
 *   - active           |IC| > 0.05 AND CV ≤ 1.0 AND slope ≥ -0.005/period
 *   - decaying         |IC| > 0.05 BUT slope < -0.005/period (signal is fading)
 *   - noise            |IC| ≤ 0.02 (no detectable correlation)
 *   - unstable         |IC| > 0.02 BUT CV > 1.0 (IC swings sign across sub-windows)
 *   - insufficient_data sample < 30 observations OR sub-windows < 3
 *
 * Cutoffs are tunable but the defaults map to what we'd expect for a
 * signal that should drive Gordon position sizing.
 */

import {
  pearsonCorrelation,
  spearmanCorrelation,
  sampleStd,
  trendSlope,
  ci95HalfWidth,
  coefficientOfVariation,
  mean,
} from "./helpers.ts";

/**
 * Correlation method backing the IC estimate. `pearson` (default) is the
 * classic linear IC; `spearman` is rank-IC, robust to non-linear monotonic
 * signal→return relationships and to outliers.
 */
export type IcMethod = "pearson" | "spearman";

/**
 * Implied-edge breakdown from a measured IC + transaction-cost
 * assumption. Pearson IC is invariant to a constant return shift —
 * subtracting cost from every return does NOT change the correlation.
 * The honest cost surface is therefore an edge breakdown, not a
 * cost-adjusted IC.
 *
 * Math (all values are return units per observation unless stated):
 *
 *   impliedGrossEdgePerObs = IC × σ_return      (Grinold-Kahn implied
 *                                                  edge when signal is
 *                                                  unit-variance)
 *   impliedNetEdgePerObs    = grossEdge - 2 × costFraction
 *                                                  (round trip: cost
 *                                                  hits on entry + exit)
 *   breakevenCostBps        = impliedGrossEdgeBps / 2
 *                                                  (cost level at which
 *                                                  net edge crosses zero)
 *
 * "Bps" fields are expressed in basis points (× 10_000). The operator
 * reads breakevenCostBps as "this signal dies above this cost" — a
 * direct answer the post's framework didn't address.
 */
export interface EdgeDiagnostic {
  transactionCostBps: number;
  /** Standard deviation of forward returns (in return units). */
  returnStd: number;
  /** Implied gross edge per observation (return units). */
  impliedGrossEdgePerObs: number;
  /** Same, expressed in basis points. */
  impliedGrossEdgeBps: number;
  /** Net edge after 2 × transactionCostBps (round-trip), basis points. */
  impliedNetEdgeBps: number;
  /** Cost above which the gross edge no longer survives. */
  breakevenCostBps: number;
  /** True when net edge > 0 at the supplied transactionCostBps. */
  isPositiveAfterCosts: boolean;
}

export type IcVerdict =
  | "active"
  | "decaying"
  | "noise"
  | "unstable"
  | "insufficient_data";

export interface IcOptions {
  /** Number of sub-windows to slice the series into for stability analysis. Default 5. */
  subWindowCount?: number;
  /** Minimum total sample size to compute IC. Default 30. */
  minSampleSize?: number;
  /** Absolute IC threshold below which the signal is labeled noise. Default 0.02. */
  noiseThreshold?: number;
  /** Absolute IC threshold above which the signal is considered active. Default 0.05. */
  activeThreshold?: number;
  /** CV threshold above which sub-window IC swings flag instability. Default 1.0. */
  instabilityCvThreshold?: number;
  /** Decay-slope threshold (per sub-window). Below this → decaying. Default -0.005. */
  decaySlopeThreshold?: number;
  /**
   * Round-trip transaction cost in basis points. When > 0, the
   * snapshot includes an `edge` breakdown (gross / net / breakeven).
   * Pearson IC itself is unchanged — it is invariant to a constant
   * shift in returns. The operator-meaningful cost answer is the
   * edge surface, not a re-correlated IC.
   */
  transactionCostBps?: number;
  /**
   * Correlation method for the IC estimate. Default `pearson` (linear IC).
   * Set `spearman` for rank-IC (robust to non-linear monotonic relationships
   * and outliers). Affects both the point IC and the sub-window stability ICs.
   */
  method?: IcMethod;
}

export interface IcSnapshot {
  signalName: string;
  /** Correlation method used for the IC estimate. */
  method: IcMethod;
  /** Overall IC across all samples (Pearson or Spearman per `method`). Null when computation failed (constant signal, insufficient sample). */
  ic: number | null;
  /** Sample size used. */
  sampleSize: number;
  /** Number of sub-windows that produced a valid IC for stability analysis. */
  subWindowsUsed: number;
  /** Mean of the sub-window IC values. */
  subWindowMeanIc: number;
  /** Standard deviation of the sub-window IC series. */
  subWindowIcStd: number;
  /** Coefficient of variation of the sub-window IC. */
  cvIc: number;
  /** Time-trend slope across the sub-window IC series. Negative = decaying. */
  trendSlope: number;
  /** Approximate 95% CI half-width for the point IC (1.96 × SE). */
  ic95HalfWidth: number;
  /**
   * Implied-edge breakdown including cost adjustment. Present only
   * when `transactionCostBps > 0` was supplied (otherwise the
   * operator was asking for IC-only).
   */
  edge?: EdgeDiagnostic;
  /** Operator-facing verdict. */
  verdict: IcVerdict;
  /** Human-readable summary. */
  summary: string;
}

const DEFAULT_OPTIONS: Required<IcOptions> = {
  subWindowCount: 5,
  minSampleSize: 30,
  noiseThreshold: 0.02,
  activeThreshold: 0.05,
  instabilityCvThreshold: 1.0,
  decaySlopeThreshold: -0.005,
  transactionCostBps: 0,
  method: "pearson",
};

/**
 * Compute a point-estimate IC for a single signal — correlation between
 * signal values and matched-index forward returns. `method` selects Pearson
 * (default, linear IC) or Spearman (rank-IC). Returns null for invalid input
 * (lengths mismatch, constant series, insufficient n, non-finite values).
 */
export function computeIc(
  signalValues: number[],
  forwardReturns: number[],
  method: IcMethod = "pearson",
): number | null {
  return method === "spearman"
    ? spearmanCorrelation(signalValues, forwardReturns)
    : pearsonCorrelation(signalValues, forwardReturns);
}

/**
 * Slice a series into k roughly-equal contiguous sub-windows. Returns
 * fewer than k slices when the series is too short. Each slice
 * preserves the (signal, return) pairing.
 */
function sliceSubWindows(
  signalValues: number[],
  forwardReturns: number[],
  k: number,
): Array<{ signal: number[]; ret: number[] }> {
  const n = signalValues.length;
  if (n < k * 3) {
    // Need at least 3 obs per window for Pearson; back off to fewer
    // windows if necessary.
    k = Math.max(2, Math.floor(n / 3));
  }
  if (k < 2) return [];
  const sliceSize = Math.floor(n / k);
  if (sliceSize < 3) return [];
  const slices: Array<{ signal: number[]; ret: number[] }> = [];
  for (let i = 0; i < k; i++) {
    const start = i * sliceSize;
    const end = i === k - 1 ? n : start + sliceSize;
    slices.push({
      signal: signalValues.slice(start, end),
      ret: forwardReturns.slice(start, end),
    });
  }
  return slices;
}

/**
 * Track Information Coefficient for a single signal.
 *
 * Pairs of (signalValue_t, forwardReturn_t) where forwardReturn is the
 * return realized AFTER the signal was observed at t. The caller is
 * responsible for the alignment (no look-ahead).
 */
export function trackIc(
  signalName: string,
  signalValues: number[],
  forwardReturns: number[],
  options: IcOptions = {},
): IcSnapshot {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const baseSnapshot = {
    signalName,
    method: opts.method,
    ic: null,
    sampleSize: signalValues.length,
    subWindowsUsed: 0,
    subWindowMeanIc: 0,
    subWindowIcStd: 0,
    cvIc: 0,
    trendSlope: 0,
    ic95HalfWidth: 0,
  };

  if (
    signalValues.length !== forwardReturns.length ||
    signalValues.length < opts.minSampleSize
  ) {
    return {
      ...baseSnapshot,
      verdict: "insufficient_data",
      summary: `${signalName}: sample size ${signalValues.length} below ${opts.minSampleSize} minimum`,
    };
  }

  const overallIc = computeIc(signalValues, forwardReturns, opts.method);
  if (overallIc === null) {
    return {
      ...baseSnapshot,
      verdict: "insufficient_data",
      summary: `${signalName}: cannot compute IC (constant series or non-finite values)`,
    };
  }

  // Sub-window stability
  const slices = sliceSubWindows(signalValues, forwardReturns, opts.subWindowCount);
  const subIcs: number[] = [];
  for (const slice of slices) {
    const ic = computeIc(slice.signal, slice.ret, opts.method);
    if (ic !== null) subIcs.push(ic);
  }

  if (subIcs.length < 3) {
    // Not enough sub-windows to assess stability. Surface the point
    // IC but flag the verdict as insufficient_data for the operator.
    return {
      ...baseSnapshot,
      ic: overallIc,
      ic95HalfWidth: ci95HalfWidth(0, signalValues.length),
      verdict: "insufficient_data",
      summary: `${signalName}: IC ${overallIc.toFixed(3)} but only ${subIcs.length} sub-windows usable for stability`,
    };
  }

  const subMean = mean(subIcs);
  const subStd = sampleStd(subIcs);
  const cv = coefficientOfVariation(subMean, subStd);
  const slope = trendSlope(subIcs);

  // Approximate IC standard error: 1/√(n-2) (Fisher's small-sample
  // approximation for Pearson r when sample size is moderate). The
  // CI is then 1.96 × SE.
  const se = 1 / Math.sqrt(Math.max(1, signalValues.length - 2));
  const ic95 = 1.96 * se;

  // Verdict logic
  const absIc = Math.abs(overallIc);
  let verdict: IcVerdict;
  if (absIc <= opts.noiseThreshold) {
    verdict = "noise";
  } else if (cv > opts.instabilityCvThreshold) {
    verdict = "unstable";
  } else if (slope < opts.decaySlopeThreshold) {
    verdict = "decaying";
  } else if (absIc >= opts.activeThreshold) {
    verdict = "active";
  } else {
    // Between noise and active thresholds with stable behavior — call
    // it noise too (operator should not size on it).
    verdict = "noise";
  }

  // Cost-aware edge breakdown — Pearson IC is invariant to a constant
  // shift, so we don't recompute IC. Instead we surface the implied
  // per-observation edge gross + net + breakeven cost. This is the
  // honest answer to "does this signal survive my transaction costs?"
  let edge: EdgeDiagnostic | undefined;
  if (opts.transactionCostBps > 0) {
    const returnStd = sampleStd(forwardReturns);
    const impliedGrossEdgePerObs = overallIc * returnStd;
    const impliedGrossEdgeBps = impliedGrossEdgePerObs * 10_000;
    const impliedNetEdgeBps = impliedGrossEdgeBps - 2 * opts.transactionCostBps;
    const breakevenCostBps = Math.abs(impliedGrossEdgeBps) / 2;
    edge = {
      transactionCostBps: opts.transactionCostBps,
      returnStd,
      impliedGrossEdgePerObs,
      impliedGrossEdgeBps,
      impliedNetEdgeBps,
      breakevenCostBps,
      isPositiveAfterCosts: impliedNetEdgeBps > 0,
    };
  }

  const edgeSuffix = edge
    ? `, gross ${edge.impliedGrossEdgeBps.toFixed(1)}bps → net ${edge.impliedNetEdgeBps.toFixed(1)}bps ` +
      `(breakeven ${edge.breakevenCostBps.toFixed(1)}bps)`
    : "";

  return {
    signalName,
    method: opts.method,
    ic: overallIc,
    sampleSize: signalValues.length,
    subWindowsUsed: subIcs.length,
    subWindowMeanIc: subMean,
    subWindowIcStd: subStd,
    cvIc: cv,
    trendSlope: slope,
    ic95HalfWidth: ic95,
    edge,
    verdict,
    summary:
      `${signalName}: IC ${overallIc.toFixed(3)} ± ${ic95.toFixed(3)} ` +
      `(sub-window CV ${Number.isFinite(cv) ? cv.toFixed(2) : "∞"}, ` +
      `slope ${slope.toFixed(4)}/window${edgeSuffix}) → ${verdict}`,
  };
}
