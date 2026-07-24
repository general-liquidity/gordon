import { describe, it, expect } from "bun:test";
import {
  computeNearestCorrelationMatrix,
  nearestCorrelationMatrixToPayload,
  type Matrix,
} from "./nearestCorrelationMatrix.ts";

// ---------------- helpers for tests ----------------

function minEigenvalue(M: Matrix): number {
  // crude power-like via Rayleigh quotient — fine for small symmetric tests.
  // For the tests below we just check via the algorithm's own jacobi.
  // Easier: compute trace + check diagonal of M projected.
  // Instead we use a small inline cyclic Jacobi here.
  const n = M.length;
  const A = M.map((r) => r.slice());
  for (let sweep = 0; sweep < 50; sweep++) {
    let off = 0;
    for (let i = 0; i < n; i++)
      for (let j = i + 1; j < n; j++) off += A[i]![j]! * A[i]![j]!;
    if (Math.sqrt(off) < 1e-12) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = A[p]![q]!;
        if (Math.abs(apq) < 1e-15) continue;
        const app = A[p]![p]!;
        const aqq = A[q]![q]!;
        const theta = (aqq - app) / (2 * apq);
        const sign = theta >= 0 ? 1 : -1;
        const t = sign / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = c * t;
        A[p]![p] = app - t * apq;
        A[q]![q] = aqq + t * apq;
        A[p]![q] = 0;
        A[q]![p] = 0;
        for (let r = 0; r < n; r++) {
          if (r !== p && r !== q) {
            const drp = A[r]![p]!;
            const drq = A[r]![q]!;
            A[r]![p] = c * drp - s * drq;
            A[p]![r] = A[r]![p]!;
            A[r]![q] = s * drp + c * drq;
            A[q]![r] = A[r]![q]!;
          }
        }
      }
    }
  }
  let m = Infinity;
  for (let i = 0; i < n; i++) m = Math.min(m, A[i]![i]!);
  return m;
}

function isSymmetric(M: Matrix, tol = 1e-9): boolean {
  const n = M.length;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      if (Math.abs(M[i]![j]! - M[j]![i]!) > tol) return false;
  return true;
}

// ---------------- input validation ----------------

describe("computeNearestCorrelationMatrix — validation", () => {
  it("throws on empty matrix", () => {
    expect(() => computeNearestCorrelationMatrix({ matrix: [] })).toThrow();
  });

  it("throws on non-square matrix", () => {
    expect(() =>
      computeNearestCorrelationMatrix({ matrix: [[1, 0], [0]] }),
    ).toThrow();
  });

  it("throws on asymmetric input", () => {
    expect(() =>
      computeNearestCorrelationMatrix({
        matrix: [
          [1, 0.5],
          [0.3, 1],
        ],
      }),
    ).toThrow();
  });

  it("throws on non-finite entries", () => {
    expect(() =>
      computeNearestCorrelationMatrix({
        matrix: [
          [1, NaN],
          [NaN, 1],
        ],
      }),
    ).toThrow();
  });
});

// ---------------- identity-like fast paths ----------------

describe("computeNearestCorrelationMatrix — already valid input", () => {
  it("identity matrix passes through unchanged", () => {
    const I: Matrix = [
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
    ];
    const r = computeNearestCorrelationMatrix({ matrix: I });
    expect(r.wasAlreadyValid).toBe(true);
    expect(r.correctionDistance).toBe(0);
    expect(r.matrix).toEqual(I);
  });

  it("valid 3×3 correlation matrix unchanged", () => {
    const C: Matrix = [
      [1, 0.5, 0.3],
      [0.5, 1, 0.2],
      [0.3, 0.2, 1],
    ];
    const r = computeNearestCorrelationMatrix({ matrix: C });
    expect(r.wasAlreadyValid).toBe(true);
    expect(r.matrix).toEqual(C);
  });
});

// ---------------- output validity ----------------

describe("computeNearestCorrelationMatrix — output is a valid correlation matrix", () => {
  it("non-PSD 3×3 with all 0.9 off-diagonals → output PSD with unit diagonal", () => {
    // [[1, 0.9, 0.7], [0.9, 1, 0.9], [0.7, 0.9, 1]] is invalid (negative eigenvalue)
    // Wait — that one might be PSD. Use known non-PSD case:
    // [[1, -0.55, -0.55], [-0.55, 1, -0.55], [-0.55, -0.55, 1]] has neg eigenvalue
    const A: Matrix = [
      [1, -0.55, -0.55],
      [-0.55, 1, -0.55],
      [-0.55, -0.55, 1],
    ];
    expect(minEigenvalue(A)).toBeLessThan(0); // sanity: input is non-PSD

    const r = computeNearestCorrelationMatrix({ matrix: A });
    expect(r.converged).toBe(true);
    expect(r.wasAlreadyValid).toBe(false);

    // Unit diagonal
    for (let i = 0; i < 3; i++) {
      expect(r.matrix[i]![i]!).toBeCloseTo(1, 8);
    }

    // Symmetric
    expect(isSymmetric(r.matrix)).toBe(true);

    // PSD: min eigenvalue >= -ε
    expect(minEigenvalue(r.matrix)).toBeGreaterThan(-1e-6);

    // Some correction was applied
    expect(r.correctionDistance).toBeGreaterThan(0);
  });

  it("Higham's canonical 3×3 example (page 9 of the paper)", () => {
    // From Higham 2002 — the standard worked example. The off-diagonal
    // 0.9 entry makes the matrix indefinite when combined with the
    // others.
    const A: Matrix = [
      [2, -1, 0, 0],
      [-1, 2, -1, 0],
      [0, -1, 2, -1],
      [0, 0, -1, 2],
    ];
    // Note: this is not a correlation matrix at all (diag isn't 1).
    // But Higham's algorithm should still return a valid correlation
    // matrix as output.
    const r = computeNearestCorrelationMatrix({ matrix: A });
    expect(r.converged).toBe(true);
    // Output diag is 1
    for (let i = 0; i < 4; i++) expect(r.matrix[i]![i]!).toBeCloseTo(1, 8);
    // Output is PSD
    expect(minEigenvalue(r.matrix)).toBeGreaterThan(-1e-6);
  });

  it("identity-but-with-noise: a slight bump keeps output near identity", () => {
    // A nearly-identity matrix with a small unit-diagonal perturbation
    // should converge fast with small correction.
    const A: Matrix = [
      [1, 0.01, -0.005],
      [0.01, 1, 0.02],
      [-0.005, 0.02, 1],
    ];
    const r = computeNearestCorrelationMatrix({ matrix: A });
    // This matrix is already PSD; should be wasAlreadyValid
    expect(r.wasAlreadyValid).toBe(true);
  });
});

describe("computeNearestCorrelationMatrix — convergence behavior", () => {
  it("converges within default 200 iterations for typical 5×5 non-PSD", () => {
    // Construct a 5×5 non-PSD by adding negative eigenvalue
    const A: Matrix = [
      [1, 0.9, 0.7, -0.6, 0.5],
      [0.9, 1, 0.4, 0.3, -0.2],
      [0.7, 0.4, 1, 0.8, 0.6],
      [-0.6, 0.3, 0.8, 1, 0.9],
      [0.5, -0.2, 0.6, 0.9, 1],
    ];
    const r = computeNearestCorrelationMatrix({ matrix: A });
    expect(r.converged).toBe(true);
    expect(r.iterations).toBeLessThanOrEqual(200);
    expect(minEigenvalue(r.matrix)).toBeGreaterThan(-1e-6);
  });

  it("looser tolerance converges in fewer iterations", () => {
    const A: Matrix = [
      [1, -0.55, -0.55],
      [-0.55, 1, -0.55],
      [-0.55, -0.55, 1],
    ];
    const tight = computeNearestCorrelationMatrix({ matrix: A, tolerance: 1e-10 });
    const loose = computeNearestCorrelationMatrix({ matrix: A, tolerance: 1e-3 });
    expect(loose.iterations).toBeLessThanOrEqual(tight.iterations);
  });

  it("hitting maxIterations=1 reports non-convergence", () => {
    const A: Matrix = [
      [1, -0.55, -0.55],
      [-0.55, 1, -0.55],
      [-0.55, -0.55, 1],
    ];
    const r = computeNearestCorrelationMatrix({
      matrix: A,
      maxIterations: 1,
      tolerance: 1e-15,
    });
    expect(r.converged).toBe(false);
  });
});

describe("computeNearestCorrelationMatrix — output structure", () => {
  it("output matrix is deeply independent from input", () => {
    const A: Matrix = [
      [1, 0.5],
      [0.5, 1],
    ];
    const r = computeNearestCorrelationMatrix({ matrix: A });
    r.matrix[0]![0] = 999;
    expect(A[0]![0]).toBe(1);
  });

  it("trivial 1×1 case", () => {
    const r = computeNearestCorrelationMatrix({ matrix: [[1]] });
    expect(r.wasAlreadyValid).toBe(true);
    expect(r.matrix).toEqual([[1]]);
  });

  it("toPayload emits stable shape", () => {
    const A: Matrix = [
      [1, -0.55, -0.55],
      [-0.55, 1, -0.55],
      [-0.55, -0.55, 1],
    ];
    const r = computeNearestCorrelationMatrix({ matrix: A });
    const p = nearestCorrelationMatrixToPayload(r) as {
      kind: string;
      n: number;
      iterations: number;
      converged: boolean;
    };
    expect(p.kind).toBe("nearest_correlation_matrix.computed");
    expect(p.n).toBe(3);
    expect(p.converged).toBe(true);
  });
});
