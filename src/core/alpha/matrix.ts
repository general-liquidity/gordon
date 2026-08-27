/**
 * Small matrix utilities for the portfolio optimizer + related
 * diagnostic primitives. Backed by `ml-matrix` (LU/inverse, eigen,
 * SVD, Cholesky); targets matrices of size 2..50 (typical
 * strategy-portfolio scale).
 *
 * Covariance matrices are symmetric positive-definite. Singular
 * matrices return null so callers can fall back to shrinkage — that
 * null contract is preserved on top of ml-matrix (which would
 * otherwise yield Inf/NaN), via an LU singularity check before the
 * inverse.
 *
 * Every exported function keeps its array-in / array-out shape: the
 * `ml-matrix` objects never leak across the boundary, so the
 * portfolio-optimizer / pc-method / HRP / quant consumers are
 * unchanged.
 */

import {
  Matrix,
  inverse as mlInverse,
  LuDecomposition,
  EigenvalueDecomposition,
  SingularValueDecomposition,
  CholeskyDecomposition,
} from "ml-matrix";

export function transpose(m: number[][]): number[][] {
  if (m.length === 0) return [];
  return new Matrix(m).transpose().to2DArray();
}

export function multiply(a: number[][], b: number[][]): number[][] {
  const ar = a.length;
  const ac = a[0]?.length ?? 0;
  const br = b.length;
  const bc = b[0]?.length ?? 0;
  if (ac !== br) {
    throw new Error(`Matrix multiply: incompatible shapes ${ar}×${ac} and ${br}×${bc}`);
  }
  return new Matrix(a).mmul(new Matrix(b)).to2DArray();
}

export function multiplyVector(m: number[][], v: number[]): number[] {
  const result: number[] = [];
  for (const row of m) {
    let sum = 0;
    for (let j = 0; j < v.length; j++) sum += row[j]! * v[j]!;
    result.push(sum);
  }
  return result;
}

export function dot(a: number[], b: number[]): number {
  let sum = 0;
  for (let i = 0; i < a.length; i++) sum += a[i]! * b[i]!;
  return sum;
}

/**
 * Invert a square matrix. Returns null when the matrix is singular —
 * callers should regularize and retry. Singularity is detected with an
 * LU decomposition (ml-matrix); this preserves the prior Gauss-Jordan
 * `null`-on-singular contract that `inverse()` alone would not.
 */
export function invert(m: number[][]): number[][] | null {
  const n = m.length;
  if (n === 0) return [];
  const M = new Matrix(m);
  if (new LuDecomposition(M).isSingular()) return null;
  return mlInverse(M).to2DArray();
}

/**
 * Shrinkage toward the diagonal (Ledoit-Wolf style, simplified).
 * Σ_shrunk = (1 - α) × Σ + α × diag(Σ). Reduces estimation noise on
 * off-diagonal entries; α=0 leaves Σ unchanged, α=1 zeroes
 * off-diagonals entirely.
 */
export function shrinkToDiagonal(m: number[][], alpha: number): number[][] {
  const n = m.length;
  const a = Math.max(0, Math.min(1, alpha));
  const result: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      if (i === j) row.push(m[i]![j]!);
      else row.push((1 - a) * m[i]![j]!);
    }
    result.push(row);
  }
  return result;
}

/**
 * Ledoit-Wolf (2004) optimal-intensity shrinkage toward a scaled identity.
 * Input rows are asset return series and columns are observations.
 */
export function ledoitWolfCovariance(
  returns: number[][],
): { covariance: number[][]; intensity: number } | null {
  const sample = computeCovarianceMatrix(returns);
  if (!sample || sample.length === 0) return sample ? { covariance: [], intensity: 0 } : null;
  const n = returns.length;
  const t = returns[0]!.length;
  const mu = sample.reduce((sum, row, i) => sum + row[i]!, 0) / n;
  const target = sample.map((row, i) => row.map((_, j) => (i === j ? mu : 0)));
  const centered = returns.map((series) => {
    const mean = series.reduce((sum, value) => sum + value, 0) / t;
    return series.map((value) => value - mean);
  });
  let phi = 0;
  for (let k = 0; k < t; k++) {
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        const outer = centered[i]![k]! * centered[j]![k]!;
        phi += (outer - sample[i]![j]!) ** 2;
      }
    }
  }
  phi /= t;
  let gamma = 0;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) gamma += (sample[i]![j]! - target[i]![j]!) ** 2;
  }
  const intensity = gamma <= Number.EPSILON ? 0 : Math.max(0, Math.min(1, phi / (t * gamma)));
  return {
    intensity,
    covariance: sample.map((row, i) =>
      row.map((value, j) => (1 - intensity) * value + intensity * target[i]![j]!),
    ),
  };
}

/**
 * Compute the sample covariance matrix from per-series return arrays.
 * `returns[i]` is the time series of returns for strategy i. All
 * series must be equal length.
 *
 * Returns null when length mismatch, insufficient samples (<2), or
 * any non-finite value. Centering + Xᵀ·X via ml-matrix; Bessel
 * correction (T-1) preserved.
 */
export function computeCovarianceMatrix(returns: number[][]): number[][] | null {
  const n = returns.length;
  if (n === 0) return [];
  const T = returns[0]!.length;
  if (T < 2) return null;
  for (const series of returns) {
    if (series.length !== T) return null;
    for (const v of series) if (!Number.isFinite(v)) return null;
  }

  // Rows = series, columns = observations. Center each row on its mean,
  // then Σ = (X_c · X_cᵀ) / (T - 1).
  const X = new Matrix(returns);
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let t = 0; t < T; t++) sum += X.get(i, t);
    const mean = sum / T;
    for (let t = 0; t < T; t++) X.set(i, t, X.get(i, t) - mean);
  }
  return X.mmul(X.transpose())
    .div(T - 1)
    .to2DArray();
}

/**
 * Eigenvalue decomposition of a symmetric matrix (covariance /
 * correlation). Returns real eigenvalues and the corresponding
 * eigenvectors as columns of `eigenvectors`. Symmetric matrices have
 * real spectra; the imaginary parts are dropped. Returns null on empty
 * input.
 */
export function eigenDecomposition(
  m: number[][],
): { eigenvalues: number[]; eigenvectors: number[][] } | null {
  if (m.length === 0) return null;
  const evd = new EigenvalueDecomposition(new Matrix(m), { assumeSymmetric: true });
  return {
    eigenvalues: evd.realEigenvalues,
    eigenvectors: evd.eigenvectorMatrix.to2DArray(),
  };
}

/**
 * Singular value decomposition: M = U · diag(S) · Vᵀ. Returns the
 * singular values plus the left (U) and right (V) singular-vector
 * matrices. Returns null on empty input.
 */
export function singularValueDecomposition(
  m: number[][],
): { u: number[][]; s: number[]; v: number[][] } | null {
  if (m.length === 0) return null;
  const svd = new SingularValueDecomposition(new Matrix(m), { autoTranspose: true });
  return {
    u: svd.leftSingularVectors.to2DArray(),
    s: svd.diagonal,
    v: svd.rightSingularVectors.to2DArray(),
  };
}

/**
 * Cholesky factor L of a symmetric positive-definite matrix, where
 * M = L · Lᵀ. Returns null on empty input or when M is not positive
 * definite (the contract callers can use to fall back to shrinkage).
 */
export function choleskyDecomposition(m: number[][]): number[][] | null {
  if (m.length === 0) return null;
  try {
    const cho = new CholeskyDecomposition(new Matrix(m));
    if (!cho.isPositiveDefinite()) return null;
    return cho.lowerTriangularMatrix.to2DArray();
  } catch {
    return null;
  }
}
