/**
 * Signal-Recency Reweighting Helper
 *
 * Forward-looking signal weight selection based on recent performance.
 * Scott (HyperTrend) cites: "the correlation of the last 6 months'
 * returns accounts for 13% of next month's signal performance." So
 * you can SLIGHTLY upweight signals that have done well recently and
 * downweight ones that haven't — but the strength of the reweighting
 * should be modest given the modest correlation.
 *
 * Distinct from:
 *   - `expectancy-by-tag.ts`     (backward-looking decomposition by
 *                                  operator-supplied tag; doesn't
 *                                  produce next-period weights)
 *   - `composite-attribution.ts` (verdict-to-input-dimensions, not
 *                                  signal-to-weight)
 *   - `walk-forward-ic.ts`       (IC time-series tracking, not
 *                                  forward signal weight selection)
 *   - `cross-sectional-momentum` (asset-level ranking, not
 *                                  signal-portfolio-level)
 *
 * Procedure:
 *   1. For each signal, compute a recent-period performance metric
 *      (mean return / Sharpe / hit rate, operator's choice)
 *   2. Standardize across signals (z-score)
 *   3. Apply tunable strength multiplier (default 0.13 matching
 *      Scott's reported 6-month correlation)
 *   4. Convert standardized scores into weights via softmax-like
 *      transform (exp + normalize) so weights sum to 1
 *   5. Apply optional floor + ceiling per signal
 *
 * Pure function. Operator supplies signal performance history;
 * primitive doesn't compute returns from raw data.
 */

export interface SignalPerformance {
  /** Signal identifier. */
  signalId: string;
  /**
   * Recent-period return series for this signal. Operator computes
   * however they want (per-trade R, per-period return, etc.). Order
   * is oldest → newest within the recency window the operator wants
   * to use.
   */
  recentReturns: ReadonlyArray<number>;
}

export interface SignalReweightingOptions {
  /**
   * Performance metric to rank signals on.
   *   "mean"    = arithmetic mean of recentReturns
   *   "sharpe"  = mean / std × sqrt(annualization) — uses
   *               annualization if supplied, else just mean / std
   *   "hit_rate" = fraction of positive returns
   *  Default "mean".
   */
  metric?: "mean" | "sharpe" | "hit_rate";
  /**
   * Optional annualization factor for "sharpe" metric. Default 1
   * (no annualization).
   */
  annualizationFactor?: number;
  /**
   * Reweighting strength. Z-scores are multiplied by this before
   * softmax. Default 0.13 (matches Scott's reported 6-month
   * correlation). Higher = more aggressive reweighting; 0 = equal
   * weight regardless of performance.
   */
  strength?: number;
  /**
   * Minimum weight floor per signal as a fraction. Default 0.02
   * (no signal gets less than 2% of weight).
   */
  minWeight?: number;
  /**
   * Maximum weight ceiling per signal as a fraction. Default 0.50
   * (no signal gets more than 50% of weight).
   */
  maxWeight?: number;
  /** Minimum periods required per signal for verdict. Default 5. */
  minPeriodsPerSignal?: number;
}

export type ReweightingVerdict = "reweighted" | "equal_weighted_fallback" | "insufficient_data";

export interface SignalWeightAssignment {
  signalId: string;
  recentMetric: number;
  zScore: number;
  weight: number;
  /** Weight relative to equal-weight baseline. > 1 = upweighted. */
  relativeToEqualWeight: number;
}

export interface SignalReweightingResult {
  signalCount: number;
  validSignalCount: number;
  metric: "mean" | "sharpe" | "hit_rate";
  weights: SignalWeightAssignment[];
  verdict: ReweightingVerdict;
  summary: string;
}

const DEFAULT_STRENGTH = 0.13;
const DEFAULT_MIN_WEIGHT = 0.02;
const DEFAULT_MAX_WEIGHT = 0.5;
const DEFAULT_MIN_PERIODS = 5;
const DEFAULT_ANNUALIZATION = 1;

function meanOf(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let s = 0;
  for (const v of values) s += v;
  return s / values.length;
}

function stdOf(values: ReadonlyArray<number>): number {
  if (values.length < 2) return 0;
  const m = meanOf(values);
  let s = 0;
  for (const v of values) s += (v - m) * (v - m);
  return Math.sqrt(s / (values.length - 1));
}

function hitRateOf(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let pos = 0;
  for (const v of values) if (v > 0) pos += 1;
  return pos / values.length;
}

function computeMetric(
  values: ReadonlyArray<number>,
  metric: "mean" | "sharpe" | "hit_rate",
  annualization: number,
): number {
  if (metric === "mean") return meanOf(values);
  if (metric === "hit_rate") return hitRateOf(values);
  // sharpe
  const m = meanOf(values);
  const s = stdOf(values);
  if (s === 0) return 0;
  return (m / s) * Math.sqrt(annualization);
}

export function reweightSignals(
  signals: ReadonlyArray<SignalPerformance>,
  options: SignalReweightingOptions = {},
): SignalReweightingResult {
  const metric = options.metric ?? "mean";
  const annual = options.annualizationFactor ?? DEFAULT_ANNUALIZATION;
  const strength = options.strength ?? DEFAULT_STRENGTH;
  const minW = options.minWeight ?? DEFAULT_MIN_WEIGHT;
  const maxW = options.maxWeight ?? DEFAULT_MAX_WEIGHT;
  const minPeriods = options.minPeriodsPerSignal ?? DEFAULT_MIN_PERIODS;

  if (signals.length === 0) {
    return {
      signalCount: 0,
      validSignalCount: 0,
      metric,
      weights: [],
      verdict: "insufficient_data",
      summary: "No signals supplied.",
    };
  }

  const valid = signals.filter((s) => s.recentReturns.length >= minPeriods);
  if (valid.length < 2) {
    // Fall back to equal weighting across all supplied signals
    const equalWeight = 1 / signals.length;
    const weights = signals.map((s) => ({
      signalId: s.signalId,
      recentMetric: 0,
      zScore: 0,
      weight: parseFloat(equalWeight.toFixed(6)),
      relativeToEqualWeight: 1,
    }));
    return {
      signalCount: signals.length,
      validSignalCount: valid.length,
      metric,
      weights,
      verdict: "equal_weighted_fallback",
      summary: `Fewer than 2 signals have ≥${minPeriods} periods. Falling back to equal weights.`,
    };
  }

  // Compute per-signal metric
  const metrics = valid.map((s) => ({
    signalId: s.signalId,
    metric: computeMetric(s.recentReturns, metric, annual),
  }));

  const metricValues = metrics.map((m) => m.metric);
  const metricMean = meanOf(metricValues);
  const metricStd = stdOf(metricValues);

  // Standardize: z = (m - mean) / std
  const zScores = metrics.map((m) => {
    if (metricStd === 0) return { signalId: m.signalId, metric: m.metric, z: 0 };
    return {
      signalId: m.signalId,
      metric: m.metric,
      z: (m.metric - metricMean) / metricStd,
    };
  });

  // Apply softmax with strength scaling: exp(strength × z) / sum(exp(...))
  const exponents = zScores.map((s) => Math.exp(strength * s.z));
  const expSum = exponents.reduce((a, b) => a + b, 0);
  let rawWeights = exponents.map((e) => e / expSum);

  // Apply floor + ceiling via fixed-point iteration: clamp, renormalize
  // un-clamped slots, repeat until stable. Single-pass clamp+renormalize
  // can push values back out of [minW, maxW]; iteration converges.
  const MAX_ITER = 20;
  for (let iter = 0; iter < MAX_ITER; iter++) {
    let changed = false;
    let frozenSum = 0;
    let freeSum = 0;
    const isFrozen: boolean[] = rawWeights.map(() => false);
    for (let i = 0; i < rawWeights.length; i++) {
      if (rawWeights[i]! < minW) {
        rawWeights[i] = minW;
        isFrozen[i] = true;
        changed = true;
      } else if (rawWeights[i]! > maxW) {
        rawWeights[i] = maxW;
        isFrozen[i] = true;
        changed = true;
      }
      if (isFrozen[i]) frozenSum += rawWeights[i]!;
      else freeSum += rawWeights[i]!;
    }
    const remaining = Math.max(0, 1 - frozenSum);
    if (freeSum > 0 && remaining > 0) {
      const scale = remaining / freeSum;
      for (let i = 0; i < rawWeights.length; i++) {
        if (!isFrozen[i]) rawWeights[i] = rawWeights[i]! * scale;
      }
    } else if (freeSum === 0) {
      // All frozen — just renormalize as a fallback
      const totalSum = rawWeights.reduce((a, b) => a + b, 0);
      if (totalSum > 0) rawWeights = rawWeights.map((w) => w / totalSum);
    }
    if (!changed) break;
  }

  const equalBaseline = 1 / valid.length;
  const weights: SignalWeightAssignment[] = zScores.map((s, i) => ({
    signalId: s.signalId,
    recentMetric: parseFloat(s.metric.toFixed(6)),
    zScore: parseFloat(s.z.toFixed(6)),
    weight: parseFloat(rawWeights[i]!.toFixed(6)),
    relativeToEqualWeight: parseFloat((rawWeights[i]! / equalBaseline).toFixed(6)),
  }));

  // Append invalid signals with zero weight for visibility
  for (const s of signals) {
    if (!valid.some((v) => v.signalId === s.signalId)) {
      weights.push({
        signalId: s.signalId,
        recentMetric: 0,
        zScore: 0,
        weight: 0,
        relativeToEqualWeight: 0,
      });
    }
  }

  const summary =
    `${valid.length}/${signals.length} signals reweighted using ${metric}, strength=${strength}. ` +
    `Top: ${weights[0]!.signalId} (weight ${(weights[0]!.weight * 100).toFixed(1)}%, ` +
    `${weights[0]!.relativeToEqualWeight.toFixed(2)}× equal). ` +
    `Bottom valid: ${weights.filter((w) => w.weight > 0).slice(-1)[0]!.signalId}.`;

  return {
    signalCount: signals.length,
    validSignalCount: valid.length,
    metric,
    weights,
    verdict: "reweighted",
    summary,
  };
}

export function formatSignalReweighting(result: SignalReweightingResult): string {
  const lines = [
    `Signal Reweighting — ${result.verdict.toUpperCase()}`,
    "",
    `  Signals supplied: ${result.signalCount}`,
    `  Valid (sufficient periods): ${result.validSignalCount}`,
    `  Metric: ${result.metric}`,
    "",
    "  Weights:",
  ];
  for (const w of result.weights) {
    lines.push(
      `    ${w.signalId.padEnd(20)} metric=${w.recentMetric.toFixed(4).padStart(8)} z=${w.zScore.toFixed(2).padStart(6)} → weight ${(w.weight * 100).toFixed(2).padStart(6)}% (${w.relativeToEqualWeight.toFixed(2)}× equal)`,
    );
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
