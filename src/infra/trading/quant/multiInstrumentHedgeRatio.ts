/**
 * Multi-Instrument Optimal Hedge Ratio — HR1.
 *
 * Given a position with return series X and a basket of K candidate
 * hedge instruments with return series Y_1, ..., Y_K, computes the
 * variance-minimizing hedge weights:
 *
 *   h* = Σ_Y⁻¹ · Σ_XY
 *
 * where Σ_Y is the K×K covariance matrix of candidate returns and
 * Σ_XY is the K-vector of covariances between X and each candidate.
 *
 * Equivalent to the OLS regression coefficients of X on (Y_1, ..., Y_K).
 * Interpretation: short h*_i units of Y_i per unit of X to minimize
 * the variance of the hedged position X − Σ h_i Y_i.
 *
 * Generalizes KF1 (kalmanBeta, single-instrument time-varying beta)
 * to the static multi-instrument case. Composes with KF1 by replacing
 * the OLS-on-fixed-window beta with the multi-asset analog.
 *
 * Pure compute. No I/O. Small matrix inversion via Gauss-Jordan
 * elimination with partial pivoting — robust for K ≤ ~20-30.
 * Ridge regularization parameter stabilizes ill-conditioned cases
 * (collinear candidates) without external dependencies.
 *
 * Pedigree: standard quant primitive. Phynance (Kakushadze 2014/15)
 * §26 covers the symmetric variance-minimization derivation; the
 * matrix case is degenerate Markowitz with the position weight fixed
 * to one and the hedge weights free.
 */

export interface HedgeRatioInput {
  /** Return series of the position to hedge (length T). */
  positionReturns: ReadonlyArray<number>;
  /**
   * Return series of K candidate hedge instruments. Outer length = K,
   * each inner array length = T. Must be parallel to positionReturns.
   */
  candidateReturns: ReadonlyArray<ReadonlyArray<number>>;
  /** Optional names for the K candidates. Length must match K when supplied. */
  candidateNames?: ReadonlyArray<string>;
  /**
   * Ridge regularization added to the diagonal of Σ_Y before inversion.
   * Stabilizes near-collinear candidate baskets. Default 0 (no ridge).
   * Try 1e-6 to 1e-4 for ill-conditioned cases.
   */
  ridge?: number;
}

export interface HedgeRatioWeight {
  name: string;
  weight: number;
}

export interface HedgeRatioResult {
  /** K-vector of optimal hedge weights (regression coefficients of X on Y). */
  hedgeWeights: ReadonlyArray<HedgeRatioWeight>;
  /** Variance of X − Σ h_i Y_i (residual after hedging). */
  residualVariance: number;
  /** Variance of X alone (no hedge). */
  positionVariance: number;
  /** 1 − residualVariance / positionVariance. Equivalent to R² of the regression. */
  varianceReduction: number;
  /** Condition number of Σ_Y (post-ridge). Large values → unstable inversion. */
  conditionNumber: number;
  /** Mean of position returns (intercept-like offset). */
  positionMean: number;
  /** Sample size used. */
  nObservations: number;
  /** Number of hedge candidates. */
  nCandidates: number;
  reasoning: string;
}

function validateInputs(input: HedgeRatioInput): {
  T: number;
  K: number;
  names: string[];
  ridge: number;
} {
  const T = input.positionReturns.length;
  if (T < 2) {
    throw new Error("positionReturns must have at least 2 observations");
  }
  const K = input.candidateReturns.length;
  if (K < 1) {
    throw new Error("candidateReturns must contain at least 1 candidate");
  }
  for (let i = 0; i < K; i++) {
    const c = input.candidateReturns[i]!;
    if (c.length !== T) {
      throw new Error(
        `candidateReturns[${i}] length ${c.length} does not match positionReturns length ${T}`,
      );
    }
  }
  for (let t = 0; t < T; t++) {
    if (!Number.isFinite(input.positionReturns[t]!)) {
      throw new Error(`positionReturns[${t}] is not finite`);
    }
    for (let i = 0; i < K; i++) {
      if (!Number.isFinite(input.candidateReturns[i]![t]!)) {
        throw new Error(`candidateReturns[${i}][${t}] is not finite`);
      }
    }
  }
  let names: string[];
  if (input.candidateNames) {
    if (input.candidateNames.length !== K) {
      throw new Error(
        `candidateNames length ${input.candidateNames.length} does not match candidate count ${K}`,
      );
    }
    names = [...input.candidateNames];
  } else {
    names = Array.from({ length: K }, (_, i) => `Y_${i + 1}`);
  }
  const ridge = input.ridge ?? 0;
  if (ridge < 0) {
    throw new Error("ridge must be ≥ 0");
  }
  return { T, K, names, ridge };
}

function mean(xs: ReadonlyArray<number>): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) s += xs[i]!;
  return s / xs.length;
}

function sampleCovariance(
  xs: ReadonlyArray<number>,
  ys: ReadonlyArray<number>,
  xMean: number,
  yMean: number,
): number {
  let s = 0;
  for (let i = 0; i < xs.length; i++) {
    s += (xs[i]! - xMean) * (ys[i]! - yMean);
  }
  return s / (xs.length - 1);
}

/**
 * Gauss-Jordan inversion with partial pivoting. Returns null if the
 * matrix is singular (zero pivot encountered). For K up to ~30 this
 * is fast and numerically stable enough.
 */
function invertMatrix(M: number[][]): number[][] | null {
  const n = M.length;
  // Augmented matrix [M | I]
  const A: number[][] = M.map((row, i) => {
    const out = [...row];
    for (let j = 0; j < n; j++) out.push(i === j ? 1 : 0);
    return out;
  });

  for (let col = 0; col < n; col++) {
    // Partial pivoting: find row with largest |A[r][col]| at or below `col`.
    let pivotRow = col;
    let pivotAbs = Math.abs(A[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r]![col]!);
      if (v > pivotAbs) {
        pivotAbs = v;
        pivotRow = r;
      }
    }
    if (pivotAbs < 1e-14) return null; // singular
    if (pivotRow !== col) {
      const tmp = A[col]!;
      A[col] = A[pivotRow]!;
      A[pivotRow] = tmp;
    }
    const pivot = A[col]![col]!;
    for (let j = 0; j < 2 * n; j++) A[col]![j]! /= pivot;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = A[r]![col]!;
      if (factor === 0) continue;
      for (let j = 0; j < 2 * n; j++) {
        A[r]![j]! -= factor * A[col]![j]!;
      }
    }
  }
  return A.map((row) => row.slice(n));
}

/**
 * Crude condition-number estimate via power iteration on M and M⁻¹.
 * Not exact but adequate for flagging ill-conditioning.
 */
function estimateConditionNumber(M: number[][], MInv: number[][]): number {
  const n = M.length;
  if (n === 0) return 0;
  // Power iteration for ||M||_∞ (largest absolute eigenvalue approximation)
  const matNormInf = (X: number[][]): number => {
    let max = 0;
    for (let r = 0; r < n; r++) {
      let rowSum = 0;
      for (let c = 0; c < n; c++) rowSum += Math.abs(X[r]![c]!);
      if (rowSum > max) max = rowSum;
    }
    return max;
  };
  const normM = matNormInf(M);
  const normMInv = matNormInf(MInv);
  return normM * normMInv;
}

export function computeMultiInstrumentHedgeRatio(input: HedgeRatioInput): HedgeRatioResult {
  const { T, K, names, ridge } = validateInputs(input);

  const xMean = mean(input.positionReturns);
  const yMeans = input.candidateReturns.map((c) => mean(c));

  // Σ_Y (K × K, sample covariance with ridge on diagonal)
  const sigmaY: number[][] = Array.from({ length: K }, () => Array(K).fill(0));
  for (let i = 0; i < K; i++) {
    for (let j = i; j < K; j++) {
      const cov = sampleCovariance(
        input.candidateReturns[i]!,
        input.candidateReturns[j]!,
        yMeans[i]!,
        yMeans[j]!,
      );
      sigmaY[i]![j] = cov;
      sigmaY[j]![i] = cov;
    }
    sigmaY[i]![i]! += ridge;
  }

  // Σ_XY (K-vector)
  const sigmaXY: number[] = new Array(K);
  for (let i = 0; i < K; i++) {
    sigmaXY[i] = sampleCovariance(
      input.positionReturns,
      input.candidateReturns[i]!,
      xMean,
      yMeans[i]!,
    );
  }

  // Invert Σ_Y
  const sigmaYInv = invertMatrix(sigmaY);
  if (sigmaYInv === null) {
    throw new Error(
      "Σ_Y is singular — hedge candidates are collinear. Drop a redundant candidate or pass a non-zero `ridge` to stabilize.",
    );
  }

  // h* = Σ_Y⁻¹ · Σ_XY
  const hStar: number[] = new Array(K).fill(0);
  for (let i = 0; i < K; i++) {
    let s = 0;
    for (let j = 0; j < K; j++) {
      s += sigmaYInv[i]![j]! * sigmaXY[j]!;
    }
    hStar[i] = s;
  }

  const positionVariance = sampleCovariance(
    input.positionReturns,
    input.positionReturns,
    xMean,
    xMean,
  );

  // Residual variance = Var(X) − h*ᵀ Σ_XY (closed form for OLS).
  let hDotSigmaXY = 0;
  for (let i = 0; i < K; i++) hDotSigmaXY += hStar[i]! * sigmaXY[i]!;
  const residualVariance = Math.max(0, positionVariance - hDotSigmaXY);

  const varianceReduction = positionVariance > 0 ? 1 - residualVariance / positionVariance : 0;

  const conditionNumber = estimateConditionNumber(sigmaY, sigmaYInv);

  const hedgeWeights: HedgeRatioWeight[] = hStar.map((w, i) => ({
    name: names[i]!,
    weight: w,
  }));

  const topWeight = hedgeWeights.reduce((a, b) =>
    Math.abs(a.weight) >= Math.abs(b.weight) ? a : b,
  );
  const conditioningNote =
    conditionNumber > 1e6
      ? " — Σ_Y is poorly conditioned (κ > 1e6); weights are unstable, consider dropping a candidate or increasing ridge"
      : conditionNumber > 1e3
        ? " — Σ_Y conditioning is marginal (κ > 1e3); weights may be sensitive to small data changes"
        : "";
  const reasoning =
    `T=${T} obs, K=${K} candidates, ridge=${ridge}. ` +
    `Variance reduction ${(varianceReduction * 100).toFixed(2)}% ` +
    `(position var ${positionVariance.toFixed(6)} → residual ${residualVariance.toFixed(6)}). ` +
    `Top weight ${topWeight.name}=${topWeight.weight.toFixed(4)}. ` +
    `Condition number κ ≈ ${conditionNumber.toExponential(2)}${conditioningNote}.`;

  return {
    hedgeWeights,
    residualVariance,
    positionVariance,
    varianceReduction,
    conditionNumber,
    positionMean: xMean,
    nObservations: T,
    nCandidates: K,
    reasoning,
  };
}

export function multiInstrumentHedgeRatioToPayload(
  result: HedgeRatioResult,
): Record<string, unknown> {
  return {
    kind: "multi_instrument_hedge_ratio.computed",
    nCandidates: result.nCandidates,
    nObservations: result.nObservations,
    varianceReduction: Number(result.varianceReduction.toFixed(6)),
    residualVariance: Number(result.residualVariance.toFixed(8)),
    positionVariance: Number(result.positionVariance.toFixed(8)),
    conditionNumber: Number(result.conditionNumber.toExponential(4)),
    hedgeWeights: result.hedgeWeights.map((w) => ({
      name: w.name,
      weight: Number(w.weight.toFixed(6)),
    })),
  };
}
