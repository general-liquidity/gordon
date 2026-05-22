/**
 * Small matrix utilities for the portfolio optimizer + related
 * diagnostic primitives. Dependency-free; targets matrices of size
 * 2..50 (typical strategy-portfolio scale). For larger problems a
 * proper linear-algebra library would be appropriate.
 *
 * Covariance matrices are symmetric positive-definite; Gauss-Jordan
 * with partial pivoting is fine at this scale. Singular matrices
 * return null so callers can fall back to shrinkage.
 */

export function transpose(m: number[][]): number[][] {
  if (m.length === 0) return [];
  const rows = m.length;
  const cols = m[0]!.length;
  const result: number[][] = [];
  for (let i = 0; i < cols; i++) {
    const row: number[] = [];
    for (let j = 0; j < rows; j++) row.push(m[j]![i]!);
    result.push(row);
  }
  return result;
}

export function multiply(a: number[][], b: number[][]): number[][] {
  const ar = a.length;
  const ac = a[0]?.length ?? 0;
  const br = b.length;
  const bc = b[0]?.length ?? 0;
  if (ac !== br) {
    throw new Error(`Matrix multiply: incompatible shapes ${ar}×${ac} and ${br}×${bc}`);
  }
  const result: number[][] = [];
  for (let i = 0; i < ar; i++) {
    const row: number[] = [];
    for (let j = 0; j < bc; j++) {
      let sum = 0;
      for (let k = 0; k < ac; k++) sum += a[i]![k]! * b[k]![j]!;
      row.push(sum);
    }
    result.push(row);
  }
  return result;
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
 * Invert a square matrix via Gauss-Jordan elimination with partial
 * pivoting. Returns null when the matrix is singular (within an
 * epsilon tolerance) — callers should regularize and retry.
 */
export function invert(m: number[][]): number[][] | null {
  const n = m.length;
  if (n === 0) return [];
  // Build augmented [m | I]
  const aug: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) row.push(m[i]![j]!);
    for (let j = 0; j < n; j++) row.push(i === j ? 1 : 0);
    aug.push(row);
  }

  for (let i = 0; i < n; i++) {
    // Find pivot row (largest |value| in column i, rows i..n-1)
    let pivotRow = i;
    let pivotAbs = Math.abs(aug[i]![i]!);
    for (let k = i + 1; k < n; k++) {
      const val = Math.abs(aug[k]![i]!);
      if (val > pivotAbs) {
        pivotAbs = val;
        pivotRow = k;
      }
    }
    if (pivotAbs < 1e-12) return null; // singular
    if (pivotRow !== i) {
      const tmp = aug[i]!;
      aug[i] = aug[pivotRow]!;
      aug[pivotRow] = tmp;
    }

    // Normalize pivot row
    const pivot = aug[i]![i]!;
    for (let j = 0; j < 2 * n; j++) aug[i]![j] = aug[i]![j]! / pivot;

    // Eliminate other rows
    for (let k = 0; k < n; k++) {
      if (k === i) continue;
      const factor = aug[k]![i]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) {
        aug[k]![j] = aug[k]![j]! - factor * aug[i]![j]!;
      }
    }
  }

  const inverse: number[][] = [];
  for (let i = 0; i < n; i++) inverse.push(aug[i]!.slice(n));
  return inverse;
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
 * Compute the sample covariance matrix from per-series return arrays.
 * `returns[i]` is the time series of returns for strategy i. All
 * series must be equal length.
 *
 * Returns null when length mismatch, insufficient samples (<2), or
 * any non-finite value.
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

  const means: number[] = [];
  for (const series of returns) {
    let sum = 0;
    for (const v of series) sum += v;
    means.push(sum / T);
  }

  const cov: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = [];
    for (let j = 0; j < n; j++) {
      let sum = 0;
      for (let t = 0; t < T; t++) {
        sum += (returns[i]![t]! - means[i]!) * (returns[j]![t]! - means[j]!);
      }
      row.push(sum / (T - 1));
    }
    cov.push(row);
  }
  return cov;
}
