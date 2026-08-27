/**
 * Black-Litterman Portfolio Optimization
 *
 * Bayesian framework that combines market equilibrium returns with
 * investor views to produce optimal portfolio weights.
 *
 * "I think BTC will outperform by 5%" → model shifts allocation toward BTC
 * while respecting the uncertainty of that view.
 *
 * Steps:
 *   1. Compute equilibrium returns (implied by market cap weights)
 *   2. Express investor views as a matrix (P) + expected returns (Q)
 *   3. Combine via Bayes: posterior = prior (equilibrium) + views
 *   4. Optimize weights from posterior expected returns
 *
 * Source: PAAM (Python and AI for Asset Management)
 */

// ============================================================================
// Types
// ============================================================================

export interface InvestorView {
  /** Which assets this view involves. Index into the asset array. */
  assets: number[];
  /** Weights for each asset in this view (e.g., [1, -1] for long/short). */
  weights: number[];
  /** Expected excess return of this view (decimal, e.g., 0.05 = 5%). */
  expectedReturn: number;
  /** Confidence in this view (0-1). Higher = more certain. */
  confidence: number;
}

export interface BlackLittermanInputs {
  /** Asset names/symbols. */
  symbols: string[];
  /** Covariance matrix of returns (N x N). */
  covarianceMatrix: number[][];
  /** Market capitalization weights (must sum to 1). */
  marketWeights: number[];
  /** Risk aversion parameter (default 2.5). */
  riskAversion?: number;
  /** Scaling factor for uncertainty (default 0.05). */
  tau?: number;
  /** Investor views. */
  views: InvestorView[];
}

export interface BlackLittermanResult {
  /** Posterior expected returns per asset. */
  posteriorReturns: number[];
  /** Posterior covariance matrix. */
  posteriorCovariance: number[][];
  /** Optimal portfolio weights from posterior. */
  optimalWeights: number[];
  /** Equilibrium (prior) returns for comparison. */
  equilibriumReturns: number[];
  /** How much each view shifted the allocation. */
  viewImpact: Array<{ view: string; returnShift: number }>;
  /** Formatted summary. */
  summary: string;
}

// ============================================================================
// Matrix Operations (minimal, no dependency)
// ============================================================================

function matMul(A: number[][], B: number[][]): number[][] {
  const rows = A.length;
  const cols = B[0]!.length;
  const inner = B.length;
  const result: number[][] = Array.from(
    { length: rows },
    () => new Array(cols).fill(0) as number[],
  );
  for (let i = 0; i < rows; i++)
    for (let j = 0; j < cols; j++)
      for (let k = 0; k < inner; k++) result[i]![j]! += A[i]![k]! * B[k]![j]!;
  return result;
}

function matVecMul(A: number[][], v: number[]): number[] {
  return A.map((row) => row.reduce((s, a, j) => s + a * v[j]!, 0));
}

function transpose(A: number[][]): number[][] {
  const rows = A.length;
  const cols = A[0]!.length;
  const result: number[][] = Array.from(
    { length: cols },
    () => new Array(rows).fill(0) as number[],
  );
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) result[j]![i] = A[i]![j]!;
  return result;
}

function matAdd(A: number[][], B: number[][]): number[][] {
  return A.map((row, i) => row.map((v, j) => v + B[i]![j]!));
}

function scalarMul(A: number[][], s: number): number[][] {
  return A.map((row) => row.map((v) => v * s));
}

function invertMatrix(A: number[][]): number[][] {
  const n = A.length;
  const aug = A.map((row, i) => {
    const identity = new Array(n).fill(0) as number[];
    identity[i] = 1;
    return [...row, ...identity];
  });

  // Gauss-Jordan elimination
  for (let col = 0; col < n; col++) {
    let maxRow = col;
    for (let row = col + 1; row < n; row++)
      if (Math.abs(aug[row]![col]!) > Math.abs(aug[maxRow]![col]!)) maxRow = row;
    [aug[col], aug[maxRow]] = [aug[maxRow]!, aug[col]!];

    const pivot = aug[col]![col]!;
    if (Math.abs(pivot) < 1e-12) continue;

    for (let j = 0; j < 2 * n; j++) aug[col]![j]! /= pivot;

    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = aug[row]![col]!;
      for (let j = 0; j < 2 * n; j++) aug[row]![j]! -= factor * aug[col]![j]!;
    }
  }

  return aug.map((row) => row.slice(n));
}

// ============================================================================
// Black-Litterman Model
// ============================================================================

/**
 * Run Black-Litterman portfolio optimization.
 */
export function blackLitterman(inputs: BlackLittermanInputs): BlackLittermanResult {
  const { symbols, covarianceMatrix, marketWeights, views } = inputs;
  const delta = inputs.riskAversion ?? 2.5;
  const tau = inputs.tau ?? 0.05;
  const n = symbols.length;
  const sigma = covarianceMatrix;

  // Step 1: Equilibrium returns (pi = delta * Sigma * w_mkt)
  const equilibriumReturns = matVecMul(sigma, marketWeights).map((r) => r * delta);

  if (views.length === 0) {
    // No views — just return equilibrium
    return {
      posteriorReturns: equilibriumReturns,
      posteriorCovariance: sigma,
      optimalWeights: marketWeights,
      equilibriumReturns,
      viewImpact: [],
      summary: "No views provided. Returning market equilibrium weights.",
    };
  }

  // Step 2: Build view matrices P (K x N) and Q (K x 1)
  const K = views.length;
  const P: number[][] = Array.from({ length: K }, () => new Array(n).fill(0) as number[]);
  const Q: number[] = [];
  const omegaDiag: number[] = [];

  for (let k = 0; k < K; k++) {
    const view = views[k]!;
    for (let i = 0; i < view.assets.length; i++) {
      P[k]![view.assets[i]!] = view.weights[i]!;
    }
    Q.push(view.expectedReturn);
    // Omega = diag(P * tau*Sigma * P') scaled by (1 - confidence)
    // Higher confidence → lower uncertainty → stronger view impact
    const uncertainty = Math.max(0.01, 1 - view.confidence);
    const pRow = P[k]!;
    const pSigmaP = pRow.reduce(
      (s1, pi, i) => s1 + pi * pRow.reduce((s2, pj, j) => s2 + pj * tau * sigma[i]![j]!, 0),
      0,
    );
    omegaDiag.push(pSigmaP * uncertainty);
  }

  // Omega (K x K diagonal)
  const omega: number[][] = Array.from({ length: K }, (_, i) => {
    const row = new Array(K).fill(0) as number[];
    row[i] = omegaDiag[i]!;
    return row;
  });

  // Step 3: Posterior returns
  // E[R] = pi + tau*Sigma*P' * (P*tau*Sigma*P' + Omega)^-1 * (Q - P*pi)
  const tauSigma = scalarMul(sigma, tau);
  const Pt = transpose(P);
  const tauSigmaPt = matMul(tauSigma, Pt); // N x K
  const PtauSigmaPt = matMul(P, tauSigmaPt); // K x K
  const middle = invertMatrix(matAdd(PtauSigmaPt, omega)); // K x K

  // Q - P*pi
  const Ppi = matVecMul(P, equilibriumReturns);
  const qMinusPpi = Q.map((q, i) => q - Ppi[i]!);

  // tau*Sigma*P' * middle * (Q - P*pi)
  const middleTimesQPpi = matVecMul(middle, qMinusPpi); // K x 1
  const adjustment = matVecMul(tauSigmaPt, middleTimesQPpi); // N x 1

  const posteriorReturns = equilibriumReturns.map((pi, i) => pi + adjustment[i]!);

  // Step 4: Posterior covariance
  // Sigma_post = Sigma + tau*Sigma - tau*Sigma*P'*(P*tau*Sigma*P' + Omega)^-1 * P*tau*Sigma
  const PtauSigma = matMul(P, tauSigma); // K x N
  const middlePtauSigma = matMul(middle, PtauSigma); // K x N
  const reduction = matMul(tauSigmaPt, middlePtauSigma); // N x N
  const posteriorCovariance = matAdd(matAdd(sigma, tauSigma), scalarMul(reduction, -1));

  // Step 5: Optimal weights (mean-variance: w = (delta * Sigma_post)^-1 * E[R])
  const invDeltaSigma = invertMatrix(scalarMul(posteriorCovariance, delta));
  const rawWeights = matVecMul(invDeltaSigma, posteriorReturns);

  // Normalize to sum to 1 (long-only constraint approximation)
  const sumW = rawWeights.reduce((s, w) => s + Math.max(0, w), 0);
  const optimalWeights = rawWeights.map((w) => Math.max(0, w) / (sumW || 1));

  // View impact
  const viewImpact = views.map((v, _k) => {
    const viewAssets = v.assets.map((i) => symbols[i]).join("/");
    return {
      view: `${viewAssets}: ${(v.expectedReturn * 100).toFixed(1)}% (${(v.confidence * 100).toFixed(0)}% confidence)`,
      returnShift: adjustment[v.assets[0]!] ?? 0,
    };
  });

  // Summary
  const lines: string[] = ["Black-Litterman Optimal Allocation:"];
  for (let i = 0; i < n; i++) {
    const mktW = (marketWeights[i]! * 100).toFixed(1);
    const optW = (optimalWeights[i]! * 100).toFixed(1);
    const shift = optimalWeights[i]! - marketWeights[i]!;
    const arrow = shift > 0.01 ? "\u25B2" : shift < -0.01 ? "\u25BC" : "\u2500";
    lines.push(`  ${symbols[i]!.padEnd(8)} ${mktW}% → ${optW}% ${arrow}`);
  }

  return {
    posteriorReturns,
    posteriorCovariance,
    optimalWeights,
    equilibriumReturns,
    viewImpact,
    summary: lines.join("\n"),
  };
}
