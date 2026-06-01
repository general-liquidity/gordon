/**
 * Johansen cointegration test (trace statistic).
 *
 * Where Engle-Granger (cointegration.ts) tests a single pair via a two-step
 * residual ADF, Johansen tests a *system* of k series simultaneously and
 * estimates the cointegration RANK r — the number of independent stationary
 * linear combinations (long-run equilibrium relationships) among them.
 *
 *   - r = 0:        no cointegration (all series independently I(1)).
 *   - 1 ≤ r < k:    r cointegrating relationships → mean-reverting baskets.
 *   - r = k:        the system is already stationary (each series I(0)).
 *
 * Method (reduced-rank regression / VECM, no deterministic trend in the
 * cointegrating space — the "constant in the short-run / no trend" / case 2
 * setup; we run the standard centred residual version):
 *
 *   1. ΔY_t = Π Y_{t-1} + Σ Γ_i ΔY_{t-i} + ε_t      (VECM, lag p in levels)
 *   2. Regress ΔY_t on the lagged differences → residuals R0.
 *      Regress Y_{t-1} on the lagged differences → residuals R1.
 *      (When p ≤ 1 there are no lagged-difference regressors, so we centre
 *      by subtracting the column means, which is the constant-only case.)
 *   3. Form the product-moment matrices:
 *        S00 = R0'R0 / T,  S01 = R0'R1 / T,  S11 = R1'R1 / T.
 *   4. Solve the generalized eigenproblem
 *        | λ S11 − S10 S00⁻¹ S01 | = 0
 *      for eigenvalues λ_1 ≥ … ≥ λ_k ∈ (0,1).
 *   5. Trace statistic for H₀: rank ≤ r:
 *        λ_trace(r) = −T · Σ_{i=r+1}^{k} ln(1 − λ_i)
 *      Compare top-down (r = 0, 1, …) against critical values; the inferred
 *      rank is the first r for which we FAIL to reject.
 *
 * The generalized eigenproblem is symmetrized via the Cholesky factor of
 * S11 (S11 = L Lᵀ): solving M = L⁻¹ (S10 S00⁻¹ S01) L⁻ᵀ as an ordinary
 * symmetric eigenproblem yields the same eigenvalues. This keeps us on the
 * stable cyclic-Jacobi path rather than a general nonsymmetric solver.
 *
 * Critical values: Osterwald-Lenum (1992) Table 1 (case with a constant,
 * no trend), hardcoded for k − r = 1..5. For k > 5 the test returns a
 * verdict but flags that critical values are unavailable beyond rank 5.
 *
 * NULL-on-missing-input: too few observations, fewer than 2 series, ragged
 * series, or a singular moment matrix → verdict "insufficient_data".
 */

import { invert, transpose, multiply } from "../../../core/alpha/matrix.ts";

export type JohansenVerdict = "cointegrated" | "no_cointegration" | "stationary_system" | "insufficient_data";
export type JohansenAlpha = 0.1 | 0.05 | 0.01;

export interface JohansenInput {
  /**
   * Series as columns: `series[j]` is the time series for variable j.
   * All series must be equal length. Pass level series (prices), not returns.
   */
  series: ReadonlyArray<ReadonlyArray<number>>;
  /** VECM lag order in levels (≥ 1). Default 1 (constant-only / no Δ lags). */
  lagOrder?: number;
  /** Significance level for the trace verdicts. Default 0.05. */
  alpha?: JohansenAlpha;
}

export interface JohansenRankTest {
  /** Null hypothesis rank: H₀ is "cointegration rank ≤ rank". */
  rank: number;
  traceStatistic: number;
  criticalValue: number | null;
  /** True when traceStatistic > criticalValue (reject H₀: rank ≤ r). */
  rejected: boolean;
}

export interface JohansenResult {
  verdict: JohansenVerdict;
  /** Inferred cointegration rank (0..k). */
  cointegrationRank: number;
  /** Estimated eigenvalues λ_1 ≥ … ≥ λ_k, each in (0,1). */
  eigenvalues: number[];
  /** Trace test per candidate rank r = 0..k-1. */
  traceTests: JohansenRankTest[];
  numSeries: number;
  lagOrder: number;
  sampleSize: number;
  summary: string;
}

/**
 * Osterwald-Lenum (1992) trace-statistic critical values, "constant, no
 * trend" case. Indexed by (k − r), the number of common stochastic trends
 * under the null. Columns: 10% / 5% / 1%.
 */
const TRACE_CRITICAL_VALUES: Record<number, Record<JohansenAlpha, number>> = {
  1: { 0.1: 6.5, 0.05: 8.18, 0.01: 11.65 },
  2: { 0.1: 15.66, 0.05: 17.95, 0.01: 23.52 },
  3: { 0.1: 28.71, 0.05: 31.52, 0.01: 37.22 },
  4: { 0.1: 45.23, 0.05: 48.28, 0.01: 55.43 },
  5: { 0.1: 66.49, 0.05: 70.6, 0.01: 78.87 },
};

const DEFAULT_LAG = 1;
const DEFAULT_ALPHA: JohansenAlpha = 0.05;

function insufficient(numSeries: number, lagOrder: number, n: number, reason: string): JohansenResult {
  return {
    verdict: "insufficient_data",
    cointegrationRank: 0,
    eigenvalues: [],
    traceTests: [],
    numSeries,
    lagOrder,
    sampleSize: n,
    summary: reason,
  };
}

/** Subtract the column mean from each column of an T×k matrix (in place copy). */
function demean(m: number[][]): number[][] {
  const T = m.length;
  const k = m[0]?.length ?? 0;
  const means = new Array<number>(k).fill(0);
  for (let t = 0; t < T; t++) for (let j = 0; j < k; j++) means[j] = means[j]! + m[t]![j]!;
  for (let j = 0; j < k; j++) means[j] = means[j]! / T;
  const out: number[][] = [];
  for (let t = 0; t < T; t++) {
    const row = new Array<number>(k);
    for (let j = 0; j < k; j++) row[j] = m[t]![j]! - means[j]!;
    out.push(row);
  }
  return out;
}

/**
 * Residuals of regressing each column of `Y` (T×m) on `Z` (T×q) via OLS.
 * Returns the T×m residual matrix, or null if Z'Z is singular.
 */
function regressOut(Y: number[][], Z: number[][]): number[][] | null {
  const T = Y.length;
  const q = Z[0]?.length ?? 0;
  if (q === 0) return Y.map((row) => [...row]);

  const Zt = transpose(Z);
  const ZtZ = multiply(Zt, Z);
  const ZtZinv = invert(ZtZ);
  if (!ZtZinv) return null;
  // Hat application column-wise: resid = Y − Z (Z'Z)⁻¹ Z'Y.
  const ZtY = multiply(Zt, Y); // q×m
  const beta = multiply(ZtZinv, ZtY); // q×m
  const fitted = multiply(Z, beta); // T×m
  const out: number[][] = [];
  for (let t = 0; t < T; t++) {
    const row = new Array<number>(Y[t]!.length);
    for (let j = 0; j < Y[t]!.length; j++) row[j] = Y[t]![j]! - fitted[t]![j]!;
    out.push(row);
  }
  return out;
}

/** A'B / T for two T×* matrices. */
function crossMoment(A: number[][], B: number[][], T: number): number[][] {
  const m = multiply(transpose(A), B);
  for (let i = 0; i < m.length; i++) for (let j = 0; j < m[i]!.length; j++) m[i]![j] = m[i]![j]! / T;
  return m;
}

/** Lower-triangular Cholesky factor L with A = L Lᵀ. Returns null if not PD. */
function cholesky(A: number[][]): number[][] | null {
  const n = A.length;
  const L: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let sum = A[i]![j]!;
      for (let k = 0; k < j; k++) sum -= L[i]![k]! * L[j]![k]!;
      if (i === j) {
        if (sum <= 1e-12) return null;
        L[i]![j] = Math.sqrt(sum);
      } else {
        L[i]![j] = sum / L[j]![j]!;
      }
    }
  }
  return L;
}

/** Invert a lower-triangular matrix by forward substitution. */
function invertLowerTriangular(L: number[][]): number[][] {
  const n = L.length;
  const inv: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let col = 0; col < n; col++) {
    inv[col]![col] = 1 / L[col]![col]!;
    for (let row = col + 1; row < n; row++) {
      let sum = 0;
      for (let k = col; k < row; k++) sum += L[row]![k]! * inv[k]![col]!;
      inv[row]![col] = -sum / L[row]![row]!;
    }
  }
  return inv;
}

/** Cyclic Jacobi eigenvalues for a symmetric matrix, descending order. */
function symmetricEigenvalues(src: number[][]): number[] {
  const n = src.length;
  const a = src.map((row) => [...row]);
  const tol = 1e-14;
  for (let sweep = 0; sweep < 100; sweep++) {
    let off = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) off += a[p]![q]! * a[p]![q]!;
    if (off < tol) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        const apq = a[p]![q]!;
        if (Math.abs(apq) < tol) continue;
        const app = a[p]![p]!;
        const aqq = a[q]![q]!;
        const theta = (aqq - app) / (2 * apq);
        const t = theta >= 0
          ? 1 / (theta + Math.sqrt(1 + theta * theta))
          : 1 / (theta - Math.sqrt(1 + theta * theta));
        const c = 1 / Math.sqrt(1 + t * t);
        const s = t * c;
        a[p]![p] = app - t * apq;
        a[q]![q] = aqq + t * apq;
        a[p]![q] = 0;
        a[q]![p] = 0;
        for (let i = 0; i < n; i++) {
          if (i !== p && i !== q) {
            const aip = a[i]![p]!;
            const aiq = a[i]![q]!;
            a[i]![p] = c * aip - s * aiq;
            a[i]![q] = s * aip + c * aiq;
            a[p]![i] = a[i]![p]!;
            a[q]![i] = a[i]![q]!;
          }
        }
      }
    }
  }
  const eig = new Array<number>(n);
  for (let i = 0; i < n; i++) eig[i] = a[i]![i]!;
  eig.sort((x, y) => y - x);
  return eig;
}

export function runJohansenTest(input: JohansenInput): JohansenResult {
  const lagOrder = Math.max(1, Math.floor(input.lagOrder ?? DEFAULT_LAG));
  const alpha = input.alpha ?? DEFAULT_ALPHA;
  const cols = input.series;
  const k = cols.length;

  if (k < 2) return insufficient(k, lagOrder, 0, "Johansen requires at least 2 series");

  const len = cols[0]!.length;
  for (const c of cols) {
    if (c.length !== len) return insufficient(k, lagOrder, len, "series have unequal lengths");
    for (const v of c) if (!Number.isFinite(v)) return insufficient(k, lagOrder, len, "series contain non-finite values");
  }

  // Build level matrix Y (len×k) from column-major input.
  const Y: number[][] = [];
  for (let t = 0; t < len; t++) {
    const row = new Array<number>(k);
    for (let j = 0; j < k; j++) row[j] = cols[j]![t]!;
    Y.push(row);
  }

  // First differences ΔY (len-1 rows). dY[t] corresponds to Y[t+1]-Y[t].
  const dY: number[][] = [];
  for (let t = 1; t < len; t++) {
    const row = new Array<number>(k);
    for (let j = 0; j < k; j++) row[j] = Y[t]![j]! - Y[t - 1]![j]!;
    dY.push(row);
  }

  // VECM alignment: with lagOrder p, we use p-1 lagged differences.
  // Effective sample begins at index (p-1) of dY.
  const dLags = lagOrder - 1;
  const startD = dLags; // index into dY
  const T = dY.length - startD;
  const minRequired = k * (lagOrder + 2) + 5;
  if (T < minRequired) {
    return insufficient(k, lagOrder, len, `need at least ${minRequired} aligned observations, got ${T}`);
  }

  // R0 source = ΔY_t (rows startD..end); R1 source = Y_{t-1} (level at same t).
  // dY[i] = Y[i+1]-Y[i], so for the equation at dY index i, Y_{t-1} = Y[i].
  const dY0: number[][] = []; // ΔY_t
  const Ylag: number[][] = []; // Y_{t-1}
  const Zlags: number[][] = []; // stacked lagged differences ΔY_{t-1..t-(p-1)}
  for (let i = startD; i < dY.length; i++) {
    dY0.push([...dY[i]!]);
    Ylag.push([...Y[i]!]);
    const z: number[] = [];
    for (let l = 1; l <= dLags; l++) z.push(...dY[i - l]!);
    Zlags.push(z);
  }

  // Concentrate out the deterministic + lagged-difference regressors.
  // When there are lagged diffs, augment Z with a constant column; otherwise
  // partialling-out reduces to centring (constant-only case).
  let R0: number[][] | null;
  let R1: number[][] | null;
  if (dLags > 0) {
    const Zconst = Zlags.map((row) => [1, ...row]);
    R0 = regressOut(dY0, Zconst);
    R1 = regressOut(Ylag, Zconst);
  } else {
    R0 = demean(dY0);
    R1 = demean(Ylag);
  }
  if (!R0 || !R1) return insufficient(k, lagOrder, len, "singular regressor matrix in concentration step");

  const S00 = crossMoment(R0, R0, T);
  const S01 = crossMoment(R0, R1, T);
  const S11 = crossMoment(R1, R1, T);
  const S10 = transpose(S01);

  const S00inv = invert(S00);
  if (!S00inv) return insufficient(k, lagOrder, len, "S00 singular — degenerate differenced series");

  // M = S10 S00⁻¹ S01  (k×k, symmetric PSD).
  const M = multiply(multiply(S10, S00inv), S01);

  // Symmetrize the generalized eigenproblem via Cholesky of S11.
  const L = cholesky(S11);
  if (!L) return insufficient(k, lagOrder, len, "S11 not positive-definite — degenerate levels");
  const Linv = invertLowerTriangular(L);
  // A = L⁻¹ M L⁻ᵀ  → ordinary symmetric eigenproblem with same λ.
  const A = multiply(multiply(Linv, M), transpose(Linv));

  const rawEig = symmetricEigenvalues(A);
  // Clamp eigenvalues into (0,1) to guard tiny numerical excursions.
  const eigenvalues = rawEig.map((e) => parseFloat(Math.min(0.999999, Math.max(0, e)).toFixed(6)));

  // Trace statistics, top-down. λ_trace(r) = -T Σ_{i=r+1}^{k} ln(1-λ_i).
  const traceTests: JohansenRankTest[] = [];
  let inferredRank = 0;
  let rankDecided = false;
  for (let r = 0; r < k; r++) {
    let trace = 0;
    for (let i = r; i < k; i++) trace += Math.log(1 - eigenvalues[i]!);
    trace = -T * trace;

    const kMinusR = k - r;
    const critRow = TRACE_CRITICAL_VALUES[kMinusR];
    const criticalValue = critRow ? critRow[alpha] : null;
    const rejected = criticalValue !== null ? trace > criticalValue : false;

    traceTests.push({
      rank: r,
      traceStatistic: parseFloat(trace.toFixed(4)),
      criticalValue,
      rejected,
    });

    // Inferred rank = first r where we fail to reject H₀: rank ≤ r.
    if (!rankDecided) {
      if (criticalValue === null) {
        // Unknown critical value beyond table — stop inferring, leave rank.
        rankDecided = true;
      } else if (!rejected) {
        inferredRank = r;
        rankDecided = true;
      } else {
        inferredRank = r + 1;
      }
    }
  }

  let verdict: JohansenVerdict;
  if (inferredRank === 0) verdict = "no_cointegration";
  else if (inferredRank >= k) verdict = "stationary_system";
  else verdict = "cointegrated";

  const beyondTable = k > 5;
  const summary = beyondTable
    ? `Inferred rank ${inferredRank} of ${k}; critical values tabulated only up to k−r=5, ranks beyond that are uncalibrated`
    : verdict === "no_cointegration"
      ? `No cointegration: trace at r=0 (${traceTests[0]!.traceStatistic}) ≤ critical ${traceTests[0]!.criticalValue} at α=${alpha}; series are independently I(1)`
      : verdict === "stationary_system"
        ? `Full rank ${k}: the system appears stationary (each series I(0)), not a cointegration relationship`
        : `Cointegration rank ${inferredRank} of ${k} at α=${alpha}: ${inferredRank} mean-reverting linear combination(s) exist`;

  return {
    verdict,
    cointegrationRank: inferredRank,
    eigenvalues,
    traceTests,
    numSeries: k,
    lagOrder,
    sampleSize: T,
    summary,
  };
}

export function johansenToPayload(result: JohansenResult): Record<string, unknown> {
  return {
    kind: "johansen_cointegration.evaluated",
    verdict: result.verdict,
    cointegrationRank: result.cointegrationRank,
    eigenvalues: result.eigenvalues,
    traceTests: result.traceTests,
    numSeries: result.numSeries,
    sampleSize: result.sampleSize,
  };
}
