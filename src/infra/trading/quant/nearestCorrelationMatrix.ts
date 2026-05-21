/**
 * Nearest Correlation Matrix — Higham (2002) (GORDON_NEAREST_CORRELATION_MATRIX).
 *
 * Port of Higham, N.J. (2002), "Computing the nearest correlation matrix
 * — a problem from finance", IMA Journal of Numerical Analysis 22(3),
 * 329-343.
 *
 * Problem: given a symmetric matrix A (typically an estimated correlation
 * matrix that is non-PSD due to short samples, missing data, manual
 * overrides, or numerical noise), find the nearest correlation matrix X
 * in the Frobenius norm. A correlation matrix is symmetric PSD with unit
 * diagonal — three constraints that are individually easy to satisfy but
 * jointly require a projection.
 *
 * Algorithm: modified alternating projections with Dykstra's correction.
 *
 *   U = { symmetric matrices with unit diagonal }
 *   K = { symmetric positive-semidefinite matrices }
 *
 *   X_0 = A;  ΔS_0 = 0
 *   for k = 0, 1, 2, ...:
 *     R_k     = X_k − ΔS_k                (Dykstra-corrected anchor)
 *     X_{k+½} = π_K(R_k)                   (project onto PSD by truncating
 *                                           negative eigenvalues to 0)
 *     ΔS_{k+1} = X_{k+½} − R_k             (PSD-side Dykstra correction)
 *     X_{k+1} = π_U(X_{k+½})              (project onto unit diagonal by
 *                                           setting diag to 1)
 *     stop when ‖X_{k+1} − X_k‖_F is below tolerance.
 *
 * Convergence: guaranteed by Dykstra (1983) for the intersection of two
 * closed convex sets in a Hilbert space; rate is geometric for the
 * Frobenius norm. In practice 20-50 iterations suffice for 3% tolerance.
 *
 * Why this matters in finance:
 *   - Sample correlation matrices from short windows are often non-PSD;
 *     downstream optimizers (mean-variance, eigen-decomposition, Cholesky
 *     factorization for Monte Carlo) break or produce noise without a
 *     PSD input.
 *   - Manual overrides (analyst-supplied views, stressed scenarios) that
 *     don't preserve PSD must be re-projected before use.
 *   - Composes with Gordon's existing PCA/eigenPortfolio surface — those
 *     primitives assume PSD inputs.
 *
 * Implementation notes:
 *   - Eigendecomposition via cyclic Jacobi rotations (no external libs).
 *     For n ≤ 30 the convergence is fast; for n > 50 a more sophisticated
 *     symmetric-eigensolver would be preferable but is out of scope here.
 *   - Default tolerance 1e-7 in Frobenius norm.
 *   - Default max iterations 200.
 *   - Returns a Result that carries the corrected matrix, iteration
 *     count, final residual, and a flag indicating whether the algorithm
 *     hit max iterations without converging.
 *
 * Pure compute. No I/O. Deterministic.
 */

export const NEAREST_CORRELATION_MATRIX_FLAG_ENV = "GORDON_NEAREST_CORRELATION_MATRIX";

export function isNearestCorrelationMatrixEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return (
    env[NEAREST_CORRELATION_MATRIX_FLAG_ENV] === "1" ||
    env[NEAREST_CORRELATION_MATRIX_FLAG_ENV] === "true"
  );
}

export type Matrix = number[][];

export interface NearestCorrelationInput {
  /** Symmetric n×n matrix. Need not be PSD or have unit diagonal. */
  matrix: Matrix;
  /** Convergence tolerance in Frobenius norm. Default 1e-7. */
  tolerance?: number;
  /** Maximum iterations. Default 200. */
  maxIterations?: number;
  /** Tolerance for the inner Jacobi eigensolver. Default 1e-10. */
  jacobiTolerance?: number;
}

export interface NearestCorrelationResult {
  /** Nearest correlation matrix (PSD, symmetric, unit diagonal). */
  matrix: Matrix;
  /** Number of outer iterations performed. */
  iterations: number;
  /** Final Frobenius-norm change between successive iterates. */
  finalResidual: number;
  /** True if the algorithm converged within `maxIterations`. */
  converged: boolean;
  /** Frobenius distance ‖input − output‖_F — the "correction magnitude". */
  correctionDistance: number;
  /** Whether the input was already a valid correlation matrix (no correction needed). */
  wasAlreadyValid: boolean;
  reasoning: string;
}

// ------------------------------- helpers --------------------------------

function cloneMatrix(M: Matrix): Matrix {
  return M.map((row) => row.slice());
}

function zeros(n: number): Matrix {
  return Array.from({ length: n }, () => new Array<number>(n).fill(0));
}

function identity(n: number): Matrix {
  const m = zeros(n);
  for (let i = 0; i < n; i++) m[i]![i] = 1;
  return m;
}

function frobeniusNorm(M: Matrix): number {
  let s = 0;
  for (const row of M) for (const v of row) s += v * v;
  return Math.sqrt(s);
}

function frobeniusDiff(A: Matrix, B: Matrix): number {
  let s = 0;
  const n = A.length;
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const d = A[i]![j]! - B[i]![j]!;
      s += d * d;
    }
  }
  return Math.sqrt(s);
}

function isSymmetric(M: Matrix, tol: number): boolean {
  const n = M.length;
  for (let i = 0; i < n; i++) {
    if (M[i]!.length !== n) return false;
    for (let j = i + 1; j < n; j++) {
      if (Math.abs(M[i]![j]! - M[j]![i]!) > tol) return false;
    }
  }
  return true;
}

function symmetrize(M: Matrix): Matrix {
  const n = M.length;
  const S = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      S[i]![j] = 0.5 * (M[i]![j]! + M[j]![i]!);
    }
  }
  return S;
}

// ------------------------- Jacobi eigendecomposition --------------------

/**
 * Cyclic Jacobi method for symmetric eigendecomposition.
 *   A = V · diag(λ) · V^T
 * Returns eigenvalues + eigenvector matrix V (columns are eigenvectors).
 */
function jacobiEigendecomposition(
  A: Matrix,
  tolerance: number,
  maxSweeps = 100,
): { eigenvalues: number[]; eigenvectors: Matrix } {
  const n = A.length;
  const D = cloneMatrix(A);
  const V = identity(n);

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Off-diagonal sum of squares
    let off = 0;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        off += D[i]![j]! * D[i]![j]!;
      }
    }
    if (Math.sqrt(off) < tolerance) break;

    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = D[p]![q]!;
        if (Math.abs(apq) < tolerance * 1e-3) continue;

        const app = D[p]![p]!;
        const aqq = D[q]![q]!;
        const theta = (aqq - app) / (2 * apq);
        let t: number;
        if (Math.abs(theta) > 1e15) {
          t = 0.5 / theta;
        } else {
          const sign = theta >= 0 ? 1 : -1;
          t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        }
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;

        // Update D[p][p], D[q][q], D[p][q]
        D[p]![p] = app - t * apq;
        D[q]![q] = aqq + t * apq;
        D[p]![q] = 0;
        D[q]![p] = 0;

        // Update other rows/cols
        for (let r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            const drp = D[r]![p]!;
            const drq = D[r]![q]!;
            D[r]![p] = c * drp - s * drq;
            D[p]![r] = D[r]![p]!;
            D[r]![q] = s * drp + c * drq;
            D[q]![r] = D[r]![q]!;
          }
        }

        // Accumulate eigenvectors
        for (let r = 0; r < n; r++) {
          const vrp = V[r]![p]!;
          const vrq = V[r]![q]!;
          V[r]![p] = c * vrp - s * vrq;
          V[r]![q] = s * vrp + c * vrq;
        }
      }
    }
  }

  const eigenvalues = new Array<number>(n);
  for (let i = 0; i < n; i++) eigenvalues[i] = D[i]![i]!;
  return { eigenvalues, eigenvectors: V };
}

/**
 * Project a symmetric matrix onto the PSD cone by truncating negative
 * eigenvalues. Reconstruct: V · diag(max(λ, 0)) · V^T.
 */
function projectPSD(M: Matrix, jacobiTol: number): Matrix {
  const n = M.length;
  const { eigenvalues, eigenvectors: V } = jacobiEigendecomposition(M, jacobiTol);
  const truncated = eigenvalues.map((l) => Math.max(l, 0));

  // V · D · V^T
  const result = zeros(n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = 0;
      for (let k = 0; k < n; k++) {
        sum += V[i]![k]! * truncated[k]! * V[j]![k]!;
      }
      result[i]![j] = sum;
      result[j]![i] = sum;
    }
  }
  return result;
}

/** Set diagonal entries to 1 in-place; off-diagonals untouched. */
function projectUnitDiagonal(M: Matrix): Matrix {
  const n = M.length;
  const out = cloneMatrix(M);
  for (let i = 0; i < n; i++) out[i]![i] = 1;
  return out;
}

/** Check unit diagonal + bounded |off-diagonal| ≤ 1 + ε + minimum eigenvalue ≥ −ε. */
function isValidCorrelationMatrix(M: Matrix, tol: number, jacobiTol: number): boolean {
  const n = M.length;
  for (let i = 0; i < n; i++) {
    if (Math.abs(M[i]![i]! - 1) > tol) return false;
    for (let j = 0; j < n; j++) {
      if (Math.abs(M[i]![j]!) > 1 + tol) return false;
    }
  }
  const { eigenvalues } = jacobiEigendecomposition(M, jacobiTol);
  for (const l of eigenvalues) if (l < -tol) return false;
  return true;
}

// ------------------------------ main API --------------------------------

export function computeNearestCorrelationMatrix(
  input: NearestCorrelationInput,
): NearestCorrelationResult {
  const tol = input.tolerance ?? 1e-7;
  const maxIter = input.maxIterations ?? 200;
  const jacobiTol = input.jacobiTolerance ?? 1e-10;

  if (tol <= 0) throw new Error("tolerance must be positive");
  if (maxIter <= 0) throw new Error("maxIterations must be positive");

  const n = input.matrix.length;
  if (n === 0) throw new Error("matrix is empty");
  for (const row of input.matrix) {
    if (row.length !== n) throw new Error("matrix must be square");
    for (const v of row) {
      if (!Number.isFinite(v)) throw new Error("matrix has non-finite entries");
    }
  }
  if (!isSymmetric(input.matrix, 1e-9)) {
    throw new Error("matrix must be symmetric (within 1e-9)");
  }

  // Fast path: already a valid correlation matrix
  if (isValidCorrelationMatrix(input.matrix, 1e-9, jacobiTol)) {
    return {
      matrix: cloneMatrix(input.matrix),
      iterations: 0,
      finalResidual: 0,
      converged: true,
      correctionDistance: 0,
      wasAlreadyValid: true,
      reasoning: `n=${n}; input was already a valid correlation matrix; no correction applied`,
    };
  }

  let Y = symmetrize(input.matrix);
  let dS = zeros(n);
  let residual = Infinity;
  let iter = 0;
  let converged = false;

  for (iter = 0; iter < maxIter; iter++) {
    const R = zeros(n);
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        R[i]![j] = Y[i]![j]! - dS[i]![j]!;
      }
    }

    const X = projectPSD(R, jacobiTol);

    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        dS[i]![j] = X[i]![j]! - R[i]![j]!;
      }
    }

    const YNew = projectUnitDiagonal(X);
    residual = frobeniusDiff(YNew, Y);
    Y = YNew;

    if (residual < tol) {
      converged = true;
      break;
    }
  }

  // Final symmetry guard (eigendecomp + diag projection can accumulate roundoff)
  Y = symmetrize(Y);
  for (let i = 0; i < n; i++) Y[i]![i] = 1;

  const correctionDistance = frobeniusDiff(input.matrix, Y);

  const reasoning =
    `n=${n}; iters=${iter + (converged ? 1 : 0)}; ` +
    `residual=${residual.toExponential(2)}; ` +
    `correction ‖A−X‖_F=${correctionDistance.toFixed(4)}; ` +
    `converged=${converged}`;

  return {
    matrix: Y,
    iterations: iter + (converged ? 1 : 0),
    finalResidual: residual,
    converged,
    correctionDistance,
    wasAlreadyValid: false,
    reasoning,
  };
}

export function nearestCorrelationMatrixToPayload(
  result: NearestCorrelationResult,
): Record<string, unknown> {
  return {
    kind: "nearest_correlation_matrix.computed",
    n: result.matrix.length,
    iterations: result.iterations,
    converged: result.converged,
    wasAlreadyValid: result.wasAlreadyValid,
    correctionDistance: Number(result.correctionDistance.toFixed(6)),
    finalResidual: Number.isFinite(result.finalResidual)
      ? Number(result.finalResidual.toExponential(3))
      : null,
  };
}
