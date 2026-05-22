/**
 * Strategy portfolio optimizer — Markowitz mean-variance optimization
 * over a set of strategy return series.
 *
 * Tier 2 build closing the "portfolio of low-correlated strategies"
 * thread. Composes with `effective-n.ts` + `marginal-contribution.ts`
 * + `ic-tracker.ts` to give the operator a complete portfolio
 * construction surface:
 *
 *   1. ic-tracker — is each candidate signal worth running?
 *   2. effective-n — are my existing signals diversifiable?
 *   3. marginal-contribution — does THIS candidate add to my portfolio?
 *   4. portfolio-optimizer — given my final set, what weights minimize
 *      variance OR maximize Sharpe?
 *
 * Three objectives:
 *
 *   - min_variance:   minimize portfolio variance (no return target).
 *                     Closed form: w = Σ⁻¹ × 1 / (1ᵀ × Σ⁻¹ × 1)
 *   - max_sharpe:     maximize (μ_p - r_f) / σ_p.
 *                     Closed form: w ∝ Σ⁻¹ × (μ - r_f × 1)
 *   - target_return:  minimize variance subject to E[r_p] = target.
 *                     Solved via Lagrangian with the two-constraint
 *                     system (sum-to-one + target return).
 *
 * Constraints:
 *   - long-only (default): negative weights projected to 0, problem
 *     re-solved on the active set, iterated until consistent
 *   - max-weight cap (default 1.0): individual weights capped after
 *     long-only projection
 *
 * Shrinkage: optional Ledoit-Wolf-style regularization toward the
 * diagonal — reduces estimation noise on off-diagonal covariance
 * entries (a known problem when N strategies × T observations gives
 * a barely-invertible Σ̂).
 *
 * The optimizer falls back to equal-weight when:
 *   - Σ̂ is singular even after shrinkage (perfect collinearity)
 *   - long-only iteration doesn't converge in iterationCap iterations
 *
 * Equal-weight is the disciplined fallback rather than throwing —
 * portfolio optimization that crashes silently is worse than one that
 * returns a reasonable answer with a `converged=false` flag.
 */

import {
  computeCovarianceMatrix,
  invert,
  multiplyVector,
  dot,
  shrinkToDiagonal,
} from "./matrix.ts";
import { computeEffectiveN } from "./effective-n.ts";

export type OptimizationObjective = "min_variance" | "max_sharpe" | "target_return";

export interface PortfolioOptimizerInput {
  /** Strategy returns by id. All series must be equal length. */
  strategyReturns: Record<string, number[]>;
  /** Optimization objective. Default min_variance. */
  objective?: OptimizationObjective;
  /** Required when objective === "target_return". */
  targetReturn?: number;
  /** Risk-free rate per period (e.g. daily) for Sharpe. Default 0. */
  riskFreeRate?: number;
  /** Constrain weights to ≥ 0 (no shorts). Default true. */
  longOnly?: boolean;
  /** Per-strategy max weight cap. Default 1.0. */
  maxWeight?: number;
  /**
   * Ledoit-Wolf-style shrinkage toward the diagonal (0..1). Default 0.0.
   * Useful when N is close to T and the sample covariance is unstable.
   */
  shrinkage?: number;
  /** Cap on long-only-projection iterations. Default 20. */
  iterationCap?: number;
}

export interface OptimalPortfolio {
  /** Weight per strategy id. Sums to 1. */
  weights: Record<string, number>;
  /** Expected portfolio return per period (μ_p = w ⋅ μ). */
  expectedReturn: number;
  /** Expected portfolio variance per period (σ²_p = wᵀΣw). */
  expectedVariance: number;
  /** Expected portfolio standard deviation. */
  expectedStdev: number;
  /** Sharpe ratio = (μ_p - r_f) / σ_p. NaN-safe (returns 0 when σ_p = 0). */
  expectedSharpe: number;
  /** Effective N of the final weighted portfolio. */
  effectiveN: number;
  diagnostics: {
    objective: OptimizationObjective;
    nStrategies: number;
    sampleSize: number;
    shrinkageApplied: number;
    /** True when optimizer converged (didn't fall back to equal-weight). */
    converged: boolean;
    /** Long-only projection iterations used (0 when not needed). */
    iterations: number;
    /** Fallback reason when converged=false. */
    fallbackReason: string | null;
    /** Strategies dropped during long-only projection (weight forced to 0). */
    droppedStrategies: string[];
  };
  summary: string;
}

const DEFAULTS = {
  objective: "min_variance" as OptimizationObjective,
  riskFreeRate: 0,
  longOnly: true,
  maxWeight: 1.0,
  shrinkage: 0.0,
  iterationCap: 20,
};

function computeMeanReturns(returns: number[][]): number[] {
  return returns.map((series) => {
    let sum = 0;
    for (const v of series) sum += v;
    return sum / series.length;
  });
}

function equalWeightVector(n: number): number[] {
  return new Array(n).fill(1 / n);
}

function normalizeWeights(weights: number[]): number[] {
  const sum = weights.reduce((s, w) => s + w, 0);
  if (sum === 0) return equalWeightVector(weights.length);
  return weights.map((w) => w / sum);
}

function applyMaxWeightCap(weights: number[], maxWeight: number): number[] {
  // Cap each weight, redistribute excess equally to uncapped weights.
  // Iterates because redistribution may push another weight over the cap.
  let w = [...weights];
  const cap = Math.max(1 / weights.length, Math.min(1, maxWeight));
  for (let iter = 0; iter < 10; iter++) {
    let excess = 0;
    const capped: boolean[] = [];
    for (let i = 0; i < w.length; i++) {
      if (w[i]! > cap) {
        excess += w[i]! - cap;
        w[i] = cap;
        capped.push(true);
      } else {
        capped.push(false);
      }
    }
    if (excess <= 1e-9) break;
    const uncappedCount = capped.filter((c) => !c).length;
    if (uncappedCount === 0) break;
    const share = excess / uncappedCount;
    for (let i = 0; i < w.length; i++) {
      if (!capped[i]) w[i] = w[i]! + share;
    }
  }
  return normalizeWeights(w);
}

/**
 * Closed-form min-variance weights: w = Σ⁻¹ × 1 / (1ᵀ × Σ⁻¹ × 1)
 */
function minVarianceWeights(cov: number[][]): number[] | null {
  const inv = invert(cov);
  if (inv === null) return null;
  const ones = new Array(cov.length).fill(1);
  const invOnes = multiplyVector(inv, ones);
  const denom = dot(ones, invOnes);
  if (Math.abs(denom) < 1e-12) return null;
  return invOnes.map((v) => v / denom);
}

/**
 * Closed-form max-Sharpe weights (tangency portfolio):
 *   w ∝ Σ⁻¹ × (μ - r_f × 1), normalized to sum=1.
 */
function maxSharpeWeights(cov: number[][], means: number[], riskFreeRate: number): number[] | null {
  const inv = invert(cov);
  if (inv === null) return null;
  const excess = means.map((m) => m - riskFreeRate);
  const raw = multiplyVector(inv, excess);
  const sum = raw.reduce((s, v) => s + v, 0);
  if (Math.abs(sum) < 1e-12) return null;
  return raw.map((v) => v / sum);
}

/**
 * Target-return min-variance via the two-constraint Lagrangian:
 *
 *   w = Σ⁻¹ × ( A × 1 + B × μ )
 *   where A and B solve:
 *     [ 1ᵀΣ⁻¹1  1ᵀΣ⁻¹μ ] [A]   [   1   ]
 *     [ μᵀΣ⁻¹1  μᵀΣ⁻¹μ ] [B] = [ target ]
 */
function targetReturnWeights(
  cov: number[][],
  means: number[],
  target: number,
): number[] | null {
  const inv = invert(cov);
  if (inv === null) return null;
  const ones = new Array(cov.length).fill(1);
  const invOnes = multiplyVector(inv, ones);
  const invMu = multiplyVector(inv, means);
  const a11 = dot(ones, invOnes);
  const a12 = dot(ones, invMu);
  const a21 = dot(means, invOnes);
  const a22 = dot(means, invMu);
  // Solve [[a11, a12], [a21, a22]] × [A, B] = [1, target]
  const det = a11 * a22 - a12 * a21;
  if (Math.abs(det) < 1e-12) return null;
  const A = (a22 * 1 - a12 * target) / det;
  const B = (-a21 * 1 + a11 * target) / det;
  // w = A × Σ⁻¹1 + B × Σ⁻¹μ
  return invOnes.map((v, i) => A * v + B * invMu[i]!);
}

interface SolveResult {
  weights: number[];
  iterations: number;
  dropped: number[]; // indices into the original strategy list
}

/**
 * Solve the objective then iteratively project long-only:
 *   1. Solve over the active set
 *   2. If any weight is negative, drop those strategies and re-solve
 *   3. Repeat until all weights are ≥ 0
 *
 * Falls back to equal-weight when iterations exhaust or solver returns null.
 */
function solveWithLongOnly(
  cov: number[][],
  means: number[],
  objective: OptimizationObjective,
  riskFreeRate: number,
  targetReturn: number | undefined,
  longOnly: boolean,
  iterationCap: number,
): SolveResult | null {
  const n = cov.length;
  let active = new Set<number>();
  for (let i = 0; i < n; i++) active.add(i);
  const dropped: number[] = [];

  let iterations = 0;
  while (iterations < iterationCap) {
    iterations += 1;
    const activeList = [...active].sort((a, b) => a - b);
    const subCov = activeList.map((i) => activeList.map((j) => cov[i]![j]!));
    const subMeans = activeList.map((i) => means[i]!);

    let subWeights: number[] | null;
    if (objective === "min_variance") {
      subWeights = minVarianceWeights(subCov);
    } else if (objective === "max_sharpe") {
      subWeights = maxSharpeWeights(subCov, subMeans, riskFreeRate);
    } else {
      if (targetReturn === undefined) return null;
      subWeights = targetReturnWeights(subCov, subMeans, targetReturn);
    }

    if (subWeights === null) return null;

    if (!longOnly) {
      const fullWeights = new Array(n).fill(0);
      for (let i = 0; i < activeList.length; i++) {
        fullWeights[activeList[i]!] = subWeights[i]!;
      }
      return { weights: fullWeights, iterations, dropped };
    }

    // Find negative weights → drop those indices
    const negativeIndices: number[] = [];
    for (let i = 0; i < activeList.length; i++) {
      if (subWeights[i]! < -1e-9) negativeIndices.push(activeList[i]!);
    }
    if (negativeIndices.length === 0) {
      // All weights non-negative; we're done
      const fullWeights = new Array(n).fill(0);
      for (let i = 0; i < activeList.length; i++) {
        fullWeights[activeList[i]!] = Math.max(0, subWeights[i]!);
      }
      return {
        weights: normalizeWeights(fullWeights),
        iterations,
        dropped,
      };
    }
    for (const idx of negativeIndices) {
      active.delete(idx);
      dropped.push(idx);
    }
    if (active.size === 0) return null;
  }
  return null; // iteration cap exhausted
}

/**
 * Optimize a strategy portfolio. Returns weight vector + portfolio
 * statistics + diagnostics including a `converged` flag so callers
 * know whether the result came from the optimizer or the equal-weight
 * fallback.
 */
export function optimizePortfolio(input: PortfolioOptimizerInput): OptimalPortfolio {
  const objective = input.objective ?? DEFAULTS.objective;
  const riskFreeRate = input.riskFreeRate ?? DEFAULTS.riskFreeRate;
  const longOnly = input.longOnly ?? DEFAULTS.longOnly;
  const maxWeight = input.maxWeight ?? DEFAULTS.maxWeight;
  const shrinkage = input.shrinkage ?? DEFAULTS.shrinkage;
  const iterationCap = input.iterationCap ?? DEFAULTS.iterationCap;

  const ids = Object.keys(input.strategyReturns);
  const n = ids.length;
  const T = n > 0 ? input.strategyReturns[ids[0]!]!.length : 0;

  function buildResult(
    weightsArr: number[],
    cov: number[][] | null,
    means: number[],
    converged: boolean,
    iterations: number,
    fallbackReason: string | null,
    droppedIdx: number[],
  ): OptimalPortfolio {
    const weights: Record<string, number> = {};
    for (let i = 0; i < ids.length; i++) weights[ids[i]!] = weightsArr[i]!;

    const expectedReturn = means.length === n ? dot(weightsArr, means) : 0;
    let expectedVariance = 0;
    if (cov !== null && cov.length === n) {
      const sw = multiplyVector(cov, weightsArr);
      expectedVariance = dot(weightsArr, sw);
    }
    const stdev = Math.sqrt(Math.max(0, expectedVariance));
    const sharpe = stdev === 0 ? 0 : (expectedReturn - riskFreeRate) / stdev;
    const effN = computeEffectiveN(input.strategyReturns).effectiveN;

    const droppedStrategies = droppedIdx.map((i) => ids[i]!);
    const summary =
      `${objective} over ${n} strategies (T=${T})${shrinkage > 0 ? `, shrinkage=${shrinkage.toFixed(2)}` : ""}: ` +
      `μ=${expectedReturn.toFixed(5)}, σ=${stdev.toFixed(5)}, Sharpe=${sharpe.toFixed(3)}, ` +
      `effective N=${effN.toFixed(2)}` +
      (converged ? "" : ` [fallback: ${fallbackReason}]`) +
      (droppedStrategies.length > 0 ? ` [dropped: ${droppedStrategies.join(", ")}]` : "");

    return {
      weights,
      expectedReturn: parseFloat(expectedReturn.toFixed(6)),
      expectedVariance: parseFloat(expectedVariance.toFixed(8)),
      expectedStdev: parseFloat(stdev.toFixed(6)),
      expectedSharpe: parseFloat(sharpe.toFixed(4)),
      effectiveN: parseFloat(effN.toFixed(4)),
      diagnostics: {
        objective,
        nStrategies: n,
        sampleSize: T,
        shrinkageApplied: shrinkage,
        converged,
        iterations,
        fallbackReason,
        droppedStrategies,
      },
      summary,
    };
  }

  // Edge cases
  if (n === 0) {
    return buildResult([], [], [], false, 0, "no strategies supplied", []);
  }
  if (n === 1) {
    const onlyId = ids[0]!;
    const w = [1];
    const means = computeMeanReturns([input.strategyReturns[onlyId]!]);
    return buildResult(w, [[0]], means, true, 0, null, []);
  }
  if (T < 2) {
    return buildResult(equalWeightVector(n), null, [], false, 0, "insufficient samples", []);
  }

  const returnSeries = ids.map((id) => input.strategyReturns[id]!);
  let cov = computeCovarianceMatrix(returnSeries);
  if (cov === null) {
    return buildResult(equalWeightVector(n), null, [], false, 0, "covariance computation failed", []);
  }
  if (shrinkage > 0) cov = shrinkToDiagonal(cov, shrinkage);

  const means = computeMeanReturns(returnSeries);

  const solveResult = solveWithLongOnly(
    cov,
    means,
    objective,
    riskFreeRate,
    input.targetReturn,
    longOnly,
    iterationCap,
  );

  if (solveResult === null) {
    return buildResult(
      equalWeightVector(n),
      cov,
      means,
      false,
      iterationCap,
      "optimizer failed or did not converge",
      [],
    );
  }

  let weights = solveResult.weights;
  if (maxWeight < 1) weights = applyMaxWeightCap(weights, maxWeight);

  return buildResult(weights, cov, means, true, solveResult.iterations, null, solveResult.dropped);
}
