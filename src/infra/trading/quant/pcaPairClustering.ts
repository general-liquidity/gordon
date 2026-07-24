/**
 * PCA + DBSCAN Pair Candidate Discovery (GORDON_PCA_PAIR_CLUSTERING).
 *
 * Port of Ch 3.3-3.4 from Sarmento & Horta, "A Machine Learning based
 * Pairs Trading Investment Strategy" (Springer 2020).
 *
 * Solves the candidate-pair search-explosion problem: for n assets there
 * are n(n-1)/2 possible pairs (n=200 → 19,900 cointegration tests). Per
 * Sarmento, at 5% confidence ~5% of tests are false positives — the
 * multiple-comparisons problem produces an unworkable false-discovery rate.
 *
 * Approach:
 *   1. Z-score normalise each asset's return series.
 *   2. Compute correlation matrix → eigendecompose → keep top k components
 *      (k ≤ 15 per Berkhin's curse-of-dimensionality bound, p. 24).
 *   3. Project each asset into k-dim feature space (its "risk-factor
 *      signature").
 *   4. DBSCAN-cluster the asset embeddings. Assets in the same cluster
 *      share similar risk-factor exposure → candidate pairs.
 *   5. Emit pair candidates ONLY from within clusters → drastically
 *      reduces search space and the multiple-comparisons false-discovery
 *      rate.
 *
 * Sarmento ultimately uses OPTICS (Ch 3.4.4) to handle clusters of varying
 * density. This primitive ships DBSCAN as the simpler first wave; OPTICS is
 * a documented upgrade path. For homogeneous universes (e.g. crypto majors
 * or single-sector equity baskets) DBSCAN is sufficient — Sarmento's
 * OPTICS preference is driven by the ETF dataset spanning multiple sectors
 * with very different cluster densities.
 *
 * Pairs naturally with `pairsEligibilityFilter.ts` (Ch 3.5 four-rule check)
 * which then validates each within-cluster candidate pair.
 *
 * Complements but does NOT overlap `eigenPortfolio.ts` — that primitive
 * decomposes ONE portfolio's variance across principal directions; this
 * primitive embeds MANY assets into a shared feature space for clustering.
 *
 * Empirical calibration (Sarmento Ch 6.2.3.1, ETF dataset, 2014-2018):
 *   - k ∈ {5, 8, 12, 15}: 9-12 clusters, 4-18 candidate pairs — stable
 *   - k = 50: 3 clusters, 6 pairs (degradation begins)
 *   - k = 75: 3 clusters, 3 pairs (further degradation)
 *   - k = 100: 0 pairs (curse of dimensionality dominates)
 * Sarmento settles on k=5 as the chosen default. Our default
 * `min(N-1, 5)` matches this for any N ≥ 6. The Berkhin hard cap at
 * k ≤ 15 is enforced as an exception.
 *
 * Sarmento also empirically confirms (Ch 6.2.3.3) that DBSCAN is highly
 * sensitive to ε across reasonable values, while OPTICS auto-tunes ε per
 * cluster — supporting the upgrade-path comment above.
 *
 * Pure compute. No I/O. Eigendecomposition is delegated to the shared
 * ml-matrix-backed helper.
 */

import { eigenDecomposition } from "../../../core/alpha/matrix.ts";

export interface PcaPairClusteringInput {
  /**
   * Returns matrix: returns[i][t] is asset i's return at time t.
   * All assets must share the same period length T ≥ 2.
   */
  returns: ReadonlyArray<ReadonlyArray<number>>;
  /** Asset symbols (length = returns.length). Optional but recommended for traceability. */
  symbols?: ReadonlyArray<string>;
  /** Number of principal components to keep. Default min(5, N-1) capped at 15 (Berkhin). */
  numComponents?: number;
  /** DBSCAN ε (Euclidean distance threshold for neighbourhood). Required. */
  epsilon: number;
  /** DBSCAN minPts (minimum cluster size). Default 3. */
  minPoints?: number;
}

export interface PcaPairClusteringResult {
  /** Cluster label per asset. -1 = noise/outlier; 0..C-1 = cluster index. */
  clusterLabels: number[];
  /** Number of clusters discovered (excludes noise). */
  clusterCount: number;
  /** Number of assets flagged as noise. */
  noiseCount: number;
  /** Per-asset k-dimensional embedding (PCA-projected feature vector). */
  embeddings: number[][];
  /** Eigenvalues of the correlation matrix (descending). Length = N. */
  eigenvalues: number[];
  /** Fraction of total variance explained by the kept components. */
  varianceExplained: number;
  /** Candidate pairs: (i, j) with i < j, sharing the same cluster. */
  candidatePairs: Array<[number, number]>;
  /** Same pairs but by symbol (if symbols provided). */
  candidatePairSymbols: Array<[string, string]> | null;
  componentsUsed: number;
  reasoning: string;
}

const DEFAULT_MIN_POINTS = 3;
const MAX_DIMENSIONS = 15; // Berkhin's curse-of-dimensionality bound

function zScoreNormaliseRows(matrix: ReadonlyArray<ReadonlyArray<number>>): number[][] {
  const N = matrix.length;
  if (N === 0) return [];
  const T = matrix[0]!.length;
  const out: number[][] = [];
  for (let i = 0; i < N; i++) {
    const row = matrix[i]!;
    if (row.length !== T) {
      throw new Error(
        `row ${i} has length ${row.length}, expected ${T} (all return series must share length)`,
      );
    }
    let sum = 0;
    for (const x of row) sum += x;
    const mean = sum / T;
    let varSum = 0;
    for (const x of row) varSum += (x - mean) ** 2;
    const stdev = Math.sqrt(varSum / Math.max(1, T - 1));
    const normalised = new Array<number>(T);
    if (stdev > 0) {
      for (let t = 0; t < T; t++) normalised[t] = (row[t]! - mean) / stdev;
    } else {
      // Zero-variance asset: keep as zeros to avoid NaN propagation.
      normalised.fill(0);
    }
    out.push(normalised);
  }
  return out;
}

function correlationMatrix(normalised: number[][]): number[][] {
  const N = normalised.length;
  if (N === 0) return [];
  const T = normalised[0]!.length;
  const C: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  const scale = 1 / Math.max(1, T - 1);
  for (let i = 0; i < N; i++) {
    for (let j = i; j < N; j++) {
      let s = 0;
      const a = normalised[i]!;
      const b = normalised[j]!;
      for (let t = 0; t < T; t++) s += a[t]! * b[t]!;
      const v = s * scale;
      C[i]![j] = v;
      C[j]![i] = v;
    }
  }
  return C;
}

/**
 * Force the largest-magnitude component of an eigenvector positive, so the
 * sign is deterministic regardless of the solver's arbitrary sign choice.
 * Embedding distances (and hence DBSCAN clusters) are sign-invariant; this
 * only stabilizes the exposed embedding/eigenvector values.
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
  return vec[maxIdx]! < 0 ? vec.map((x) => -x) : vec;
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

function euclidean(a: ReadonlyArray<number>, b: ReadonlyArray<number>): number {
  let s = 0;
  for (let k = 0; k < a.length; k++) {
    const d = a[k]! - b[k]!;
    s += d * d;
  }
  return Math.sqrt(s);
}

/** DBSCAN on N points in k-dim space. Returns labels (−1 = noise, 0..C−1 = cluster). */
function dbscan(points: number[][], eps: number, minPts: number): number[] {
  const N = points.length;
  const labels = new Array<number>(N).fill(-2); // -2 = unvisited
  let clusterId = -1;
  for (let i = 0; i < N; i++) {
    if (labels[i] !== -2) continue;
    const neighbours: number[] = [];
    for (let j = 0; j < N; j++) {
      if (i !== j && euclidean(points[i]!, points[j]!) <= eps) neighbours.push(j);
    }
    if (neighbours.length + 1 < minPts) {
      labels[i] = -1; // noise (provisional)
      continue;
    }
    clusterId++;
    labels[i] = clusterId;
    const seedSet: number[] = [...neighbours];
    while (seedSet.length > 0) {
      const q = seedSet.shift()!;
      if (labels[q] === -1) labels[q] = clusterId; // border: noise → cluster
      if (labels[q] !== -2) continue;
      labels[q] = clusterId;
      const qNeighbours: number[] = [];
      for (let j = 0; j < N; j++) {
        if (q !== j && euclidean(points[q]!, points[j]!) <= eps) qNeighbours.push(j);
      }
      if (qNeighbours.length + 1 >= minPts) {
        for (const r of qNeighbours) if (!seedSet.includes(r)) seedSet.push(r);
      }
    }
  }
  // Convert any remaining -2 to -1 (defensive; should not happen)
  for (let i = 0; i < N; i++) if (labels[i] === -2) labels[i] = -1;
  return labels;
}

export function computePcaPairClustering(
  input: PcaPairClusteringInput,
): PcaPairClusteringResult {
  const returns = input.returns;
  const N = returns.length;
  if (N < 2) {
    throw new Error(`need at least 2 assets, got ${N}`);
  }
  const T = returns[0]!.length;
  if (T < 2) {
    throw new Error(`each return series must have length ≥ 2, got ${T}`);
  }
  if (input.symbols && input.symbols.length !== N) {
    throw new Error(
      `symbols length ${input.symbols.length} ≠ assets length ${N}`,
    );
  }
  if (input.epsilon <= 0) {
    throw new Error("epsilon must be positive");
  }
  const k =
    input.numComponents ?? Math.min(MAX_DIMENSIONS, Math.max(1, N - 1), 5);
  if (k < 1 || k > N) {
    throw new Error(`numComponents must satisfy 1 ≤ k ≤ N (got k=${k}, N=${N})`);
  }
  if (k > MAX_DIMENSIONS) {
    throw new Error(
      `numComponents ${k} > ${MAX_DIMENSIONS} (Berkhin's curse-of-dimensionality bound)`,
    );
  }
  const minPts = input.minPoints ?? DEFAULT_MIN_POINTS;

  // Normalize, correlate, eigendecompose
  const normalised = zScoreNormaliseRows(returns);
  const corr = correlationMatrix(normalised);
  const { eigenvalues, eigenvectors } = jacobiEigen(corr);

  // Project: each asset's k-dim embedding is its row of the normalised
  // matrix times the top-k eigenvectors. Equivalently, since the correlation
  // matrix C = (1/(T-1)) Y Yᵀ where Y is the N×T normalised matrix, the
  // asset embedding can be taken directly from the eigenvectors of C scaled
  // by √eigenvalue (the principal-component scores of assets).
  // For pair-discovery purposes we just need a feature space where similar
  // risk-factor signatures cluster together — use the top-k eigenvectors
  // weighted by √λ.
  const embeddings: number[][] = [];
  for (let i = 0; i < N; i++) {
    const row = new Array<number>(k);
    for (let j = 0; j < k; j++) {
      const lambda = Math.max(0, eigenvalues[j]!);
      row[j] = eigenvectors[j]![i]! * Math.sqrt(lambda);
    }
    embeddings.push(row);
  }

  // Variance explained by the kept components
  const totalVariance = eigenvalues.reduce((a, b) => a + Math.max(0, b), 0);
  const keptVariance = eigenvalues
    .slice(0, k)
    .reduce((a, b) => a + Math.max(0, b), 0);
  const varianceExplained =
    totalVariance > 0 ? keptVariance / totalVariance : 0;

  // DBSCAN
  const labels = dbscan(embeddings, input.epsilon, minPts);
  const clusterIds = new Set(labels.filter((l) => l >= 0));
  const clusterCount = clusterIds.size;
  const noiseCount = labels.filter((l) => l === -1).length;

  // Build candidate pairs from within-cluster combinations
  const candidatePairs: Array<[number, number]> = [];
  for (const cid of clusterIds) {
    const members: number[] = [];
    for (let i = 0; i < N; i++) if (labels[i] === cid) members.push(i);
    for (let a = 0; a < members.length - 1; a++) {
      for (let b = a + 1; b < members.length; b++) {
        candidatePairs.push([members[a]!, members[b]!]);
      }
    }
  }

  const candidatePairSymbols: Array<[string, string]> | null = input.symbols
    ? candidatePairs.map(([i, j]) => [input.symbols![i]!, input.symbols![j]!])
    : null;

  const reasoning =
    `N=${N} assets, T=${T} periods, k=${k} components ` +
    `(${(varianceExplained * 100).toFixed(1)}% variance), ` +
    `DBSCAN(ε=${input.epsilon}, minPts=${minPts}): ` +
    `${clusterCount} clusters, ${noiseCount} noise, ` +
    `${candidatePairs.length} within-cluster candidate pairs ` +
    `(vs ${(N * (N - 1)) / 2} unfiltered)`;

  return {
    clusterLabels: labels,
    clusterCount,
    noiseCount,
    embeddings,
    eigenvalues,
    varianceExplained,
    candidatePairs,
    candidatePairSymbols,
    componentsUsed: k,
    reasoning,
  };
}

export function pcaPairClusteringToPayload(
  result: PcaPairClusteringResult,
): Record<string, unknown> {
  return {
    kind: "pca_pair_clustering.computed",
    clusterCount: result.clusterCount,
    noiseCount: result.noiseCount,
    componentsUsed: result.componentsUsed,
    varianceExplained: Number(result.varianceExplained.toFixed(4)),
    candidatePairsCount: result.candidatePairs.length,
    candidatePairs: result.candidatePairSymbols ?? result.candidatePairs,
  };
}
