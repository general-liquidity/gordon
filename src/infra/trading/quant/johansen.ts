/**
 * Johansen Cointegration Test — symmetric upgrade to Engle-Granger.
 *
 * Engle-Granger (cointegration.ts) regresses one series on the other and is
 * sensitive to which is the regressand: P1~P2 and P2~P1 can disagree. Johansen
 * treats both series symmetrically via a reduced-rank VAR (the standard fix).
 *
 * This implements the bivariate (n=2) trace test, k_ar_diff=1, with a constant.
 * Procedure (reduced-rank regression):
 *   1. ΔY_t, lagged level Y_{t-1}, lagged difference ΔY_{t-1}, aligned.
 *   2. Partial ΔY_{t-1} and the constant out of both ΔY_t (→R0) and Y_{t-1} (→R1)
 *      by OLS, per column.
 *   3. S00, S11, S01 product-moment matrices of the residuals.
 *   4. Eigenvalues λ of M = S11⁻¹ S01ᵀ S00⁻¹ S01.
 *   5. Trace statistic per rank from the λ's; compare to MacKinnon-Haug-Michelis
 *      critical values for n=2 with a constant.
 *
 * All matrices are 2×2 — explicit helpers, no linalg dependency.
 */

// ============================================================================
// Types
// ============================================================================

export interface JohansenResult {
  /** Exactly one cointegrating vector: reject r=0 AND fail to reject r≤1. */
  cointegrated: boolean;
  /** Trace statistic for the null r=0 (both eigenvalues). */
  traceStat0: number;
  /** Trace statistic for the null r≤1 (smallest eigenvalue only). */
  traceStat1: number;
  /** Trace critical values for r=0, n=2, with constant. */
  criticalValues0: { pct90: number; pct95: number; pct99: number };
  /** Trace critical values for r≤1, n=2, with constant. */
  criticalValues1: { pct90: number; pct95: number; pct99: number };
  /** Eigenvalues, sorted descending, clamped to (0,1). */
  eigenvalues: number[];
  /** Cointegrating vector (largest-eigenvalue eigenvector), first component = 1. */
  cointegratingVector: [number, number];
  /** Hedge ratio β so that spread = p1 − β·p2 is stationary. */
  hedgeRatio: number;
}

// MacKinnon-Haug-Michelis (1999) trace critical values, n=2, constant term.
// r=0 tests rank 0 vs ≥1 (2 d.o.f.), r≤1 tests rank ≤1 vs 2 (1 d.o.f.).
const CV_R0 = { pct90: 13.4294, pct95: 15.4943, pct99: 19.9349 };
const CV_R1 = { pct90: 2.7055, pct95: 3.8415, pct99: 6.6349 };

const MIN_OBS = 30;

type Mat2 = [[number, number], [number, number]];

function degenerate(): JohansenResult {
  return {
    cointegrated: false,
    traceStat0: NaN,
    traceStat1: NaN,
    criticalValues0: { ...CV_R0 },
    criticalValues1: { ...CV_R1 },
    eigenvalues: [0, 0],
    cointegratingVector: [1, 0],
    hedgeRatio: 0,
  };
}

// ============================================================================
// 2×2 matrix helpers
// ============================================================================

function det2(m: Mat2): number {
  return m[0][0] * m[1][1] - m[0][1] * m[1][0];
}

function inv2(m: Mat2): Mat2 | null {
  const d = det2(m);
  if (!isFinite(d) || Math.abs(d) < 1e-15) return null;
  return [
    [m[1][1] / d, -m[0][1] / d],
    [-m[1][0] / d, m[0][0] / d],
  ];
}

function matmul2(a: Mat2, b: Mat2): Mat2 {
  return [
    [a[0][0] * b[0][0] + a[0][1] * b[1][0], a[0][0] * b[0][1] + a[0][1] * b[1][1]],
    [a[1][0] * b[0][0] + a[1][1] * b[1][0], a[1][0] * b[0][1] + a[1][1] * b[1][1]],
  ];
}

function transpose2(m: Mat2): Mat2 {
  return [
    [m[0][0], m[1][0]],
    [m[0][1], m[1][1]],
  ];
}

/**
 * Eigenvalues of a general 2×2 matrix via the characteristic quadratic
 * λ² − tr·λ + det = 0. Returned sorted descending. M = S11⁻¹S01ᵀS00⁻¹S01 is a
 * similarity transform of a symmetric PSD matrix, so its eigenvalues are real.
 */
function eigenvalues2(m: Mat2): [number, number] {
  const tr = m[0][0] + m[1][1];
  const dt = det2(m);
  const disc = Math.max(0, tr * tr - 4 * dt);
  const root = Math.sqrt(disc);
  const l1 = (tr + root) / 2;
  const l2 = (tr - root) / 2;
  return l1 >= l2 ? [l1, l2] : [l2, l1];
}

/**
 * Eigenvector of a general 2×2 matrix for a given eigenvalue. From
 * (M − λI)v = 0: the row [a−λ, b] gives v = [−b, a−λ] (or fall back to the
 * other row when the first is near-zero). Not normalized to unit length.
 */
function eigenvector2(m: Mat2, lambda: number): [number, number] {
  const a = m[0][0] - lambda;
  const b = m[0][1];
  const c = m[1][0];
  const d = m[1][1] - lambda;

  if (Math.abs(b) > 1e-12 || Math.abs(a) > 1e-12) {
    return [-b, a];
  }
  if (Math.abs(c) > 1e-12 || Math.abs(d) > 1e-12) {
    return [d, -c];
  }
  return [1, 0];
}

// ============================================================================
// OLS partialling-out (residualize Y against design columns)
// ============================================================================

/**
 * Regress each column of `targets` on `design` (columns include the constant)
 * by OLS and return the residual columns. Solves (XᵀX)β = Xᵀy via Gaussian
 * elimination on the small normal-equations system.
 */
function residualize(targets: number[][], design: number[][]): number[][] {
  const T = targets[0]!.length;
  const k = design.length;

  // Normal equations XᵀX (k×k) and Xᵀy per target column.
  const xtx: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
  for (let i = 0; i < k; i++) {
    for (let j = i; j < k; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += design[i]![t]! * design[j]![t]!;
      xtx[i]![j] = s;
      xtx[j]![i] = s;
    }
  }

  const residualCols: number[][] = [];
  for (const y of targets) {
    const xty = new Array(k).fill(0);
    for (let i = 0; i < k; i++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += design[i]![t]! * y[t]!;
      xty[i] = s;
    }
    const beta = solveLinear(xtx, xty);
    const resid = new Array(T);
    for (let t = 0; t < T; t++) {
      let fit = 0;
      for (let i = 0; i < k; i++) fit += beta[i]! * design[i]![t]!;
      resid[t] = y[t]! - fit;
    }
    residualCols.push(resid);
  }
  return residualCols;
}

/** Gaussian elimination with partial pivoting for a small dense system. */
function solveLinear(A: number[][], b: number[]): number[] {
  const k = b.length;
  const M = A.map((row, i) => [...row, b[i]!]);

  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(M[r]![col]!) > Math.abs(M[pivot]![col]!)) pivot = r;
    }
    if (Math.abs(M[pivot]![col]!) < 1e-15) continue;
    [M[col], M[pivot]] = [M[pivot]!, M[col]!];

    const pivVal = M[col]![col]!;
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const factor = M[r]![col]! / pivVal;
      for (let c = col; c <= k; c++) M[r]![c]! -= factor * M[col]![c]!;
    }
  }

  const x = new Array(k).fill(0);
  for (let i = 0; i < k; i++) {
    const piv = M[i]![i]!;
    x[i] = Math.abs(piv) < 1e-15 ? 0 : M[i]![k]! / piv;
  }
  return x;
}

/** Product-moment matrix AᵀB / T for two 2-column residual sets. */
function crossMoment(colsA: number[][], colsB: number[][], T: number): Mat2 {
  const m: Mat2 = [
    [0, 0],
    [0, 0],
  ];
  for (let i = 0; i < 2; i++) {
    for (let j = 0; j < 2; j++) {
      let s = 0;
      for (let t = 0; t < T; t++) s += colsA[i]![t]! * colsB[j]![t]!;
      m[i]![j] = s / T;
    }
  }
  return m;
}

// ============================================================================
// Main: Johansen trace test
// ============================================================================

export function johansenTest(p1: number[], p2: number[]): JohansenResult {
  const n = Math.min(p1.length, p2.length);
  if (n < MIN_OBS) return degenerate();

  const a = p1.slice(-n);
  const b = p2.slice(-n);

  // ΔY_t and Y_{t-1} aligned, with ΔY_{t-1} as the short-run regressor.
  // Differences index 1..n-1; dropping one more lag for ΔY_{t-1} leaves t=2..n-1.
  const T = n - 2;
  if (T < MIN_OBS - 2) return degenerate();

  const dy0: number[] = []; // ΔY_t  (asset 1)
  const dy1: number[] = []; // ΔY_t  (asset 2)
  const lev0: number[] = []; // Y_{t-1} (asset 1)
  const lev1: number[] = []; // Y_{t-1} (asset 2)
  const ldy0: number[] = []; // ΔY_{t-1} (asset 1)
  const ldy1: number[] = []; // ΔY_{t-1} (asset 2)

  for (let t = 2; t < n; t++) {
    dy0.push(a[t]! - a[t - 1]!);
    dy1.push(b[t]! - b[t - 1]!);
    lev0.push(a[t - 1]!);
    lev1.push(b[t - 1]!);
    ldy0.push(a[t - 1]! - a[t - 2]!);
    ldy1.push(b[t - 1]! - b[t - 2]!);
  }

  const constCol = new Array(T).fill(1);
  const design = [ldy0, ldy1, constCol];

  const R0 = residualize([dy0, dy1], design);
  const R1 = residualize([lev0, lev1], design);

  const S00 = crossMoment(R0, R0, T);
  const S11 = crossMoment(R1, R1, T);
  const S01 = crossMoment(R0, R1, T);

  const S00inv = inv2(S00);
  const S11inv = inv2(S11);
  if (!S00inv || !S11inv) return degenerate();

  // M = S11⁻¹ · S01ᵀ · S00⁻¹ · S01 ; eigenvalues are the squared canonical
  // correlations between R0 and R1.
  const S01t = transpose2(S01);
  const M = matmul2(S11inv, matmul2(S01t, matmul2(S00inv, S01)));

  let [lam1, lam2] = eigenvalues2(M);
  const clamp = (x: number) => Math.min(1 - 1e-12, Math.max(1e-12, x));
  lam1 = clamp(lam1);
  lam2 = clamp(lam2);

  const traceStat0 = -T * (Math.log(1 - lam1) + Math.log(1 - lam2));
  const traceStat1 = -T * Math.log(1 - lam2);

  const cointegrated = traceStat0 > CV_R0.pct95 && traceStat1 <= CV_R1.pct95;

  // Eigenvector for the largest eigenvalue → cointegrating relation. Normalize
  // first component to 1; β makes spread = p1 − β·p2 stationary.
  const evRaw = eigenvector2(M, lam1);
  const first = evRaw[0];
  const vec: [number, number] =
    Math.abs(first) > 1e-12 ? [1, evRaw[1] / first] : [evRaw[0], evRaw[1]];
  const hedgeRatio = Math.abs(vec[0]) > 1e-12 ? -(vec[1] / vec[0]) : 0;

  return {
    cointegrated,
    traceStat0,
    traceStat1,
    criticalValues0: { ...CV_R0 },
    criticalValues1: { ...CV_R1 },
    eigenvalues: [lam1, lam2],
    cointegratingVector: vec,
    hedgeRatio,
  };
}

/**
 * Format a Johansen result for display, mirroring formatCointegrationResult.
 */
export function formatJohansenResult(r: JohansenResult, symbolX: string, symbolY: string): string {
  const lines: string[] = [];
  lines.push(`Johansen Cointegration: ${symbolX} / ${symbolY}`);
  lines.push(`  Cointegrated: ${r.cointegrated ? "YES (1 cointegrating vector, 95%)" : "NO"}`);
  lines.push(
    `  Trace r=0: ${r.traceStat0.toFixed(3)} (95% CV: ${r.criticalValues0.pct95}) ${r.traceStat0 > r.criticalValues0.pct95 ? "→ reject" : "→ fail to reject"}`,
  );
  lines.push(
    `  Trace r≤1: ${r.traceStat1.toFixed(3)} (95% CV: ${r.criticalValues1.pct95}) ${r.traceStat1 > r.criticalValues1.pct95 ? "→ reject" : "→ fail to reject"}`,
  );
  lines.push(`  Eigenvalues: ${r.eigenvalues.map((e) => e.toFixed(4)).join(", ")}`);
  lines.push(`  Hedge Ratio: ${r.hedgeRatio.toFixed(4)} (spread = ${symbolX} − β·${symbolY})`);
  return lines.join("\n");
}
