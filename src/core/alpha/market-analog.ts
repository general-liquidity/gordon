/**
 * Market-analog retrieval — non-parametric "what happened the last K times the
 * tape looked like this" forecaster.
 *
 * The trading translation of codebase-aware retrieval: given the CURRENT market
 * feature-vector (vol / trend / breadth / funding / regime …), find the K most
 * similar historical states and return the EMPIRICAL forward-return distribution
 * of what followed them — not a point forecast, a distribution with its tails.
 *
 * This is distinct from the three things Gordon already has:
 *   - `trade-journal.getSimilarTrades` is text-semantic search over the operator's
 *     OWN trade notes, not a quant k-NN over market states.
 *   - `conditional-distribution-test` TESTS whether a signal shifts the distribution;
 *     it does not RETRIEVE the analog sample.
 *   - `hmmRegime` CLASSIFIES the current state into a regime label; it does not
 *     surface the matched historical sample or its outcome dispersion.
 *
 * Method (standard analog / matched-sample forecasting):
 *   1. Standardize features (z-score per dimension over the candidate set) so the
 *      distance is scale-free — otherwise the largest-magnitude feature dominates.
 *   2. Weighted-Euclidean distance from the query to every candidate; take the K nearest.
 *   3. Summarize the analogs' forward returns (mean / median / win-rate / p05…p95),
 *      contrast against the unconditional baseline (the SHIFT is the signal), and
 *      gate the result on neighbor quality + a two-sample significance test.
 *
 * Pure analyzer — no I/O, no infra. The caller supplies the candidate states (each
 * a feature-vector + the realized forward return) and the query vector.
 */

import { studentTTwoSidedPValue } from "../indicators/linearRegression.ts";

export interface AnalogState {
  /** Feature vector describing the market state at some historical time. */
  features: number[];
  /** Realized forward return after this state, over the caller's chosen horizon. */
  forwardReturn: number;
  /** Optional provenance label (timestamp / symbol / setup id). */
  id?: string;
}

export interface MarketAnalogOptions {
  /** Number of nearest analogs to retrieve (default 30). Clamped to the candidate count. */
  k?: number;
  /** Neighbor weighting: "uniform" (default) or a "gaussian" kernel on standardized distance. */
  weighting?: "uniform" | "gaussian";
  /**
   * Gaussian kernel bandwidth in standardized-distance units. Default = the median
   * analog distance (a self-scaling Silverman-ish choice). Ignored for "uniform".
   */
  bandwidth?: number;
  /** Per-feature importance multipliers (default all 1), applied AFTER standardization. */
  featureWeights?: number[];
}

export interface AnalogNeighbor {
  id?: string;
  /** Standardized (z-scored), feature-weighted Euclidean distance to the query. */
  distance: number;
  /** Retrieval weight, normalized so the K weights sum to 1. */
  weight: number;
  forwardReturn: number;
}

export interface ForwardDistribution {
  n: number;
  /** (Weighted) mean forward return. */
  mean: number;
  median: number;
  /** (Weighted) standard deviation of forward returns. */
  std: number;
  /** (Weighted) fraction of states with forwardReturn > 0. */
  winRate: number;
  p05: number;
  p25: number;
  p75: number;
  p95: number;
}

export type AnalogConfidence = "informative" | "weak" | "unreliable";

export interface MarketAnalogResult {
  query: number[];
  /** The K retrieved analogs, nearest first. */
  neighbors: AnalogNeighbor[];
  /** Forward-return distribution of the K analogs. */
  analog: ForwardDistribution;
  /** Baseline forward-return distribution over ALL candidates (for contrast). */
  unconditional: ForwardDistribution;
  /** analog.mean − unconditional.mean — the informative shift (the "edge"). */
  edgeShift: number;
  /** Two-sided p-value that the analog mean differs from the NON-analog remainder. null if undefined. */
  pValue: number | null;
  /**
   * Neighbor quality: mean analog distance ÷ median query-to-all distance.
   * < 1 ⇒ analogs are genuinely closer than a typical state (the query sits in a
   * dense, well-populated region of feature space); ≫ 1 ⇒ the query is an outlier
   * and the "analogs" aren't actually similar.
   */
  proximity: number;
  confidence: AnalogConfidence;
  summary: string;
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((s, v) => s + v, 0) / xs.length : 0);

/** Sample standard deviation (Bessel-corrected). */
function sampleStd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, v) => s + (v - m) ** 2, 0) / (xs.length - 1));
}

/** Weighted mean with weights that sum to 1. */
function weightedMean(xs: number[], w: number[]): number {
  let m = 0;
  for (let i = 0; i < xs.length; i++) m += w[i]! * xs[i]!;
  return m;
}

/**
 * Weighted standard deviation (reliability-weight unbiased; reduces exactly to the
 * Bessel-corrected sample std for uniform weights).
 */
function weightedStd(xs: number[], w: number[], wMean: number): number {
  if (xs.length < 2) return 0;
  let sumW2 = 0;
  let acc = 0;
  for (let i = 0; i < xs.length; i++) {
    sumW2 += w[i]! * w[i]!;
    acc += w[i]! * (xs[i]! - wMean) ** 2;
  }
  const denom = 1 - sumW2;
  return denom > 1e-12 ? Math.sqrt(acc / denom) : 0;
}

/**
 * Weighted quantile via the cumulative-midpoint method with linear interpolation.
 * For uniform weights this is a standard interpolated percentile; monotone in p.
 */
function weightedQuantile(pairs: { v: number; w: number }[], p: number): number {
  if (!pairs.length) return 0;
  if (pairs.length === 1) return pairs[0]!.v;
  const sorted = [...pairs].sort((a, b) => a.v - b.v);
  const totalW = sorted.reduce((s, x) => s + x.w, 0);
  if (totalW <= 0) return sorted[Math.floor(sorted.length / 2)]!.v;
  // Cumulative-midpoint position of each point in [0, 1].
  const cum: number[] = [];
  let running = 0;
  for (const x of sorted) {
    cum.push((running + x.w / 2) / totalW);
    running += x.w;
  }
  if (p <= cum[0]!) return sorted[0]!.v;
  if (p >= cum[cum.length - 1]!) return sorted[sorted.length - 1]!.v;
  for (let i = 1; i < cum.length; i++) {
    if (p <= cum[i]!) {
      const t = (p - cum[i - 1]!) / (cum[i]! - cum[i - 1]! || 1);
      return sorted[i - 1]!.v + t * (sorted[i]!.v - sorted[i - 1]!.v);
    }
  }
  return sorted[sorted.length - 1]!.v;
}

function describe(returns: number[], weights?: number[]): ForwardDistribution {
  const n = returns.length;
  if (n === 0) {
    return { n: 0, mean: 0, median: 0, std: 0, winRate: 0, p05: 0, p25: 0, p75: 0, p95: 0 };
  }
  const w = weights ?? returns.map(() => 1 / n);
  const m = weightedMean(returns, w);
  const pairs = returns.map((v, i) => ({ v, w: w[i]! }));
  let winW = 0;
  for (let i = 0; i < n; i++) if (returns[i]! > 0) winW += w[i]!;
  return {
    n,
    mean: m,
    median: weightedQuantile(pairs, 0.5),
    std: weightedStd(returns, w, m),
    winRate: winW,
    p05: weightedQuantile(pairs, 0.05),
    p25: weightedQuantile(pairs, 0.25),
    p75: weightedQuantile(pairs, 0.75),
    p95: weightedQuantile(pairs, 0.95),
  };
}

/** Two-sample Welch t-test p-value for a difference in means. */
function welchPValue(a: number[], b: number[]): number | null {
  if (a.length < 2 || b.length < 2) return null;
  const ma = mean(a);
  const mb = mean(b);
  const va = sampleStd(a) ** 2;
  const vb = sampleStd(b) ** 2;
  const sa = va / a.length;
  const sb = vb / b.length;
  const se = Math.sqrt(sa + sb);
  if (se <= 0) return null;
  const t = (ma - mb) / se;
  const df = (sa + sb) ** 2 / (sa ** 2 / (a.length - 1) + sb ** 2 / (b.length - 1));
  return studentTTwoSidedPValue(t, df);
}

/**
 * Retrieve the K market-analogs of `query` from `candidates` and summarize what
 * followed them. See the module header for the method.
 */
export function retrieveAnalogs(
  query: number[],
  candidates: AnalogState[],
  opts: MarketAnalogOptions = {},
): MarketAnalogResult {
  const dim = query.length;
  const valid = candidates.filter(
    (c) => c.features.length === dim && c.features.every(Number.isFinite) && Number.isFinite(c.forwardReturn),
  );
  if (valid.length === 0 || dim === 0) {
    const empty = describe([]);
    return {
      query,
      neighbors: [],
      analog: empty,
      unconditional: empty,
      edgeShift: 0,
      pValue: null,
      proximity: Infinity,
      confidence: "unreliable",
      summary: "No valid candidates for analog retrieval.",
    };
  }

  // 1. Standardize each feature dimension over the candidate set (z-score). A
  //    constant dimension (std 0) carries no information → contributes 0 distance.
  const means = new Array<number>(dim).fill(0);
  const stds = new Array<number>(dim).fill(0);
  for (let d = 0; d < dim; d++) {
    const col = valid.map((c) => c.features[d]!);
    means[d] = mean(col);
    stds[d] = sampleStd(col);
  }
  const fw = opts.featureWeights ?? new Array<number>(dim).fill(1);
  const z = (vec: number[]): number[] =>
    vec.map((x, d) => (stds[d]! > 1e-12 ? ((x - means[d]!) / stds[d]!) * Math.sqrt(Math.max(fw[d]!, 0)) : 0));
  const qz = z(query);

  // 2. Standardized, feature-weighted Euclidean distance to every candidate.
  const dists = valid.map((c) => {
    const cz = z(c.features);
    let s = 0;
    for (let d = 0; d < dim; d++) s += (qz[d]! - cz[d]!) ** 2;
    return Math.sqrt(s);
  });
  const order = dists.map((dst, i) => ({ i, dst })).sort((a, b) => a.dst - b.dst);

  const k = Math.max(1, Math.min(opts.k ?? 30, valid.length));
  const top = order.slice(0, k);

  // 3. Neighbor weights.
  const rawW = (() => {
    if (opts.weighting === "gaussian") {
      const analogDists = top.map((t) => t.dst);
      const bw = opts.bandwidth ?? Math.max(median(analogDists), 1e-9);
      return top.map((t) => Math.exp(-0.5 * (t.dst / bw) ** 2));
    }
    return top.map(() => 1);
  })();
  const sumW = rawW.reduce((s, v) => s + v, 0) || 1;
  const weights = rawW.map((v) => v / sumW);

  const neighbors: AnalogNeighbor[] = top.map((t, idx) => ({
    id: valid[t.i]!.id,
    distance: t.dst,
    weight: weights[idx]!,
    forwardReturn: valid[t.i]!.forwardReturn,
  }));

  const analogReturns = neighbors.map((nb) => nb.forwardReturn);
  const analog = describe(analogReturns, weights);
  const unconditional = describe(valid.map((c) => c.forwardReturn));

  // Significance: analogs vs the NON-analog remainder (a proper two-sample contrast;
  // the analogs are a subset of the unconditional set, so we test against the rest).
  const analogIdx = new Set(top.map((t) => t.i));
  const rest = valid.filter((_, i) => !analogIdx.has(i)).map((c) => c.forwardReturn);
  const pValue = welchPValue(analogReturns, rest);

  // Neighbor quality: mean analog distance vs the typical (median) query-to-all distance.
  const proximity = median(dists) > 1e-12 ? mean(top.map((t) => t.dst)) / median(dists) : Infinity;

  const edgeShift = analog.mean - unconditional.mean;
  const confidence = gradeConfidence(k, valid.length, proximity, pValue);
  const summary = buildSummary(analog, edgeShift, proximity, pValue, confidence, k);

  return { query, neighbors, analog, unconditional, edgeShift, pValue, proximity, confidence, summary };
}

function median(xs: number[]): number {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/**
 * Confidence gate. Thresholds calibrated on synthetic edges in the test:
 *   - unreliable: too few analogs, too few candidates, OR the query is an outlier
 *     in feature space (analogs not actually close).
 *   - informative: a dense, well-populated neighborhood AND a significant shift.
 *   - weak: everything in between (suggestive, not robust).
 */
function gradeConfidence(
  k: number,
  nCandidates: number,
  proximity: number,
  pValue: number | null,
): AnalogConfidence {
  if (k < 10 || nCandidates < 50 || proximity > 0.85) return "unreliable";
  if (proximity <= 0.6 && pValue != null && pValue < 0.05 && k >= 20) return "informative";
  return "weak";
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2)}%`;
}

function buildSummary(
  analog: ForwardDistribution,
  edgeShift: number,
  proximity: number,
  pValue: number | null,
  confidence: AnalogConfidence,
  k: number,
): string {
  const dir = edgeShift > 0 ? "above" : "below";
  const p = pValue == null ? "n/a" : pValue.toFixed(3);
  return (
    `${k} analogs [${confidence}]: forward median ${pct(analog.median)} ` +
    `(mean ${pct(analog.mean)}, ${dir} baseline by ${pct(Math.abs(edgeShift))}), ` +
    `win-rate ${pct(analog.winRate)}, tails p05 ${pct(analog.p05)} / p95 ${pct(analog.p95)}; ` +
    `proximity ${proximity.toFixed(2)}, p=${p}.`
  );
}
