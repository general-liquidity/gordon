/**
 * Effective-N estimator for signal correlation.
 *
 * The Fundamental Law of Active Management says `IR = IC × √N` where
 * N is the count of INDEPENDENT signals. Running 20 correlated signals
 * gives you the diversification benefit of far fewer effective signals.
 *
 * This module computes:
 *
 *   - Pairwise Pearson correlation matrix across signal time series
 *   - Mean pairwise |correlation| (Carhart's input)
 *   - Effective N via Carhart's formula:
 *
 *       N_eff = N / (1 + (N - 1) × ρ̄)
 *
 *     where ρ̄ is the average pairwise |correlation|. ρ̄ = 0 → N_eff = N
 *     (fully independent), ρ̄ = 1 → N_eff = 1 (all signals identical).
 *
 *   - Reduction factor (N_eff / N) — operator-facing "how much
 *     diversification you actually have"
 *   - Top correlated pairs — surfaces which signals are redundant
 *   - Verdict tier
 *
 * Caller passes a map of signal name → equal-length time series. The
 * matrix is computed in the obvious O(K² × T) shape.
 */

import { pearsonCorrelation } from "./helpers.ts";

export interface PairCorrelation {
  a: string;
  b: string;
  rho: number;
  absRho: number;
}

export interface EffectiveNResult {
  /** Raw count of signals submitted. */
  rawN: number;
  /** Effective independent signals after correlation reduction. */
  effectiveN: number;
  /** Mean of absolute pairwise correlations. */
  meanAbsCorrelation: number;
  /** Maximum absolute pairwise correlation. */
  maxAbsCorrelation: number;
  /** Reduction factor: effectiveN / rawN. 1.0 = fully independent. */
  reductionFactor: number;
  /** Top 5 most-correlated pairs by |rho|, descending. */
  topCorrelatedPairs: PairCorrelation[];
  /** All pairs that were computable (excludes pairs with null Pearson). */
  pairs: PairCorrelation[];
  /** Operator-facing verdict. */
  verdict:
    | "diversified"
    | "moderately_correlated"
    | "highly_correlated"
    | "redundant"
    | "insufficient_data";
  /** Human-readable summary. */
  summary: string;
}

export interface EffectiveNOptions {
  /** ρ̄ ≤ this → diversified. Default 0.15. */
  diversifiedThreshold?: number;
  /** ρ̄ ≤ this → moderately correlated. Default 0.35. */
  moderateThreshold?: number;
  /** ρ̄ ≤ this → highly correlated. Default 0.60. */
  highThreshold?: number;
  /** Top-K correlated pairs to surface. Default 5. */
  topK?: number;
}

const DEFAULT_OPTIONS: Required<EffectiveNOptions> = {
  diversifiedThreshold: 0.15,
  moderateThreshold: 0.35,
  highThreshold: 0.6,
  topK: 5,
};

/**
 * Compute effective N for a set of signal time series.
 *
 * Signals MUST be equal-length and pre-aligned by the caller (same
 * time indexing). Pairs where one signal is constant return null from
 * Pearson and are dropped from the pair set + ρ̄ average — they
 * effectively contribute no diversification info either way.
 */
export function computeEffectiveN(
  signals: Record<string, number[]>,
  options: EffectiveNOptions = {},
): EffectiveNResult {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const names = Object.keys(signals);
  const rawN = names.length;

  if (rawN < 2) {
    return {
      rawN,
      effectiveN: rawN,
      meanAbsCorrelation: 0,
      maxAbsCorrelation: 0,
      reductionFactor: 1,
      topCorrelatedPairs: [],
      pairs: [],
      verdict: "insufficient_data",
      summary: `Only ${rawN} signal(s) submitted — effective-N requires ≥ 2`,
    };
  }

  // Validate equal length
  const firstLen = signals[names[0]!]!.length;
  for (const name of names) {
    if (signals[name]!.length !== firstLen) {
      return {
        rawN,
        effectiveN: rawN,
        meanAbsCorrelation: 0,
        maxAbsCorrelation: 0,
        reductionFactor: 1,
        topCorrelatedPairs: [],
        pairs: [],
        verdict: "insufficient_data",
        summary: `Signal '${name}' length ${signals[name]!.length} differs from first signal length ${firstLen}`,
      };
    }
  }

  if (firstLen < 3) {
    return {
      rawN,
      effectiveN: rawN,
      meanAbsCorrelation: 0,
      maxAbsCorrelation: 0,
      reductionFactor: 1,
      topCorrelatedPairs: [],
      pairs: [],
      verdict: "insufficient_data",
      summary: `Signal length ${firstLen} too short for Pearson correlation (need ≥ 3)`,
    };
  }

  const pairs: PairCorrelation[] = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const a = names[i]!;
      const b = names[j]!;
      const rho = pearsonCorrelation(signals[a]!, signals[b]!);
      if (rho === null) continue;
      pairs.push({ a, b, rho, absRho: Math.abs(rho) });
    }
  }

  if (pairs.length === 0) {
    return {
      rawN,
      effectiveN: rawN,
      meanAbsCorrelation: 0,
      maxAbsCorrelation: 0,
      reductionFactor: 1,
      topCorrelatedPairs: [],
      pairs: [],
      verdict: "insufficient_data",
      summary: "No usable signal pairs (constant series or non-finite values)",
    };
  }

  let sumAbs = 0;
  let maxAbs = 0;
  for (const p of pairs) {
    sumAbs += p.absRho;
    if (p.absRho > maxAbs) maxAbs = p.absRho;
  }
  const meanAbs = sumAbs / pairs.length;

  // Carhart's effective-N: clamp ρ̄ to [0, 1] for numerical safety
  const rhoBar = Math.max(0, Math.min(1, meanAbs));
  const effectiveN = rawN / (1 + (rawN - 1) * rhoBar);

  const reductionFactor = effectiveN / rawN;

  const sortedPairs = [...pairs].sort((p, q) => q.absRho - p.absRho);
  const topCorrelatedPairs = sortedPairs.slice(0, opts.topK);

  let verdict: EffectiveNResult["verdict"];
  if (meanAbs <= opts.diversifiedThreshold) verdict = "diversified";
  else if (meanAbs <= opts.moderateThreshold) verdict = "moderately_correlated";
  else if (meanAbs <= opts.highThreshold) verdict = "highly_correlated";
  else verdict = "redundant";

  const summary =
    `${rawN} raw signals → ${effectiveN.toFixed(2)} effective ` +
    `(ρ̄=${meanAbs.toFixed(3)}, max ρ=${maxAbs.toFixed(3)}, ` +
    `${(reductionFactor * 100).toFixed(0)}% retained) → ${verdict}`;

  return {
    rawN,
    effectiveN,
    meanAbsCorrelation: meanAbs,
    maxAbsCorrelation: maxAbs,
    reductionFactor,
    topCorrelatedPairs,
    pairs,
    verdict,
    summary,
  };
}
