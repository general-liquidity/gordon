/**
 * Percentile-of-bootstrapped-utility parameter selection.
 *
 * Picking the parameter that maximised in-sample utility is the most common way a backtest
 * lies. The point estimate is one draw from a distribution, and argmax over candidates is an
 * argmax over that draw's noise as much as over any real edge. Non-Parametric Bootstrap Robust
 * Optimization (2025) replaces the point estimate with the distribution: treat utility as a
 * random variable over dependence-preserving bootstrap resamples of the price path, and select
 * the parameter maximising the ALPHA-TH PERCENTILE of that distribution rather than its maximum
 * or its mean.
 *
 * The measured result is the argument. On time-series momentum lookback selection across ETFs
 * and roughly 50 futures contracts, in-sample empirical-risk-minimisation reached the best
 * in-sample Sharpe and was among the WORST out of sample, with generalization gaps approaching
 * -1.0. Mid-quantile selections, the 30th to 70th percentile, had significantly narrower and
 * less negative gaps, with non-overlapping 95% intervals. The same pattern held for max
 * drawdown: the in-sample winner looked best at -15% and degraded most, by about +20 percentage
 * points, out of sample.
 *
 * Two details decide whether the numbers mean anything:
 *
 *   1. The resampler MUST preserve serial dependence. IID resampling destroys autocorrelation,
 *      volatility clustering and trend persistence, which are exactly the properties a trading
 *      rule trades, so an IID bootstrap flatters every path-dependent rule. The default here is
 *      the stationary bootstrap (Politis and Romano) with geometric block lengths.
 *   2. When bootstrapping a portfolio, mean and covariance must be drawn JOINTLY from the same
 *      resample. Drawing them independently discards their dependence, which is the thing a
 *      parametric interval gets wrong. This module therefore resamples INDICES, not values, and
 *      hands the same index vector to the evaluation function, so every series a caller touches
 *      is resampled in lockstep and cross-sectional structure survives.
 *
 * The reported sweet spot is the 40th to 70th percentile, NOT the extreme lower tail. A reader's
 * instinct is "more conservative is safer", and that instinct is wrong here: selecting on the
 * 5th percentile optimises for a disaster that mostly did not happen, and gives up too much real
 * expected utility to buy protection against a scenario the data barely supports. The default is
 * the median, which sits in the middle of the measured band.
 *
 * The diagnostic that carries most of the value is `overfitGap`: the distance between a
 * candidate's in-sample point estimate and its selected percentile. A candidate whose point
 * estimate sits far above its percentile is the overfit one, and surfacing that per candidate is
 * what lets a caller distrust a selection instead of merely receiving one.
 *
 * Relationship to what Gordon already has:
 *   - `infra/trading/quant/pathRiskMonteCarlo.ts` has a stationary bootstrap, but it resamples
 *     VALUES from a single return series. That shape cannot express a joint multi-series draw,
 *     and `core` importing from `infra/trading` would invert the layering. The resampler here is
 *     the same Politis-Romano scheme expressed over indices.
 *   - `core/alpha/too-good-check.ts` flags a result that is implausible on its face. This module
 *     answers the prior question of which parameter to adopt, and `overfitGap` gives that gate a
 *     per-candidate fragility number to reason about.
 *
 * Generic and trading-agnostic by construction: candidates, a resampler, and an evaluation
 * function go in; a selection plus its evidence comes out. Pure: no I/O, and no read of the wall
 * clock. A clock is injected when the caller wants the result stamped.
 */

import { quantileSorted } from "./index.ts";

/** Middle of the 40th-to-70th band the paper measures as the sweet spot. */
export const DEFAULT_ALPHA = 0.5;
export const DEFAULT_RESAMPLES = 500;
export const DEFAULT_SEED = 1;

/**
 * Stateless counter-based uniform draw. The value is a pure hash of (seed, resample, step)
 * rather than a position in an RNG stream, so any single resample is independently
 * reconstructible from its coordinates: an auditor can regenerate resample 317 of a selection
 * without replaying the 316 before it.
 */
export function counterUniform(seed: number, resample: number, step: number): number {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ ((resample + 0x27d4eb2f) >>> 0), 0xc2b2ae35) >>> 0;
  h ^= h >>> 15;
  h = Math.imul(h ^ ((step + 0x165667b1) >>> 0), 0x27d4eb2f) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Sequential view over the counter PRNG for one resample's coordinate space. */
export function makeCounterStream(seed: number, resample: number): () => number {
  let step = 0;
  return () => counterUniform(seed, resample, step++);
}

/**
 * Draws a vector of observation indices. Returning indices rather than values is what makes the
 * joint draw possible: the caller applies one index vector to every series it holds.
 */
export type IndexResampler = (
  sampleSize: number,
  length: number,
  meanBlockLength: number,
  uniform: () => number,
) => number[];

/**
 * Stationary bootstrap (Politis and Romano 1994). Concatenate blocks whose lengths are
 * geometric with mean `meanBlockLength`, each starting at a uniform index and wrapping
 * circularly. Preserves short-range autocorrelation and volatility clustering; the random block
 * length keeps the resampled series stationary, which a fixed block length does not.
 */
export const stationaryBootstrapIndices: IndexResampler = (
  sampleSize,
  length,
  meanBlockLength,
  uniform,
) => {
  const out = new Array<number>(length).fill(0);
  if (sampleSize <= 1) return out;

  const restartProbability = meanBlockLength > 1 ? 1 / meanBlockLength : 1;
  let idx = 0;
  for (let i = 0; i < length; i++) {
    if (i === 0 || uniform() < restartProbability) {
      idx = Math.min(sampleSize - 1, Math.floor(uniform() * sampleSize));
    } else {
      idx = (idx + 1) % sampleSize;
    }
    out[i] = idx;
  }
  return out;
};

/**
 * IID bootstrap. Present as the explicit baseline that DESTROYS serial dependence, so a caller
 * can measure what the dependence-preserving resampler is buying. Not a default.
 */
export const iidBootstrapIndices: IndexResampler = (
  sampleSize,
  length,
  _meanBlockLength,
  uniform,
) => {
  const out = new Array<number>(length).fill(0);
  if (sampleSize <= 1) return out;
  for (let i = 0; i < length; i++) {
    out[i] = Math.min(sampleSize - 1, Math.floor(uniform() * sampleSize));
  }
  return out;
};

/** Rule-of-thumb mean block length for a sample of `n` observations. */
export function defaultMeanBlockLength(sampleSize: number): number {
  return Math.max(2, Math.round(Math.sqrt(Math.max(1, sampleSize))));
}

export interface BootstrapSelectOptions<TCandidate> {
  readonly candidates: readonly TCandidate[];
  /** Observation count of the underlying sample; indices are drawn from [0, sampleSize). */
  readonly sampleSize: number;
  /**
   * Utility of a candidate on the observations named by `indices`. Called once per candidate per
   * resample, plus once per candidate with the identity ordering for the point estimate. Must be
   * pure; a non-finite return is treated as a failed evaluation and excluded from the
   * distribution.
   */
  readonly evaluate: (candidate: TCandidate, indices: readonly number[]) => number;
  /** Percentile to select on, 0..1. Default 0.5. Values below 0.3 are reported as a warning. */
  readonly alpha?: number;
  readonly resamples?: number;
  readonly seed?: number;
  readonly resampler?: IndexResampler;
  readonly meanBlockLength?: number;
  /** Length of each resampled path. Defaults to `sampleSize`. */
  readonly resampleLength?: number;
  readonly label?: (candidate: TCandidate, index: number) => string;
  /** Injected clock, used only to stamp the result. Omitting it leaves the stamp null. */
  readonly clock?: () => number;
}

export interface CandidateEvidence<TCandidate> {
  readonly candidate: TCandidate;
  readonly index: number;
  readonly label: string;
  /** Utility on the observed sample in its observed order: the number argmax would select on. */
  readonly pointEstimate: number;
  /** Utility at `alpha` of the bootstrap distribution: the number this selector selects on. */
  readonly percentileUtility: number;
  readonly meanUtility: number;
  readonly medianUtility: number;
  readonly p05: number;
  readonly p95: number;
  /** p95 minus p05: how wide the candidate's utility distribution is. */
  readonly spread: number;
  readonly stdDev: number;
  /** pointEstimate minus percentileUtility. The overfit diagnostic; large is bad. */
  readonly overfitGap: number;
  /** Resamples whose evaluation returned a finite utility. */
  readonly evaluations: number;
  readonly sortedUtilities: readonly number[];
}

export interface BootstrapSelectionResult<TCandidate> {
  readonly alpha: number;
  readonly resamples: number;
  readonly seed: number;
  readonly sampleSize: number;
  readonly meanBlockLength: number;
  readonly selected: TCandidate;
  readonly selectedIndex: number;
  readonly selectedUtility: number;
  /** What plain argmax-of-point-estimate would have chosen. */
  readonly pointEstimateWinner: TCandidate;
  readonly pointEstimateWinnerIndex: number;
  /** True when the two disagree: the case the whole method exists for. */
  readonly disagreesWithPointEstimate: boolean;
  readonly evidence: readonly CandidateEvidence<TCandidate>[];
  readonly warnings: readonly string[];
  readonly generatedAtMs: number | null;
}

function meanOf(xs: readonly number[]): number {
  if (xs.length === 0) return 0;
  let sum = 0;
  for (const x of xs) sum += x;
  return sum / xs.length;
}

function stdDevOf(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) * (x - m);
  return Math.sqrt(ss / (xs.length - 1));
}

/**
 * Select the candidate maximising the alpha-th percentile of its bootstrapped utility
 * distribution, and return the evidence needed to trust or distrust that selection.
 */
export function selectByBootstrapPercentile<TCandidate>(
  options: BootstrapSelectOptions<TCandidate>,
): BootstrapSelectionResult<TCandidate> {
  const {
    candidates,
    sampleSize,
    evaluate,
    alpha = DEFAULT_ALPHA,
    resamples = DEFAULT_RESAMPLES,
    seed = DEFAULT_SEED,
    resampler = stationaryBootstrapIndices,
    label,
    clock,
  } = options;

  if (candidates.length === 0) {
    throw new Error("selectByBootstrapPercentile: at least one candidate is required");
  }
  if (!Number.isInteger(sampleSize) || sampleSize < 1) {
    throw new Error(
      `selectByBootstrapPercentile: sampleSize must be a positive integer, got ${sampleSize}`,
    );
  }
  if (!(alpha >= 0 && alpha <= 1)) {
    throw new Error(`selectByBootstrapPercentile: alpha must lie in [0, 1], got ${alpha}`);
  }

  const meanBlockLength = options.meanBlockLength ?? defaultMeanBlockLength(sampleSize);
  const resampleLength = options.resampleLength ?? sampleSize;
  const warnings: string[] = [];

  if (alpha < 0.3) {
    warnings.push(
      `alpha ${alpha} sits below the 0.3-0.7 band measured to generalize best; the extreme lower tail optimises for a disaster the sample barely evidences`,
    );
  }
  if (alpha > 0.9) {
    warnings.push(
      `alpha ${alpha} is close to the upper tail, which reintroduces the selection-on-luck this method exists to avoid`,
    );
  }
  if (sampleSize < 2) {
    warnings.push(
      "sampleSize below 2 leaves nothing to resample; every resample repeats the single observation",
    );
  }
  if (candidates.length === 1) {
    warnings.push("a single candidate cannot be selected against; the evidence is still reported");
  }

  const identity = Array.from({ length: sampleSize }, (_, i) => i);

  // One index vector per resample, SHARED across candidates. Sharing makes the comparison
  // paired: candidates are ranked on the same synthetic histories, not on independently lucky
  // ones, and every series inside one evaluation is drawn jointly.
  const indexVectors: number[][] = [];
  for (let s = 0; s < resamples; s++) {
    indexVectors.push(
      resampler(sampleSize, resampleLength, meanBlockLength, makeCounterStream(seed, s)),
    );
  }

  const evidence: CandidateEvidence<TCandidate>[] = candidates.map((candidate, index) => {
    const pointEstimateRaw = evaluate(candidate, identity);
    const pointEstimate = Number.isFinite(pointEstimateRaw) ? pointEstimateRaw : Number.NaN;
    const candidateLabel = label ? label(candidate, index) : String(index);

    const utilities: number[] = [];
    for (const indices of indexVectors) {
      const u = evaluate(candidate, indices);
      if (Number.isFinite(u)) utilities.push(u);
    }

    if (utilities.length === 0) {
      warnings.push(
        `candidate ${candidateLabel} produced no finite utility across ${resamples} resamples`,
      );
      return {
        candidate,
        index,
        label: candidateLabel,
        pointEstimate,
        percentileUtility: Number.NEGATIVE_INFINITY,
        meanUtility: Number.NaN,
        medianUtility: Number.NaN,
        p05: Number.NaN,
        p95: Number.NaN,
        spread: Number.NaN,
        stdDev: Number.NaN,
        overfitGap: Number.NaN,
        evaluations: 0,
        sortedUtilities: [],
      };
    }

    const sorted = [...utilities].sort((a, b) => a - b);
    const percentileUtility = quantileSorted(sorted, alpha);
    const p05 = quantileSorted(sorted, 0.05);
    const p95 = quantileSorted(sorted, 0.95);

    return {
      candidate,
      index,
      label: candidateLabel,
      pointEstimate,
      percentileUtility,
      meanUtility: meanOf(sorted),
      medianUtility: quantileSorted(sorted, 0.5),
      p05,
      p95,
      spread: p95 - p05,
      stdDev: stdDevOf(sorted),
      overfitGap: Number.isFinite(pointEstimate) ? pointEstimate - percentileUtility : Number.NaN,
      evaluations: sorted.length,
      sortedUtilities: sorted,
    };
  });

  let selectedIndex = 0;
  let pointEstimateWinnerIndex = 0;
  for (let i = 1; i < evidence.length; i++) {
    if (evidence[i]!.percentileUtility > evidence[selectedIndex]!.percentileUtility) {
      selectedIndex = i;
    }
    const pe = evidence[i]!.pointEstimate;
    const best = evidence[pointEstimateWinnerIndex]!.pointEstimate;
    if (Number.isFinite(pe) && (!Number.isFinite(best) || pe > best)) pointEstimateWinnerIndex = i;
  }

  const selectedEvidence = evidence[selectedIndex]!;
  const widestGap = evidence.reduce(
    (worst, e) =>
      Number.isFinite(e.overfitGap) && e.overfitGap > worst.gap
        ? { gap: e.overfitGap, label: e.label }
        : worst,
    { gap: Number.NEGATIVE_INFINITY, label: "" },
  );
  if (widestGap.label !== "" && widestGap.label !== selectedEvidence.label) {
    warnings.push(
      `candidate ${widestGap.label} has the widest point-estimate-to-percentile gap (${widestGap.gap.toFixed(4)}); it is the most likely overfit and was not selected`,
    );
  }

  return {
    alpha,
    resamples,
    seed,
    sampleSize,
    meanBlockLength,
    selected: selectedEvidence.candidate,
    selectedIndex,
    selectedUtility: selectedEvidence.percentileUtility,
    pointEstimateWinner: evidence[pointEstimateWinnerIndex]!.candidate,
    pointEstimateWinnerIndex,
    disagreesWithPointEstimate: selectedIndex !== pointEstimateWinnerIndex,
    evidence,
    warnings,
    generatedAtMs: clock ? clock() : null,
  };
}
