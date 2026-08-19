/**
 * Distributional Familiarity Gate (FineFT, KDD 2026).
 *
 * Gordon's existing familiarity check (riskClassifier "Asset Familiarity", ~line 343)
 * is binary and symbol-scoped: `portfolio.tradedSymbols.has(trade.symbol)`. That
 * answers "have I traded this ticker before". It cannot answer "does the market look
 * like anything I have seen", which is the question that matters when a FAMILIAR
 * symbol enters an UNFAMILIAR state.
 *
 * This is a density/percentile question, not a classification question. The regime
 * classifier answers "which of my known regimes is this" and structurally cannot
 * abstain, because a classifier always returns a class. This module answers "is this
 * any of them at all", and its whole value is in saying no.
 *
 * Mechanism, following FineFT: segment history into market dynamics, build a density
 * model per dynamic over the state-feature vector, record the in-dynamic scores as a
 * reference distribution. At inference, score the recent state window against each
 * reference through the EMPIRICAL CDF of that reference (so the score is a percentile,
 * comparable across dynamics with different natural scales), EMA-smooth over the
 * window, take the best match. If even the best match falls below threshold, the state
 * is out of distribution for EVERY known regime and control passes to a hardcoded
 * conservative rule rather than to any model.
 *
 * Density estimator: DIAGONAL-COVARIANCE MAHALANOBIS distance to each reference
 * centroid, with a ridge floor on per-feature variance. Chosen over a VAE (the paper's
 * choice), full-covariance Mahalanobis, or kNN because: it is training-free and
 * closed-form, so there is no fitted artifact to drift or version; it is O(d) at
 * inference with no stored sample set, unlike kNN; per-feature variance normalization
 * is exactly what a heterogeneous state vector (ADX next to ATR percentile next to
 * volume ratio) needs; and full covariance requires n >> d, which Gordon does not have
 * per regime segment, and would silently produce a near-singular inverse instead of an
 * honest refusal. Degeneracy in the diagonal case is directly detectable (zero
 * variance), which is what the abstention boundary requires. Feature correlation is the
 * accepted cost; the percentile step absorbs the resulting scale distortion because a
 * reference is judged only against its own recorded distances.
 *
 * The measured effect in the paper was drawdown reduction specifically (lowest max
 * drawdown on all four assets, p<0.005% against twelve baselines), and the honest
 * signal was that the conservative policy's share of control ROSE MONOTONICALLY as the
 * market drifted from the reference period. Monotonic decay under synthetic drift is
 * therefore the acceptance test, not an incidental property.
 *
 * This module decides. It does not trade: the conservative policy is returned as a
 * typed verdict, never as an executed action. Pure and clock-injected throughout.
 */

// ============================================================================
// Types
// ============================================================================

/** A market state as a numeric feature vector. Feature order is the caller's contract. */
export type FeatureVector = readonly number[];

/** Historical state vectors belonging to one market dynamic (regime or segment). */
export interface LabelledStateGroup {
  label: string;
  vectors: readonly FeatureVector[];
}

/** Why a reference cannot be scored against. */
export type ReferenceDefect =
  | "empty"
  | "insufficient_samples"
  | "zero_variance"
  | "dimension_mismatch";

export interface FamiliarityReference {
  label: string;
  dimension: number;
  sampleCount: number;
  /** Per-feature centroid. */
  centroid: readonly number[];
  /** Per-feature variance after the ridge floor, so it is never zero. */
  variance: readonly number[];
  /** In-dynamic Mahalanobis distances, ascending. The empirical reference distribution. */
  referenceScores: readonly number[];
  /** Non-null when this reference is unusable and must abstain rather than score. */
  defect: ReferenceDefect | null;
}

export interface FamiliarityConfig {
  /** Smoothed percentile below which the gate fires. Default 0.1. */
  threshold?: number;
  /** EMA span over the state window. Default 5. */
  emaSpan?: number;
  /** Minimum sample count for a usable reference. Default 4. */
  minSamples?: number;
  /** Fraction of mean positive variance used as the per-feature variance floor. Default 1e-3. */
  varianceRidge?: number;
}

export interface ReferenceScore {
  label: string;
  /** EMA-smoothed percentile over the window, or null when the reference is unusable. */
  smoothedScore: number | null;
  /** Mahalanobis distance of the most recent state, or null when unusable. */
  latestDistance: number | null;
  defect: ReferenceDefect | null;
}

export type FamiliarityReason =
  | "matched"
  | "out_of_distribution"
  | "no_usable_reference"
  | "empty_window";

/** Single-trade state the conservative rule needs. Absent means flat. */
export interface PositionState {
  hasOpenPosition: boolean;
  /** Drawdown on the open trade, as a positive percent magnitude. */
  tradeDrawdownPct: number;
  /** Limit above which the conservative rule flattens instead of holding. */
  maxTradeDrawdownPct: number;
}

export type ConservativeAction = "hold_within_limit" | "flatten" | "no_new_positions";

export interface ConservativeVerdict {
  action: ConservativeAction;
  /** Always false. The conservative rule never opens anything new. */
  allowNewPositions: false;
  reason: string;
}

export interface FamiliarityGateResult {
  /** True when at least one reference matched above threshold. */
  familiar: boolean;
  /** True when no reference matched, so no model should be trusted with this state. */
  outOfDistribution: boolean;
  /** Best smoothed percentile across references. 0 when nothing is scoreable. */
  score: number;
  /** The matched dynamic, or null. Never a best-of-bad label. */
  matchedReference: string | null;
  threshold: number;
  /** Every reference's smoothed score, for operator inspection. */
  perReference: readonly ReferenceScore[];
  reason: FamiliarityReason;
  /** Present only when the gate fires. Null on a match. */
  verdict: ConservativeVerdict | null;
  evaluatedAtMs: number;
}

export interface FamiliarityGateInput {
  references: readonly FamiliarityReference[];
  /** Recent state window, chronological, oldest first. */
  window: readonly FeatureVector[];
  /** Injected clock. This module never reads a wall clock itself. */
  nowMs: number;
  position?: PositionState;
  config?: FamiliarityConfig;
}

// ============================================================================
// Defaults
// ============================================================================

export const DEFAULT_FAMILIARITY_THRESHOLD = 0.1;
export const DEFAULT_FAMILIARITY_EMA_SPAN = 5;
export const DEFAULT_FAMILIARITY_MIN_SAMPLES = 4;
export const DEFAULT_FAMILIARITY_VARIANCE_RIDGE = 1e-3;

interface ResolvedConfig {
  threshold: number;
  emaSpan: number;
  minSamples: number;
  varianceRidge: number;
}

function resolveConfig(config: FamiliarityConfig | undefined): ResolvedConfig {
  return {
    threshold: config?.threshold ?? DEFAULT_FAMILIARITY_THRESHOLD,
    emaSpan: Math.max(1, config?.emaSpan ?? DEFAULT_FAMILIARITY_EMA_SPAN),
    minSamples: Math.max(2, config?.minSamples ?? DEFAULT_FAMILIARITY_MIN_SAMPLES),
    varianceRidge: config?.varianceRidge ?? DEFAULT_FAMILIARITY_VARIANCE_RIDGE,
  };
}

// ============================================================================
// Reference construction
// ============================================================================

function degenerateReference(
  label: string,
  dimension: number,
  sampleCount: number,
  defect: ReferenceDefect,
): FamiliarityReference {
  return {
    label,
    dimension,
    sampleCount,
    centroid: [],
    variance: [],
    referenceScores: [],
    defect,
  };
}

/**
 * Build one reference from the historical state vectors of a single market dynamic.
 *
 * A reference that cannot support a distance (empty, too few samples, or no variance in
 * any feature) is returned marked with a defect rather than with a fabricated
 * covariance. The scorer then abstains on it, which is the correct answer: a degenerate
 * reference has no distribution to be a percentile of.
 */
export function buildFamiliarityReference(
  label: string,
  vectors: readonly FeatureVector[],
  config?: FamiliarityConfig,
): FamiliarityReference {
  const resolved = resolveConfig(config);

  if (vectors.length === 0) return degenerateReference(label, 0, 0, "empty");

  const dimension = vectors[0]!.length;
  if (dimension === 0) return degenerateReference(label, 0, vectors.length, "empty");
  if (vectors.some((v) => v.length !== dimension)) {
    return degenerateReference(label, dimension, vectors.length, "dimension_mismatch");
  }
  if (vectors.length < resolved.minSamples) {
    return degenerateReference(label, dimension, vectors.length, "insufficient_samples");
  }

  const n = vectors.length;
  const centroid = new Array<number>(dimension).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dimension; i++) centroid[i]! += v[i]!;
  }
  for (let i = 0; i < dimension; i++) centroid[i]! /= n;

  // Sample variance (n-1): a reference is a sample of the dynamic, not its population.
  const rawVariance = new Array<number>(dimension).fill(0);
  for (const v of vectors) {
    for (let i = 0; i < dimension; i++) {
      const d = v[i]! - centroid[i]!;
      rawVariance[i]! += d * d;
    }
  }
  for (let i = 0; i < dimension; i++) rawVariance[i]! /= n - 1;

  const positive = rawVariance.filter((x) => x > 0);
  if (positive.length === 0) {
    return degenerateReference(label, dimension, n, "zero_variance");
  }

  // A constant feature carries no information about this dynamic, so it must not be
  // allowed to dominate the distance through a near-zero divisor. Floor it against the
  // reference's own variance scale rather than an absolute epsilon.
  const meanPositive = positive.reduce((a, b) => a + b, 0) / positive.length;
  const floor = meanPositive * resolved.varianceRidge;
  const variance = rawVariance.map((x) => Math.max(x, floor));

  const referenceScores = vectors
    .map((v) => rawMahalanobis(v, centroid, variance))
    .sort((a, b) => a - b);

  return { label, dimension, sampleCount: n, centroid, variance, referenceScores, defect: null };
}

export function buildFamiliarityReferences(
  groups: readonly LabelledStateGroup[],
  config?: FamiliarityConfig,
): FamiliarityReference[] {
  return groups.map((g) => buildFamiliarityReference(g.label, g.vectors, config));
}

// ============================================================================
// Distances
// ============================================================================

function rawMahalanobis(
  vector: FeatureVector,
  centroid: readonly number[],
  variance: readonly number[],
): number {
  let sum = 0;
  for (let i = 0; i < centroid.length; i++) {
    const d = vector[i]! - centroid[i]!;
    sum += (d * d) / variance[i]!;
  }
  return Math.sqrt(sum);
}

/** Variance-normalized distance from a state to a reference centroid. */
export function mahalanobisDistance(
  reference: FamiliarityReference,
  vector: FeatureVector,
): number | null {
  if (reference.defect !== null) return null;
  if (vector.length !== reference.dimension) return null;
  return rawMahalanobis(vector, reference.centroid, reference.variance);
}

/**
 * Un-normalized distance to a reference centroid. Exported because it is the naive
 * alternative this module exists to replace, and the percentile property is only
 * demonstrable by showing this one choosing the wrong reference.
 */
export function euclideanDistanceToCentroid(
  reference: FamiliarityReference,
  vector: FeatureVector,
): number | null {
  if (reference.defect !== null) return null;
  if (vector.length !== reference.dimension) return null;
  let sum = 0;
  for (let i = 0; i < reference.dimension; i++) {
    const d = vector[i]! - reference.centroid[i]!;
    sum += d * d;
  }
  return Math.sqrt(sum);
}

// ============================================================================
// Percentile against a reference's own recorded scores
// ============================================================================

/**
 * Familiarity of a single state against one reference, as 1 minus the empirical CDF of
 * that reference's own in-dynamic distances. A state at the reference median scores
 * 0.5; a state closer than every recorded sample approaches 1.
 *
 * Beyond the reference's furthest recorded sample the ECDF saturates at 1, which would
 * make every far state score exactly 0 and flatten the drift signal into a cliff. An
 * exponential tail continues the decay past that point so the score stays strictly
 * decreasing in distance, which is what makes progressive drift observable.
 */
export function familiarityPercentile(
  reference: FamiliarityReference,
  vector: FeatureVector,
): number | null {
  const distance = mahalanobisDistance(reference, vector);
  if (distance === null) return null;
  return percentileFromDistance(reference, distance);
}

function percentileFromDistance(reference: FamiliarityReference, distance: number): number {
  const scores = reference.referenceScores;
  const n = scores.length;
  const maxScore = scores[n - 1]!;

  if (distance > maxScore) {
    const minScore = scores[0]!;
    const spread = Math.max(maxScore - minScore, maxScore * 0.1, 1e-9);
    return (0.5 / n) * Math.exp(-(distance - maxScore) / spread);
  }

  // Midrank ECDF: ties contribute half, so a repeated state does not jump the score.
  const below = countStrictlyBelow(scores, distance);
  const atOrBelow = countAtOrBelow(scores, distance);
  const ecdf = (below + atOrBelow) / (2 * n);
  return 1 - ecdf;
}

function countStrictlyBelow(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function countAtOrBelow(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid]! <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

// ============================================================================
// Conservative policy
// ============================================================================

/**
 * The FineFT conservative rule, deliberately trivial: hold the existing position while
 * single-trade drawdown stays within limit, otherwise flatten, and never open anything
 * new. Returned as a decision. Execution is somebody else's job.
 */
export function conservativeVerdict(position: PositionState | undefined): ConservativeVerdict {
  if (!position || !position.hasOpenPosition) {
    return {
      action: "no_new_positions",
      allowNewPositions: false,
      reason: "State is out of distribution for every known dynamic and no position is open.",
    };
  }
  if (position.tradeDrawdownPct > position.maxTradeDrawdownPct) {
    return {
      action: "flatten",
      allowNewPositions: false,
      reason:
        `Trade drawdown ${position.tradeDrawdownPct.toFixed(2)}% exceeds the ` +
        `${position.maxTradeDrawdownPct.toFixed(2)}% conservative limit in an unrecognized state.`,
    };
  }
  return {
    action: "hold_within_limit",
    allowNewPositions: false,
    reason:
      `Trade drawdown ${position.tradeDrawdownPct.toFixed(2)}% is within the ` +
      `${position.maxTradeDrawdownPct.toFixed(2)}% limit, so the position is held and nothing new is opened.`,
  };
}

// ============================================================================
// Gate
// ============================================================================

/**
 * Score the recent state window against every reference and decide whether any known
 * dynamic recognizes it.
 *
 * EMA smoothing over the window is what stops one anomalous bar from handing control to
 * the conservative rule, while a sustained shift still crosses the threshold. Without
 * it the gate would be as twitchy as the raw classifier that hysteresisGate.ts already
 * had to damp.
 */
export function evaluateFamiliarity(input: FamiliarityGateInput): FamiliarityGateResult {
  const config = resolveConfig(input.config);
  const { threshold } = config;
  const alpha = 2 / (config.emaSpan + 1);

  const perReference: ReferenceScore[] = input.references.map((reference) => {
    if (reference.defect !== null) {
      return {
        label: reference.label,
        smoothedScore: null,
        latestDistance: null,
        defect: reference.defect,
      };
    }
    if (input.window.length === 0) {
      return { label: reference.label, smoothedScore: null, latestDistance: null, defect: null };
    }
    if (input.window.some((v) => v.length !== reference.dimension)) {
      return {
        label: reference.label,
        smoothedScore: null,
        latestDistance: null,
        defect: "dimension_mismatch",
      };
    }

    let ema = 0;
    let latestDistance = 0;
    for (let i = 0; i < input.window.length; i++) {
      latestDistance = rawMahalanobis(input.window[i]!, reference.centroid, reference.variance);
      const percentile = percentileFromDistance(reference, latestDistance);
      ema = i === 0 ? percentile : ema + alpha * (percentile - ema);
    }
    return { label: reference.label, smoothedScore: ema, latestDistance, defect: null };
  });

  if (input.window.length === 0) {
    return {
      familiar: false,
      outOfDistribution: true,
      score: 0,
      matchedReference: null,
      threshold,
      perReference,
      reason: "empty_window",
      verdict: conservativeVerdict(input.position),
      evaluatedAtMs: input.nowMs,
    };
  }

  const scoreable = perReference.filter((r) => r.smoothedScore !== null);
  if (scoreable.length === 0) {
    return {
      familiar: false,
      outOfDistribution: true,
      score: 0,
      matchedReference: null,
      threshold,
      perReference,
      reason: "no_usable_reference",
      verdict: conservativeVerdict(input.position),
      evaluatedAtMs: input.nowMs,
    };
  }

  let best = scoreable[0]!;
  for (const candidate of scoreable) {
    if (candidate.smoothedScore! > best.smoothedScore!) best = candidate;
  }
  const score = best.smoothedScore!;

  if (score < threshold) {
    return {
      familiar: false,
      outOfDistribution: true,
      score,
      matchedReference: null,
      threshold,
      perReference,
      reason: "out_of_distribution",
      verdict: conservativeVerdict(input.position),
      evaluatedAtMs: input.nowMs,
    };
  }

  return {
    familiar: true,
    outOfDistribution: false,
    score,
    matchedReference: best.label,
    threshold,
    perReference,
    reason: "matched",
    verdict: null,
    evaluatedAtMs: input.nowMs,
  };
}

/**
 * Rolling state vectors from a plain price series: windowed log return,
 * realized volatility of the within-window returns, and the deepest drawdown
 * inside the window. Three features chosen so a calm advance and a violent one
 * do not collapse to the same point, while staying computable from the only
 * market data most callers actually hold.
 *
 * Returns one vector per complete window. A series shorter than `window + 1`
 * yields none rather than a padded vector, since a partial window is a
 * different estimator wearing the same name.
 */
export function priceHistoryToStateVectors(
  prices: readonly number[],
  window: number,
): FeatureVector[] {
  if (window < 2 || prices.length < window + 1) return [];
  const vectors: FeatureVector[] = [];
  for (let end = window; end < prices.length; end += 1) {
    const start = end - window;
    const first = prices[start];
    const last = prices[end];
    if (first === undefined || last === undefined) continue;
    if (!(first > 0) || !(last > 0)) continue;

    const returns: number[] = [];
    for (let i = start + 1; i <= end; i += 1) {
      const prev = prices[i - 1];
      const cur = prices[i];
      if (prev === undefined || cur === undefined) continue;
      if (!(prev > 0) || !(cur > 0)) continue;
      returns.push(Math.log(cur / prev));
    }
    if (returns.length === 0) continue;

    const mean = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance =
      returns.reduce((s, r) => s + (r - mean) * (r - mean), 0) / returns.length;

    let peak = first;
    let maxDrawdown = 0;
    for (let i = start; i <= end; i += 1) {
      const price = prices[i];
      if (price === undefined) continue;
      if (price > peak) peak = price;
      if (peak > 0) {
        const dd = (peak - price) / peak;
        if (dd > maxDrawdown) maxDrawdown = dd;
      }
    }

    vectors.push([Math.log(last / first), Math.sqrt(variance), maxDrawdown]);
  }
  return vectors;
}
