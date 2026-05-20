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
 * Pure compute, no I/O. Eigendecomposition uses cyclic Jacobi rotations,
 * stable for small N (N ≤ ~50 portfolio constituents).
 */

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
  /** Max Jacobi sweeps. Default 50. */
  maxSweeps?: number;
  /** Off-diagonal convergence tolerance. Default 1e-12. */
  tolerance?: number;
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

const DEFAULT_MAX_SWEEPS = 50;
const DEFAULT_TOL = 1e-12;

function copyMatrix(m: ReadonlyArray<ReadonlyArray<number>>): number[][] {
  return m.map((row) => [...row]);
}

function identity(n: number): number[][] {
  const m: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n).fill(0);
    row[i] = 1;
    m.push(row);
  }
  return m;
}

/**
 * Cyclic Jacobi eigendecomposition for symmetric matrices. Returns
 * eigenvalues + eigenvectors with eigenvalues in descending order.
 */
function jacobiEigen(
  src: ReadonlyArray<ReadonlyArray<number>>,
  maxSweeps: number,
  tol: number,
): { eigenvalues: number[]; eigenvectors: number[][] } {
  const n = src.length;
  const a = copyMatrix(src);
  const v = identity(n);

  for (let sweep = 0; sweep < maxSweeps; sweep++) {
    // Off-diagonal Frobenius norm
    let off = 0;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        off += a[p]![q]! * a[p]![q]!;
      }
    }
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
          const vip = v[i]![p]!;
          const viq = v[i]![q]!;
          v[i]![p] = c * vip - s * viq;
          v[i]![q] = s * vip + c * viq;
        }
      }
    }
  }

  const eigenvalues = new Array<number>(n);
  for (let i = 0; i < n; i++) eigenvalues[i] = a[i]![i]!;

  // Sort descending by eigenvalue, permute eigenvectors (columns of v).
  const order = Array.from({ length: n }, (_, i) => i).sort(
    (i, j) => eigenvalues[j]! - eigenvalues[i]!,
  );
  const sortedEigenvalues = order.map((i) => eigenvalues[i]!);
  const sortedEigenvectors: number[][] = order.map((col) => {
    const vec = new Array<number>(n);
    for (let row = 0; row < n; row++) vec[row] = v[row]![col]!;
    return vec;
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
  // asymmetries from upsetting Jacobi convergence.
  const sym: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(n);
    for (let j = 0; j < n; j++) row[j] = (cov[i]![j]! + cov[j]![i]!) / 2;
    sym.push(row);
  }

  const maxSweeps = input.maxSweeps ?? DEFAULT_MAX_SWEEPS;
  const tol = input.tolerance ?? DEFAULT_TOL;
  const { eigenvalues, eigenvectors } = jacobiEigen(sym, maxSweeps, tol);

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
