/**
 * Eigenportfolio Decomposition (GORDON_EIGEN_PORTFOLIO).
 *
 * Decomposes a portfolio's risk into uncorrelated principal directions
 * using the spectral decomposition of the asset covariance matrix:
 *
 *   Σ = V Λ Vᵀ           (V orthonormal eigenvectors, Λ diagonal eigenvalues)
 *
 * Each eigenvector vᵢ is a "principal portfolio" — an orthogonal linear
 * combination of the original assets with variance equal to its eigenvalue
 * λᵢ. Projecting the actual weights onto each eigenvector gives the
 * portfolio's exposure to that direction:
 *
 *   projectionᵢ = w · vᵢ
 *   varianceᵢ   = projectionᵢ² · λᵢ
 *   zScoreᵢ     = projectionᵢ / √λᵢ
 *
 * The variance shares (varianceᵢ / Σⱼ varianceⱼ) reveal how concentrated
 * the portfolio is in any single principal direction. The top eigenvector
 * is typically "the market" — if it dominates, the portfolio has very
 * little diversification benefit despite holding many assets.
 *
 * Complements Gordon's existing `blackLitterman.ts` (which produces
 * optimal weights from views) and `pcaConcentration.ts` (which scores
 * overall concentration). This primitive gives the per-direction
 * breakdown those don't.
 *
 * Pure compute, no I/O. Eigendecomposition is delegated to the shared
 * ml-matrix-backed helper, stable for small N (N ≤ ~50 constituents).
 */

import { eigenDecomposition } from "../../../core/alpha/matrix.ts";

export const EIGEN_PORTFOLIO_FLAG_ENV = "GORDON_EIGEN_PORTFOLIO";

export function isEigenPortfolioEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[EIGEN_PORTFOLIO_FLAG_ENV] === "1" ||
    env[EIGEN_PORTFOLIO_FLAG_ENV] === "true"
  );
}

export interface EigenPortfolioInput {
  /** Symmetric NxN covariance matrix. Must be square. */
  covarianceMatrix: ReadonlyArray<ReadonlyArray<number>>;
  /** Portfolio weights (length N). Sum is not required to equal 1. */
  weights: ReadonlyArray<number>;
  /** Optional asset symbols for traceability. */
  symbols?: ReadonlyArray<string>;
}

export interface PrincipalPortfolio {
  /** 0-based eigenvector index after sorting eigenvalues descending. */
  index: number;
  /** Eigenvalue (= variance of this principal direction). */
  eigenvalue: number;
  /** Unit eigenvector — the linear combination of assets. */
  eigenvector: number[];
  /** Dot product of portfolio weights with this eigenvector. */
  projection: number;
  /** projection² · eigenvalue (the variance this direction contributes). */
  varianceContribution: number;
  /** Fraction of total variance attributable to this direction. */
  varianceShare: number;
  /** projection / √eigenvalue — risk-adjusted exposure. */
  zScore: number;
}

export interface EigenPortfolioResult {
  components: PrincipalPortfolio[];
  totalVariance: number;
  /** Variance share of the dominant (largest-eigenvalue) direction. */
  topConcentration: number;
  /** Effective number of independent bets = 1 / Σ(share²). */
  effectiveBets: number;
  symbols: string[] | null;
  reasoning: string;
}

/**
 * Force the largest-magnitude component of an eigenvector positive, so the
 * sign is deterministic regardless of the solver's arbitrary sign choice
 * (ml-matrix and the old hand-rolled Jacobi can disagree on sign). Resolves
 * ties on |component| toward the earliest index.
 */
function canonicalizeSign(vec: number[]): number[] {
  let maxIdx = 0;
  let maxAbs = -1;
  for (let i = 0; i < vec.length; i++) {
    const a = Math.abs(vec[i]!);
    if (a > maxAbs) {
      maxAbs = a;
      maxIdx = i;
    }
  }
  if (vec[maxIdx]! < 0) return vec.map((x) => -x);
  return vec;
}

/**
 * Symmetric eigendecomposition via the shared ml-matrix helper. Returns
 * eigenvalues in DESCENDING order with `eigenvectors[i]` the i-th
 * eigenvector (sign-canonicalized). ml-matrix yields ascending order with
 * eigenvectors as matrix columns, so we reverse + transpose here.
 */
function jacobiEigen(
  src: ReadonlyArray<ReadonlyArray<number>>,
): { eigenvalues: number[]; eigenvectors: number[][] } {
  const n = src.length;
  const evd = eigenDecomposition(src.map((row) => [...row]));
  if (!evd) return { eigenvalues: [], eigenvectors: [] };

  const order = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => evd.eigenvalues[j]! - evd.eigenvalues[i]!,
  );
  const sortedEigenvalues = order.map((i) => evd.eigenvalues[i]!);
  const sortedEigenvectors: number[][] = order.map((col) => {
    const vec = new Array<number>(n);
    for (let row = 0; row < n; row++) vec[row] = evd.eigenvectors[row]![col]!;
    return canonicalizeSign(vec);
  });
  return { eigenvalues: sortedEigenvalues, eigenvectors: sortedEigenvectors };
}

export function computeEigenPortfolio(input: EigenPortfolioInput): EigenPortfolioResult {
  const cov = input.covarianceMatrix;
  const weights = input.weights;
  const n = weights.length;

  if (cov.length !== n || cov.some((row) => row.length !== n)) {
    throw new Error(`covariance must be ${n}×${n} to match weights of length ${n}`);
  }
  // Light symmetry check — explicit symmetrisation prevents tiny rounding
  // asymmetries from upsetting the eigensolver.
  const sym: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n);
    for (let j = 0; j < n; j++) row[j] = (cov[i]![j]! + cov[j]![i]!) / 2;
    sym.push(row);
  }

  const { eigenvalues, eigenvectors } = jacobiEigen(sym);

  const projections = eigenvectors.map((vec) => {
    let p = 0;
    for (let i = 0; i < n; i++) p += weights[i]! * vec[i]!;
    return p;
  });

  // Variance contributions and total (use only non-negative eigenvalues —
  // a well-formed covariance is PSD; tiny negatives from float noise → clip).
  const safeEigs = eigenvalues.map((e) => Math.max(0, e));
  const variances = projections.map((p, i) => p * p * safeEigs[i]!);
  const totalVariance = variances.reduce((a, b) => a + b, 0);

  const components: PrincipalPortfolio[] = projections.map((proj, i) => {
    const lambda = safeEigs[i]!;
    const variance = variances[i]!;
    const share = totalVariance > 0 ? variance / totalVariance : 0;
    const z = lambda > 0 ? proj / Math.sqrt(lambda) : 0;
    return {
      index: i,
      eigenvalue: lambda,
      eigenvector: eigenvectors[i]!,
      projection: proj,
      varianceContribution: variance,
      varianceShare: share,
      zScore: z,
    };
  });

  const topConcentration = components[0]?.varianceShare ?? 0;
  const sumSquaredShares = components.reduce(
    (acc, c) => acc + c.varianceShare * c.varianceShare,
    0,
  );
  const effectiveBets = sumSquaredShares > 0 ? 1 / sumSquaredShares : 0;

  const symbols = input.symbols ? [...input.symbols] : null;
  const reasoning =
    `${n} assets → ${n} principal directions; ` +
    `top share=${(topConcentration * 100).toFixed(1)}%, ` +
    `effective bets=${effectiveBets.toFixed(2)}, ` +
    `total variance=${totalVariance.toFixed(6)}`;

  return {
    components,
    totalVariance,
    topConcentration,
    effectiveBets,
    symbols,
    reasoning,
  };
}

export function eigenPortfolioToPayload(result: EigenPortfolioResult): Record<string, unknown> {
  return {
    kind: "eigen_portfolio.computed",
    topConcentration: Number(result.topConcentration.toFixed(4)),
    effectiveBets: Number(result.effectiveBets.toFixed(3)),
    totalVariance: Number(result.totalVariance.toFixed(8)),
    components: result.components.map((c) => ({
      index: c.index,
      eigenvalue: Number(c.eigenvalue.toFixed(8)),
      varianceShare: Number(c.varianceShare.toFixed(4)),
      zScore: Number(c.zScore.toFixed(4)),
    })),
  };
}
