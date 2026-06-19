/**
 * PCA Concentration Gate (GORDON_PCA_CONCENTRATION).
 *
 * Catches "diversified-looking book that's really one bet" failure modes.
 * Two strategies can have low pairwise correlation but both load heavily
 * on the same first principal component — they're independently exposed
 * to the same hidden factor (e.g. "long crypto beta", "short USD").
 *
 * Method:
 *   1. Build covariance matrix C of strategy returns.
 *   2. Eigendecompose C (Jacobi method).
 *   3. Compute explained-variance ratios: e_i = λ_i / Σ λ_j.
 *   4. Flag concentration when e_1 exceeds a threshold (default 0.5).
 *   5. Report top-loading strategies on PC1 to identify the hidden factor.
 *
 * Complementary to SC3 effectiveN: effectiveN uses correlation-matrix
 * participation ratio, which counts effective signal count. PCA-concentration
 * targets the SHAPE of variance: even with effectiveN ≈ rawN, if one PC
 * absorbs most variance, you have a hidden common factor.
 *
 * Composes with SC3 effectiveN, WW20 correlationRegimeMonitor (correlation-
 * regime context), and the strategy-acceptance gate.
 */

import { eigenDecomposition } from "../../../core/alpha/matrix.ts";

export const PCA_CONCENTRATION_FLAG_ENV = "GORDON_PCA_CONCENTRATION";

export function isPcaConcentrationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[PCA_CONCENTRATION_FLAG_ENV] === "1" || env[PCA_CONCENTRATION_FLAG_ENV] === "true";
}

export interface ReturnSeries {
  strategyId: string;
  returns: ReadonlyArray<number>;
}

export interface PcaConcentrationInput {
  /** Strategy return series (rows aligned by timestamp). At least 2 strategies, length ≥ 2 each. */
  series: ReadonlyArray<ReturnSeries>;
  /** PC1 explained-variance threshold for the "concentrated" verdict. Default 0.5. */
  concentratedThreshold?: number;
  /** PC1 explained-variance threshold for the "critical" verdict. Default 0.75. */
  criticalThreshold?: number;
  /** Cumulative explained-variance for the "n_for_X" report. Default 0.9. */
  cumulativeTarget?: number;
  /** Top-K loading-magnitude strategies to report on PC1. Default 5. */
  topK?: number;
}

export type PcaVerdict = "diverse" | "concentrated" | "critical";

export interface PcaLoading {
  strategyId: string;
  loading: number;
}

export interface PcaConcentrationResult {
  verdict: PcaVerdict;
  rawN: number;
  eigenvalues: number[];
  explainedVarianceRatios: number[];
  cumulativeExplained: number[];
  pc1ExplainedRatio: number;
  /** Number of PCs required to reach `cumulativeTarget` cumulative variance. */
  nForCumulativeTarget: number;
  /** Top-loading strategies on PC1 sorted by |loading| descending. */
  pc1TopLoadings: PcaLoading[];
  /** Pairs with |corr| > 0.7 to highlight hidden-overlap candidates. */
  highCorrelationPairs: Array<{ a: string; b: string; correlation: number }>;
  reasoning: string;
}

const DEFAULT_CONCENTRATED = 0.5;
const DEFAULT_CRITICAL = 0.75;
const DEFAULT_CUMULATIVE_TARGET = 0.9;
const DEFAULT_TOP_K = 5;
const HIGH_CORR = 0.7;

function buildCovariance(
  series: ReadonlyArray<ReturnSeries>,
): { matrix: number[][]; effectiveLen: number } {
  const n = series.length;
  const minLen = Math.min(...series.map((s) => s.returns.length));
  if (minLen < 2) return { matrix: [], effectiveLen: 0 };

  const aligned = series.map((s) => s.returns.slice(-minLen));
  const means = aligned.map((r) => {
    let sum = 0;
    for (const x of r) sum += x;
    return sum / r.length;
  });

  const mat: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    for (let j = i; j < n; j++) {
      let acc = 0;
      const ai = aligned[i]!;
      const aj = aligned[j]!;
      const mi = means[i]!;
      const mj = means[j]!;
      for (let t = 0; t < minLen; t++) {
        acc += (ai[t]! - mi) * (aj[t]! - mj);
      }
      const cov = acc / (minLen - 1);
      mat[i]![j] = cov;
      mat[j]![i] = cov;
    }
  }
  return { matrix: mat, effectiveLen: minLen };
}

interface Eigen {
  values: number[];
  vectors: number[][];
}

/**
 * Symmetric eigendecomposition via the shared ml-matrix helper. Returns
 * eigenvalues + eigenvectors sorted by eigenvalue DESCENDING, with vectors
 * as matrix columns (`vectors[row][col]`). ml-matrix yields ascending order
 * with arbitrary eigenvector signs, so each column is sign-canonicalized
 * (largest-|component| forced positive) for deterministic loadings.
 */
function jacobiEigen(matrix: number[][]): Eigen {
  const n = matrix.length;
  const evd = eigenDecomposition(matrix.map((row) => [...row]));
  if (!evd) return { values: [], vectors: [] };

  const idx = evd.eigenvalues
    .map((val, i) => ({ val, i }))
    .sort((x, y) => y.val - x.val)
    .map((p) => p.i);

  const sortedValues = idx.map((i) => evd.eigenvalues[i]!);
  const sortedVectors: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let col = 0; col < n; col++) {
    const src = idx[col]!;
    // Sign-canonicalize this eigenvector column: largest-|component| positive.
    let maxRow = 0;
    let maxAbs = -1;
    for (let row = 0; row < n; row++) {
      const a = Math.abs(evd.eigenvectors[row]![src]!);
      if (a > maxAbs) {
        maxAbs = a;
        maxRow = row;
      }
    }
    const flip = evd.eigenvectors[maxRow]![src]! < 0 ? -1 : 1;
    for (let row = 0; row < n; row++) {
      sortedVectors[row]![col] = flip * evd.eigenvectors[row]![src]!;
    }
  }
  return { values: sortedValues, vectors: sortedVectors };
}

function correlationFromCovariance(cov: number[][]): number[][] {
  const n = cov.length;
  const out: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  for (let i = 0; i < n; i++) {
    const vi = Math.sqrt(Math.max(cov[i]![i]!, 0));
    for (let j = 0; j < n; j++) {
      const vj = Math.sqrt(Math.max(cov[j]![j]!, 0));
      if (vi > 0 && vj > 0) out[i]![j] = cov[i]![j]! / (vi * vj);
      else out[i]![j] = i === j ? 1 : 0;
    }
  }
  return out;
}

export function computePcaConcentration(input: PcaConcentrationInput): PcaConcentrationResult {
  const n = input.series.length;
  const concentrated = input.concentratedThreshold ?? DEFAULT_CONCENTRATED;
  const critical = input.criticalThreshold ?? DEFAULT_CRITICAL;
  const cumulativeTarget = input.cumulativeTarget ?? DEFAULT_CUMULATIVE_TARGET;
  const topK = input.topK ?? DEFAULT_TOP_K;

  if (n < 2) {
    return {
      verdict: "diverse",
      rawN: n,
      eigenvalues: [],
      explainedVarianceRatios: [],
      cumulativeExplained: [],
      pc1ExplainedRatio: 0,
      nForCumulativeTarget: n,
      pc1TopLoadings: [],
      highCorrelationPairs: [],
      reasoning: "fewer than 2 strategies — PCA undefined",
    };
  }

  const { matrix: cov, effectiveLen } = buildCovariance(input.series);
  if (cov.length === 0 || effectiveLen < 2) {
    return {
      verdict: "diverse",
      rawN: n,
      eigenvalues: [],
      explainedVarianceRatios: [],
      cumulativeExplained: [],
      pc1ExplainedRatio: 0,
      nForCumulativeTarget: n,
      pc1TopLoadings: [],
      highCorrelationPairs: [],
      reasoning: "return series too short for covariance estimation",
    };
  }

  const { values: eigenvalues, vectors } = jacobiEigen(cov);
  const positive = eigenvalues.map((v) => Math.max(v, 0));
  const total = positive.reduce((a, b) => a + b, 0);
  const ratios = total > 0 ? positive.map((v) => v / total) : positive.map(() => 0);
  const cumulative = ratios.reduce<number[]>((acc, r) => {
    acc.push((acc[acc.length - 1] ?? 0) + r);
    return acc;
  }, []);
  const pc1 = ratios[0] ?? 0;

  let nForTarget = n;
  for (let i = 0; i < cumulative.length; i++) {
    if (cumulative[i]! >= cumulativeTarget) {
      nForTarget = i + 1;
      break;
    }
  }

  const pc1Loadings: PcaLoading[] = input.series.map((s, i) => ({
    strategyId: s.strategyId,
    loading: vectors[i]?.[0] ?? 0,
  }));
  const topLoadings = [...pc1Loadings]
    .sort((a, b) => Math.abs(b.loading) - Math.abs(a.loading))
    .slice(0, topK);

  const corr = correlationFromCovariance(cov);
  const highCorr: Array<{ a: string; b: string; correlation: number }> = [];
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const r = corr[i]![j]!;
      if (Math.abs(r) >= HIGH_CORR) {
        highCorr.push({ a: input.series[i]!.strategyId, b: input.series[j]!.strategyId, correlation: r });
      }
    }
  }
  highCorr.sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation));

  let verdict: PcaVerdict = "diverse";
  if (pc1 >= critical) verdict = "critical";
  else if (pc1 >= concentrated) verdict = "concentrated";

  const topNames = topLoadings.slice(0, 3).map((l) => l.strategyId).join(", ");
  const reasoning =
    verdict === "diverse"
      ? `PC1 explains ${(pc1 * 100).toFixed(1)}% — no hidden factor concentration; ${nForTarget} PCs needed for ${(cumulativeTarget * 100).toFixed(0)}% variance`
      : verdict === "concentrated"
        ? `PC1 explains ${(pc1 * 100).toFixed(1)}% (top loaders: ${topNames}) — book has a dominant hidden factor; expect correlated drawdowns`
        : `PC1 explains ${(pc1 * 100).toFixed(1)}% (top loaders: ${topNames}) — single-factor exposure dressed up as N strategies; treat as one bet`;

  return {
    verdict,
    rawN: n,
    eigenvalues: positive,
    explainedVarianceRatios: ratios,
    cumulativeExplained: cumulative,
    pc1ExplainedRatio: pc1,
    nForCumulativeTarget: nForTarget,
    pc1TopLoadings: topLoadings,
    highCorrelationPairs: highCorr,
    reasoning,
  };
}

export function pcaConcentrationToPayload(result: PcaConcentrationResult): Record<string, unknown> {
  return {
    kind: "pca_concentration.evaluated",
    verdict: result.verdict,
    rawN: result.rawN,
    pc1ExplainedRatio: Number(result.pc1ExplainedRatio.toFixed(4)),
    nForCumulativeTarget: result.nForCumulativeTarget,
    topLoaders: result.pc1TopLoadings.slice(0, 3).map((l) => l.strategyId),
    highCorrelationPairCount: result.highCorrelationPairs.length,
  };
}
