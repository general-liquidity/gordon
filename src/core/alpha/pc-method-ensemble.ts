/**
 * Portfolio-Construction Method Ensemble
 * (Ang, Azimbayev & Kim 2026, "The Self-Driving Portfolio", §3.4–3.6)
 *
 * The risk-STRUCTURED half of the Self-Driving Portfolio's PC bench, plus the
 * deliberation machinery that sits above the methods. Gordon already has the
 * return-OPTIMIZED family (`portfolio-optimizer.ts`: mean-variance / min-var /
 * max-Sharpe / target-return) and Black-Litterman (`portfolio/blackLitterman.ts`).
 * This module adds what was missing:
 *
 *   1. Risk-structured PC methods that need only a covariance matrix (no
 *      return forecast): equal-weight, inverse-volatility, inverse-variance,
 *      risk-parity (equal risk contribution), maximum diversification.
 *   2. Modified Borda-count voting over candidate portfolios (top-N ranking +
 *      bottom flag), the paper's aggregation rule for the strategy review.
 *   3. The adversarial diversifier — the portfolio MOST orthogonal to the
 *      ensemble centroid (max tracking variance) subject to a Sharpe floor.
 *      Individually suboptimal by design; valuable at the ensemble stage
 *      (boosting-style: it spans regions no consensus method reaches).
 *   4. A CIO-style ensemble combiner (average / inverse-tracking-error /
 *      trimmed-mean) over the surviving candidates.
 *
 * Everything is covariance-native and pure. Reuses `matrix.ts`. Long-only,
 * sum-to-one weight vectors throughout. This is NOT the 50-agent pipeline —
 * Gordon's agent topology stays at 3 agents; these are the deterministic
 * primitives the methods/voting would call.
 */

import { invert, multiplyVector } from "./matrix.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function equalWeight(n: number): number[] {
  return new Array(n).fill(1 / n);
}

function normalize(w: number[]): number[] {
  const sum = w.reduce((s, x) => s + x, 0);
  if (sum === 0) return equalWeight(w.length);
  return w.map((x) => x / sum);
}

function vols(cov: number[][]): number[] {
  return cov.map((row, i) => Math.sqrt(Math.max(0, row[i]!)));
}

function portfolioVariance(w: number[], cov: number[][]): number {
  const sw = multiplyVector(cov, w);
  let v = 0;
  for (let i = 0; i < w.length; i++) v += w[i]! * sw[i]!;
  return Math.max(0, v);
}

function portfolioReturn(w: number[], means: number[]): number {
  let r = 0;
  for (let i = 0; i < w.length; i++) r += w[i]! * (means[i] ?? 0);
  return r;
}

function sharpe(w: number[], cov: number[][], means: number[], riskFree: number): number {
  const sd = Math.sqrt(portfolioVariance(w, cov));
  if (sd === 0) return 0;
  return (portfolioReturn(w, means) - riskFree) / sd;
}

/** Euclidean projection onto the probability simplex {w ≥ 0, Σw = 1} (Duchi 2008). */
function projectToSimplex(v: number[]): number[] {
  const n = v.length;
  if (n === 0) return [];
  const u = [...v].sort((a, b) => b - a);
  let css = 0;
  let rho = 0;
  let theta = 0;
  for (let i = 0; i < n; i++) {
    css += u[i]!;
    const t = (css - 1) / (i + 1);
    if (u[i]! - t > 0) {
      rho = i + 1;
      theta = t;
    }
  }
  if (rho === 0) return equalWeight(n);
  return v.map((x) => Math.max(0, x - theta));
}

// ---------------------------------------------------------------------------
// Risk-structured PC methods (covariance-native, long-only, sum-to-one)
// ---------------------------------------------------------------------------

export function equalWeightPortfolio(n: number): number[] {
  return equalWeight(n);
}

export function inverseVolatilityPortfolio(cov: number[][]): number[] {
  const s = vols(cov);
  const w = s.map((x) => (x > 0 ? 1 / x : 0));
  return normalize(w);
}

export function inverseVariancePortfolio(cov: number[][]): number[] {
  const w = cov.map((row, i) => (row[i]! > 0 ? 1 / row[i]! : 0));
  return normalize(w);
}

/**
 * Risk parity (equal risk contribution). Iterative multiplicative fixed point:
 * each asset's risk contribution RC_i = w_i·(Σw)_i is driven toward 1/n of
 * total. Starts from inverse-vol; converges for PSD covariance.
 */
export function riskParityPortfolio(
  cov: number[][],
  opts: { maxIter?: number; tol?: number } = {},
): { weights: number[]; converged: boolean; iterations: number } {
  const n = cov.length;
  const maxIter = opts.maxIter ?? 500;
  const tol = opts.tol ?? 1e-8;
  let w = inverseVolatilityPortfolio(cov);

  let iterations = 0;
  let converged = false;
  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const mrc = multiplyVector(cov, w); // marginal risk contributions
    const rc = w.map((wi, i) => wi * mrc[i]!); // risk contributions
    const total = rc.reduce((s, x) => s + x, 0);
    if (total <= 0) break;
    const target = total / n;
    // Dispersion of risk contributions; stop when balanced.
    let disp = 0;
    for (const r of rc) disp += Math.abs(r - target);
    if (disp / total < tol) {
      converged = true;
      break;
    }
    // Multiplicative update: w_i ← w_i · target / RC_i (damped via sqrt).
    const next = w.map((wi, i) => {
      const ri = rc[i]!;
      if (ri <= 0) return wi;
      return wi * Math.sqrt(target / ri);
    });
    w = normalize(next);
  }
  return { weights: w, converged, iterations };
}

/**
 * Maximum diversification (Choueifaty & Coignard 2008): maximize the
 * diversification ratio (wᵀσ)/√(wᵀΣw). Closed form w ∝ Σ⁻¹σ, long-only
 * projected. Falls back to inverse-vol if Σ is singular.
 */
export function maxDiversificationPortfolio(cov: number[][]): number[] {
  const inv = invert(cov);
  if (inv === null) return inverseVolatilityPortfolio(cov);
  const sigma = vols(cov);
  const raw = multiplyVector(inv, sigma);
  // Long-only: clip negatives then renormalize; if all clipped, fall back.
  const clipped = raw.map((x) => Math.max(0, x));
  if (clipped.reduce((s, x) => s + x, 0) <= 0) return inverseVolatilityPortfolio(cov);
  return normalize(clipped);
}

export type PcMethodId =
  | "equal_weight"
  | "inverse_volatility"
  | "inverse_variance"
  | "risk_parity"
  | "max_diversification";

export interface PcMethodProposal {
  method: PcMethodId;
  weights: number[];
}

/** Run the full risk-structured bench over a covariance matrix. */
export function runRiskStructuredBench(cov: number[][]): PcMethodProposal[] {
  const n = cov.length;
  return [
    { method: "equal_weight", weights: equalWeightPortfolio(n) },
    { method: "inverse_volatility", weights: inverseVolatilityPortfolio(cov) },
    { method: "inverse_variance", weights: inverseVariancePortfolio(cov) },
    { method: "risk_parity", weights: riskParityPortfolio(cov).weights },
    { method: "max_diversification", weights: maxDiversificationPortfolio(cov) },
  ];
}

// ---------------------------------------------------------------------------
// Modified Borda-count voting
// ---------------------------------------------------------------------------

export interface BordaBallot {
  /** Voter id (e.g. a peer method). */
  voter: string;
  /** Ordered candidate ids, best first. The first `topN` get points. */
  ranking: string[];
  /** Candidate ids flagged as worst (each gets `bottomPenalty`). */
  bottomFlags?: string[];
}

export interface BordaOptions {
  /** How many top positions score. Default 5. */
  topN?: number;
  /** Penalty applied to each bottom-flagged candidate. Default -2. */
  bottomPenalty?: number;
}

export interface BordaResult {
  /** Candidate id → total Borda points. */
  scores: Record<string, number>;
  /** Candidate ids sorted best → worst. */
  ranking: string[];
}

/**
 * Modified Borda count (the paper's rule): each voter awards topN, topN-1, …, 1
 * to its top-N ranked candidates and `bottomPenalty` to each bottom-flagged
 * candidate. Voters never vote for themselves (caller-enforced by exclusion
 * from the ranking).
 */
export function bordaCount(ballots: BordaBallot[], opts: BordaOptions = {}): BordaResult {
  const topN = opts.topN ?? 5;
  const bottomPenalty = opts.bottomPenalty ?? -2;
  const scores: Record<string, number> = {};
  const ensure = (id: string) => {
    if (!(id in scores)) scores[id] = 0;
  };

  for (const ballot of ballots) {
    for (let i = 0; i < Math.min(topN, ballot.ranking.length); i++) {
      const id = ballot.ranking[i]!;
      ensure(id);
      scores[id]! += topN - i;
    }
    for (const id of ballot.bottomFlags ?? []) {
      ensure(id);
      scores[id]! += bottomPenalty;
    }
  }

  const ranking = Object.keys(scores).sort((a, b) => scores[b]! - scores[a]!);
  return { scores, ranking };
}

// ---------------------------------------------------------------------------
// Adversarial diversifier
// ---------------------------------------------------------------------------

export interface AdversarialDiversifierInput {
  /** The candidate method weight vectors (all length n). */
  candidateWeights: number[][];
  cov: number[][];
  /** Expected returns (length n). Default zeros (Sharpe floor then trivial). */
  means?: number[];
  /** Sharpe floor as a fraction of the best candidate's Sharpe. Default 0.75. */
  sharpeFloorFraction?: number;
  riskFreeRate?: number;
  /** Projected-gradient-ascent iterations. Default 300. */
  iterations?: number;
  /** Step size on the unit-normalized tracking-variance gradient. Default 0.15. */
  step?: number;
}

export interface AdversarialDiversifierResult {
  weights: number[];
  /** Tracking variance vs the ensemble centroid: (w−c)ᵀΣ(w−c). */
  trackingVariance: number;
  sharpe: number;
  sharpeFloor: number;
  /** True if the Sharpe floor was satisfiable. */
  feasible: boolean;
  centroid: number[];
}

/**
 * Construct the portfolio that MAXIMIZES tracking variance vs the ensemble
 * centroid (most orthogonal to consensus) subject to a Sharpe floor. Solved by
 * projected gradient ascent on the (convex, hence maximized at the boundary)
 * tracking-variance objective, with a deterministic blend back toward the
 * best-Sharpe candidate whenever the floor is violated.
 */
export function adversarialDiversifier(
  input: AdversarialDiversifierInput,
): AdversarialDiversifierResult {
  const cov = input.cov;
  const n = cov.length;
  const means = input.means ?? new Array(n).fill(0);
  const riskFree = input.riskFreeRate ?? 0;
  const floorFrac = input.sharpeFloorFraction ?? 0.75;
  const iterations = input.iterations ?? 300;
  const step = input.step ?? 0.15;

  // Ensemble centroid.
  const centroid = new Array(n).fill(0);
  for (const w of input.candidateWeights) {
    for (let i = 0; i < n; i++) centroid[i] += w[i]! / input.candidateWeights.length;
  }

  // Best-Sharpe candidate → defines the floor and the blend target.
  let bestSharpe = -Infinity;
  let bestWeights = equalWeight(n);
  for (const w of input.candidateWeights) {
    const s = sharpe(w, cov, means, riskFree);
    if (s > bestSharpe) {
      bestSharpe = s;
      bestWeights = w;
    }
  }
  const sharpeFloor = floorFrac * Math.max(0, bestSharpe);

  const trackVar = (w: number[]): number => {
    const d = w.map((wi, i) => wi - centroid[i]!);
    return portfolioVariance(d, cov);
  };

  let w = equalWeight(n);
  for (let iter = 0; iter < iterations; iter++) {
    // Gradient of (w−c)ᵀΣ(w−c) is 2Σ(w−c); ascend on the unit direction.
    const d = w.map((wi, i) => wi - centroid[i]!);
    const grad = multiplyVector(cov, d);
    const gnorm = Math.sqrt(grad.reduce((s, x) => s + x * x, 0));
    if (gnorm < 1e-12) break;
    const next = w.map((wi, i) => wi + step * (grad[i]! / gnorm));
    w = projectToSimplex(next);
  }

  // Enforce the Sharpe floor by blending toward the best-Sharpe candidate.
  let feasible = true;
  let s = sharpe(w, cov, means, riskFree);
  if (s < sharpeFloor) {
    feasible = sharpe(bestWeights, cov, means, riskFree) >= sharpeFloor - 1e-9;
    let lambda = 0;
    for (let k = 1; k <= 20; k++) {
      lambda = k / 20;
      const blended = w.map((wi, i) => (1 - lambda) * wi + lambda * bestWeights[i]!);
      if (sharpe(blended, cov, means, riskFree) >= sharpeFloor) {
        w = normalize(blended);
        break;
      }
    }
    s = sharpe(w, cov, means, riskFree);
  }

  return {
    weights: w,
    trackingVariance: parseFloat(trackVar(w).toFixed(10)),
    sharpe: parseFloat(s.toFixed(6)),
    sharpeFloor: parseFloat(sharpeFloor.toFixed(6)),
    feasible,
    centroid,
  };
}

// ---------------------------------------------------------------------------
// CIO-style ensemble combiner
// ---------------------------------------------------------------------------

export type EnsembleScheme = "average" | "inverse_tracking_error" | "trimmed_mean";

export interface EnsembleCombineInput {
  /** Weight vectors of the surviving candidates (all length n). */
  candidateWeights: number[][];
  cov: number[][];
  scheme?: EnsembleScheme;
  /** For trimmed_mean: fraction trimmed from each tail per asset. Default 0.1. */
  trimFraction?: number;
}

export interface EnsembleCombineResult {
  weights: number[];
  scheme: EnsembleScheme;
  summary: string;
}

/**
 * Combine candidate portfolios into a final allocation. `inverse_tracking_error`
 * weights each candidate inversely to its tracking variance vs the centroid
 * (closer-to-consensus methods get more weight); `trimmed_mean` drops the
 * extreme weights per asset; `average` is the plain mean.
 */
export function combineEnsemble(input: EnsembleCombineInput): EnsembleCombineResult {
  const scheme = input.scheme ?? "average";
  const candidates = input.candidateWeights;
  const k = candidates.length;
  const n = input.cov.length;

  if (k === 0) {
    return { weights: equalWeight(n), scheme, summary: "No candidates; equal-weight fallback." };
  }

  let weights: number[];

  if (scheme === "inverse_tracking_error") {
    const centroid = new Array(n).fill(0);
    for (const w of candidates) for (let i = 0; i < n; i++) centroid[i] += w[i]! / k;
    const teInv = candidates.map((w) => {
      const d = w.map((wi, i) => wi - centroid[i]!);
      const tv = portfolioVariance(d, input.cov);
      return 1 / (tv + 1e-9);
    });
    const teSum = teInv.reduce((s, x) => s + x, 0);
    weights = new Array(n).fill(0);
    for (let c = 0; c < k; c++) {
      const mw = teInv[c]! / teSum;
      for (let i = 0; i < n; i++) weights[i] = weights[i]! + mw * candidates[c]![i]!;
    }
  } else if (scheme === "trimmed_mean") {
    const trim = input.trimFraction ?? 0.1;
    const dropEach = Math.floor(trim * k);
    weights = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const col = candidates.map((w) => w[i]!).sort((a, b) => a - b);
      const kept = col.slice(dropEach, k - dropEach);
      const arr = kept.length > 0 ? kept : col;
      weights[i] = arr.reduce((s, x) => s + x, 0) / arr.length;
    }
    weights = normalize(weights);
  } else {
    weights = new Array(n).fill(0);
    for (const w of candidates) for (let i = 0; i < n; i++) weights[i] = weights[i]! + w[i]! / k;
  }

  weights = normalize(weights);
  return {
    weights,
    scheme,
    summary: `Combined ${k} candidate portfolio(s) over ${n} assets via ${scheme}.`,
  };
}
