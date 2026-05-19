/**
 * Effective-N Estimator (GORDON_EFFECTIVE_N).
 *
 * Given a set of signals or their pairwise correlation matrix, compute
 * the effective number of independent signals. Two formulas surfaced:
 *
 *   Participation ratio:  N_eff = (Σ λᵢ)² / Σ λᵢ²
 *     where λᵢ are eigenvalues of the correlation matrix.
 *   Simple approximation: N_eff = N / (1 + (N−1) × ρ̄)
 *     where ρ̄ is the average pairwise absolute correlation.
 *
 * The diagnostic that resolves the deck claim "Gordon's 12-primitive
 * pre-trade chain — but how many are actually independent?" Pure compute,
 * runs on any correlation matrix; takes raw signal series as a convenience.
 *
 * Composes with SC1 signalCombinationEngine (which uses effective-N as
 * the N in IR = IC × √N), WW20 correlationRegimeMonitor (asset-level
 * correlation rather than signal-level), and TM1 confluenceScorer
 * (whose naive confluence count this metric replaces or contextualizes).
 */

export const EFFECTIVE_N_FLAG_ENV = "GORDON_EFFECTIVE_N";

export function isEffectiveNEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[EFFECTIVE_N_FLAG_ENV] === "1" || env[EFFECTIVE_N_FLAG_ENV] === "true";
}

export interface SignalSeries {
  signalId: string;
  values: ReadonlyArray<number>;
}

export interface EffectiveNInput {
  /** Raw signal series. Either this or correlationMatrix is required. */
  signals?: ReadonlyArray<SignalSeries>;
  /** Pre-computed pairwise correlation matrix (symmetric, diagonal = 1). */
  correlationMatrix?: number[][];
  /** Labels for the correlation matrix; defaults to signal_0..N-1 if omitted. */
  labels?: ReadonlyArray<string>;
  /** Absolute correlation threshold above which a pair is flagged redundant. Default 0.7. */
  redundantThreshold?: number;
}

export interface RedundantPair {
  a: string;
  b: string;
  correlation: number;
}

export interface EffectiveNResult {
  rawN: number;
  effectiveN: number;
  participationRatio: number;
  averagePairwiseAbsCorr: number;
  /** Pairs with |r| > redundantThreshold, sorted by absolute correlation descending. */
  redundantPairs: RedundantPair[];
  labels: string[];
  reasoning: string;
}

const DEFAULT_REDUNDANT_THRESHOLD = 0.7;

function pearsonCorrelation(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  let sumA = 0;
  let sumB = 0;
  for (let i = 0; i < n; i++) {
    sumA += a[i]!;
    sumB += b[i]!;
  }
  const meanA = sumA / n;
  const meanB = sumB / n;
  let num = 0;
  let denA = 0;
  let denB = 0;
  for (let i = 0; i < n; i++) {
    const dA = a[i]! - meanA;
    const dB = b[i]! - meanB;
    num += dA * dB;
    denA += dA * dA;
    denB += dB * dB;
  }
  const denom = Math.sqrt(denA * denB);
  if (denom === 0) return 0;
  return num / denom;
}

function buildCorrelationMatrix(signals: ReadonlyArray<SignalSeries>): number[][] {
  const n = signals.length;
  const mat: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    mat[i]![i] = 1;
    for (let j = i + 1; j < n; j++) {
      const r = pearsonCorrelation(signals[i]!.values, signals[j]!.values);
      mat[i]![j] = r;
      mat[j]![i] = r;
    }
  }
  return mat;
}

/**
 * Jacobi eigenvalue algorithm for small symmetric matrices.
 * Returns eigenvalues sorted descending. O(n³) per sweep; converges in
 * a handful of sweeps for n ≤ 50.
 */
function jacobiEigenvalues(matrix: number[][], maxIter = 100, tol = 1e-10): number[] {
  const n = matrix.length;
  const a = matrix.map((row) => [...row]);

  for (let iter = 0; iter < maxIter; iter++) {
    let maxOff = 0;
    let p = 0;
    let q = 1;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const abs = Math.abs(a[i]![j]!);
        if (abs > maxOff) {
          maxOff = abs;
          p = i;
          q = j;
        }
      }
    }
    if (maxOff < tol) break;

    const apq = a[p]![q]!;
    const app = a[p]![p]!;
    const aqq = a[q]![q]!;
    const theta = (aqq - app) / (2 * apq);
    let t: number;
    if (Math.abs(theta) > 1e10) {
      t = 1 / (2 * theta);
    } else {
      const sign = theta >= 0 ? 1 : -1;
      t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
    }
    const c = 1 / Math.sqrt(t * t + 1);
    const s = t * c;

    a[p]![p] = app - t * apq;
    a[q]![q] = aqq + t * apq;
    a[p]![q] = 0;
    a[q]![p] = 0;
    for (let i = 0; i < n; i++) {
      if (i === p || i === q) continue;
      const aip = a[i]![p]!;
      const aiq = a[i]![q]!;
      a[i]![p] = c * aip - s * aiq;
      a[i]![q] = s * aip + c * aiq;
      a[p]![i] = a[i]![p]!;
      a[q]![i] = a[i]![q]!;
    }
  }

  const eigenvalues: number[] = new Array(n);
  for (let i = 0; i < n; i++) eigenvalues[i] = a[i]![i]!;
  return eigenvalues.sort((x, y) => y - x);
}

export function computeEffectiveN(input: EffectiveNInput): EffectiveNResult {
  let matrix: number[][];
  let labels: string[];

  if (input.correlationMatrix && input.correlationMatrix.length > 0) {
    matrix = input.correlationMatrix.map((row) => [...row]);
    labels = input.labels
      ? [...input.labels]
      : matrix.map((_, i) => `signal_${i}`);
  } else if (input.signals && input.signals.length > 0) {
    matrix = buildCorrelationMatrix(input.signals);
    labels = input.signals.map((s) => s.signalId);
  } else {
    return {
      rawN: 0,
      effectiveN: 0,
      participationRatio: 0,
      averagePairwiseAbsCorr: 0,
      redundantPairs: [],
      labels: [],
      reasoning: "No signals or correlation matrix provided",
    };
  }

  const n = matrix.length;
  if (n === 1) {
    return {
      rawN: 1,
      effectiveN: 1,
      participationRatio: 1,
      averagePairwiseAbsCorr: 0,
      redundantPairs: [],
      labels,
      reasoning: "Single signal — trivially independent",
    };
  }

  const eigenvalues = jacobiEigenvalues(matrix);
  const sumLambda = eigenvalues.reduce((s, l) => s + l, 0);
  const sumLambdaSq = eigenvalues.reduce((s, l) => s + l * l, 0);
  const participationRatio = sumLambdaSq > 0 ? (sumLambda * sumLambda) / sumLambdaSq : 0;

  const threshold = input.redundantThreshold ?? DEFAULT_REDUNDANT_THRESHOLD;
  const redundant: RedundantPair[] = [];
  let absCorrSum = 0;
  let pairCount = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = matrix[i]![j]!;
      absCorrSum += Math.abs(r);
      pairCount++;
      if (Math.abs(r) > threshold) {
        redundant.push({ a: labels[i]!, b: labels[j]!, correlation: r });
      }
    }
  }
  const avgAbsCorr = pairCount > 0 ? absCorrSum / pairCount : 0;
  redundant.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  let reasoning: string;
  const ratio = participationRatio / n;
  if (ratio > 0.85) {
    reasoning = `${n} signals, ${participationRatio.toFixed(2)} effective — chain is well-diversified`;
  } else if (ratio > 0.5) {
    reasoning = `${n} signals, ${participationRatio.toFixed(2)} effective — moderate redundancy (avg |r|=${avgAbsCorr.toFixed(2)})`;
  } else {
    reasoning = `${n} signals, ${participationRatio.toFixed(2)} effective — high redundancy (${redundant.length} pairs exceed |r|>${threshold})`;
  }

  return {
    rawN: n,
    effectiveN: participationRatio,
    participationRatio,
    averagePairwiseAbsCorr: avgAbsCorr,
    redundantPairs: redundant,
    labels,
    reasoning,
  };
}

/**
 * Simpler approximation when only the average pairwise correlation is
 * known. Returns N / (1 + (N-1) × ρ̄).
 */
export function simpleEffectiveN(n: number, avgAbsCorr: number): number {
  if (n <= 0) return 0;
  if (n === 1) return 1;
  const denom = 1 + (n - 1) * avgAbsCorr;
  return denom > 0 ? n / denom : 0;
}

export function effectiveNToPayload(result: EffectiveNResult): Record<string, unknown> {
  return {
    kind: "effective_n.computed",
    rawN: result.rawN,
    effectiveN: Number(result.effectiveN.toFixed(3)),
    averagePairwiseAbsCorr: Number(result.averagePairwiseAbsCorr.toFixed(3)),
    redundantPairCount: result.redundantPairs.length,
  };
}
