/**
 * Box-Tiao canonical decomposition hedge ratio.
 *
 * Finds the linear combination of N price-level series that is MOST
 * mean-reverting (most predictable from its own past). Box & Tiao's
 * canonical decomposition fits a VAR(1) to the price levels,
 *
 *     P_t = c + A · P_{t-1} + e_t,
 *
 * forms the one-step predictions P̂_t = c + A · P_{t-1}, and then
 * solves the generalized eigenproblem
 *
 *     Cov(P̂) w = λ Cov(P) w.
 *
 * The eigenvector with the SMALLEST eigenvalue carries the least
 * predictable-variance fraction → it is the most stationary /
 * mean-reverting portfolio. We obtain that eigenvector via inverse
 * power iteration on M = Cov(P)^{-1} · Cov(P̂): repeatedly applying
 * M^{-1} amplifies the component along the smallest-eigenvalue
 * eigenvector, so the iteration converges to it. Weights are
 * normalized so the first = 1.
 */

import {
  transpose,
  multiply,
  multiplyVector,
  invert,
  computeCovarianceMatrix,
} from "../../../core/alpha/matrix.ts";

export interface BoxTiaoResult {
  symbols: string[];
  weights: number[];
  predictability: number;
  halfLife: number | null;
  sampleSize: number;
  interpretation: string;
}

function neutral(symbols: string[], sampleSize: number, why: string): BoxTiaoResult {
  return {
    symbols,
    weights: symbols.map(() => 0),
    predictability: 1,
    halfLife: null,
    sampleSize,
    interpretation: `Neutral — ${why}.`,
  };
}

function round6(x: number): number {
  return Number(x.toFixed(6));
}

/**
 * OLS estimate of the VAR(1) coefficient matrix A and intercept c.
 * Regresses each target column Y[:,j] = P_t[:,j] on Z = [1, P_{t-1}].
 * Returns predicted levels P̂ aligned with the Y rows.
 */
function fitVarPredictions(levels: number[][]): number[][] | null {
  const T = levels.length;
  const N = levels[0]!.length;

  // Y = P_t (rows 1..T-1), Z = [1, P_{t-1}] (rows 0..T-2).
  const Y: number[][] = [];
  const Z: number[][] = [];
  for (let t = 1; t < T; t++) {
    Y.push(levels[t]!.slice());
    Z.push([1, ...levels[t - 1]!]);
  }

  const Zt = transpose(Z); // (N+1) × (T-1)
  const ZtZ = multiply(Zt, Z); // (N+1) × (N+1)
  const ZtZinv = invert(ZtZ);
  if (ZtZinv == null) return null;

  const ZtY = multiply(Zt, Y); // (N+1) × N
  const B = multiply(ZtZinv, ZtY); // (N+1) × N : B = (Z'Z)^{-1} Z'Y

  // Predicted levels P̂ = Z · B (rows of P̂ correspond to Y rows).
  const predicted = multiply(Z, B);
  if (predicted.length === 0 || predicted[0]!.length !== N) return null;
  return predicted;
}

/** Cov over a (rows = time, cols = asset) level matrix. */
function covOfColumns(rowsByTime: number[][]): number[][] | null {
  const seriesByAsset = transpose(rowsByTime); // asset-as-row for computeCovarianceMatrix
  return computeCovarianceMatrix(seriesByAsset);
}

function normalizeVec(v: number[]): number[] {
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm);
  if (norm < 1e-300) return v.slice();
  return v.map((x) => x / norm);
}

/**
 * Inverse power iteration on M to recover the smallest-eigenvalue
 * eigenvector. Iterate w ← normalize(M^{-1} w); converges to the
 * dominant eigenvector of M^{-1}, i.e. the smallest-eigenvalue
 * eigenvector of M. Returns the eigenvector and its Rayleigh-quotient
 * eigenvalue w'Mw / w'w.
 */
function smallestEigenvector(M: number[][]): { vector: number[]; eigenvalue: number } | null {
  const Minv = invert(M);
  if (Minv == null) return null;
  const n = M.length;

  let w: number[] = new Array<number>(n).fill(0).map((_, i) => (i === 0 ? 1 : 0.5));
  w = normalizeVec(w);

  for (let iter = 0; iter < 200; iter++) {
    const next = normalizeVec(multiplyVector(Minv, w));
    let diff = 0;
    for (let i = 0; i < n; i++) diff += Math.abs(Math.abs(next[i]!) - Math.abs(w[i]!));
    w = next;
    if (diff < 1e-12) break;
  }

  // Rayleigh quotient λ = w'Mw / w'w (w is unit norm).
  const Mw = multiplyVector(M, w);
  let num = 0;
  for (let i = 0; i < n; i++) num += w[i]! * Mw[i]!;
  return { vector: w, eigenvalue: num };
}

/** Half-life from an AR(1) fit of the spread: spread_t = α + β·spread_{t-1}. */
function spreadHalfLife(spread: number[]): number | null {
  const n = spread.length - 1;
  if (n < 2) return null;
  let meanX = 0;
  let meanY = 0;
  for (let t = 1; t < spread.length; t++) {
    meanX += spread[t - 1]!;
    meanY += spread[t]!;
  }
  meanX /= n;
  meanY /= n;

  let sxx = 0;
  let sxy = 0;
  for (let t = 1; t < spread.length; t++) {
    const dx = spread[t - 1]! - meanX;
    sxx += dx * dx;
    sxy += dx * (spread[t]! - meanY);
  }
  if (sxx < 1e-300) return null;
  const beta = sxy / sxx;
  if (!(beta > 0 && beta < 1)) return null;
  const hl = -Math.LN2 / Math.log(beta);
  return Number.isFinite(hl) && hl > 0 ? hl : null;
}

export function computeBoxTiaoHedgeRatio(input: {
  pricesBySymbol: Record<string, ReadonlyArray<number>>;
}): BoxTiaoResult {
  const symbols = Object.keys(input.pricesBySymbol);

  if (symbols.length < 2) {
    return neutral(symbols, 0, "need at least 2 symbols");
  }

  // Align to the shortest series length.
  let minLen = Infinity;
  for (const s of symbols) {
    const len = input.pricesBySymbol[s]!.length;
    if (len < minLen) minLen = len;
  }
  if (!Number.isFinite(minLen) || minLen < 10) {
    return neutral(
      symbols,
      Number.isFinite(minLen) ? minLen : 0,
      "need at least 10 aligned points",
    );
  }

  // Build level matrix: rows = time, cols = asset (last minLen points).
  const levels: number[][] = [];
  for (let t = 0; t < minLen; t++) {
    const row: number[] = [];
    for (const s of symbols) {
      const series = input.pricesBySymbol[s]!;
      const v = series[series.length - minLen + t]!;
      if (!Number.isFinite(v)) {
        return neutral(symbols, minLen, "non-finite price encountered");
      }
      row.push(v);
    }
    levels.push(row);
  }

  const predicted = fitVarPredictions(levels);
  if (predicted == null) {
    return neutral(symbols, minLen, "VAR(1) regression is singular");
  }

  // Cov(P) over the same rows the predictions are aligned with (rows 1..T-1).
  const alignedLevels = levels.slice(1);
  const covP = covOfColumns(alignedLevels);
  const covPhat = covOfColumns(predicted);
  if (covP == null || covPhat == null) {
    return neutral(symbols, minLen, "covariance estimation failed");
  }

  const covPinv = invert(covP);
  if (covPinv == null) {
    return neutral(symbols, minLen, "Cov(P) is singular");
  }

  // M = Cov(P)^{-1} · Cov(P̂).
  const M = multiply(covPinv, covPhat);
  const eig = smallestEigenvector(M);
  if (eig == null) {
    return neutral(symbols, minLen, "eigen-decomposition failed");
  }

  // Normalize weights so the first = 1 (fall back to unit vector if first ≈ 0).
  const raw = eig.vector;
  let weights: number[];
  if (Math.abs(raw[0]!) > 1e-9) {
    weights = raw.map((w) => w / raw[0]!);
  } else {
    weights = raw.slice();
  }

  // Spread = P · w over the full aligned window.
  const spread: number[] = [];
  for (const row of levels) {
    let s = 0;
    for (let i = 0; i < weights.length; i++) s += row[i]! * weights[i]!;
    spread.push(s);
  }

  const halfLife = spreadHalfLife(spread);
  const predictability = eig.eigenvalue;

  const hlText =
    halfLife == null
      ? "no finite mean-reversion half-life"
      : `half-life ≈ ${round6(halfLife)} bars`;
  const interpretation =
    `Box-Tiao most-mean-reverting portfolio over ${symbols.length} symbols. ` +
    `Predictability λ=${round6(predictability)} (smaller = more stationary); ${hlText}.`;

  return {
    symbols,
    weights: weights.map(round6),
    predictability: round6(predictability),
    halfLife: halfLife == null ? null : round6(halfLife),
    sampleSize: minLen,
    interpretation,
  };
}
