/**
 * Hierarchical Risk Parity (López de Prado 2016, "Building Diversified
 * Portfolios that Outperform Out-of-Sample").
 *
 * HRP allocates without inverting the covariance matrix — the step that
 * makes Markowitz mean-variance unstable on noisy, near-singular estimates.
 * Instead it uses the correlation structure as a tree and splits risk down
 * that tree. Three stages:
 *
 *   1. Tree clustering — correlation → distance d = √((1−ρ)/2), then
 *      single-linkage agglomerative clustering into a linkage tree.
 *   2. Quasi-diagonalization (seriation) — reorder assets by the dendrogram
 *      leaf order so that similar assets sit adjacent; the reordered
 *      covariance is roughly block-diagonal.
 *   3. Recursive bisection — walk the seriated list top-down, splitting each
 *      block in two and allocating between halves by inverse cluster variance
 *      (each half's variance computed under an inverse-variance sub-allocation).
 *
 * The sibling risk-structured methods (inverse-variance / risk-parity /
 * max-diversification) live in `pc-method-ensemble.ts`; HRP is the
 * correlation-tree-aware member of that family. Covariance-native, pure,
 * long-only, sum-to-one. NULL-on-bad-input.
 *
 * Reuses `computeCovarianceMatrix` from `matrix.ts` (read-only) when given a
 * returns matrix.
 */

import { agnes } from "ml-hclust";
import { computeCovarianceMatrix } from "./matrix.ts";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single agglomerative merge: the two cluster ids joined and the distance. */
export interface LinkageNode {
  /** Left child cluster id (leaf ids are 0..n-1; internal ids start at n). */
  left: number;
  /** Right child cluster id. */
  right: number;
  /** Single-linkage distance at which the merge happened. */
  distance: number;
  /** Number of original leaves under this node. */
  size: number;
}

export interface HrpResult {
  /** Final long-only weight per asset (original asset order), Σ = 1. */
  weights: number[];
  /** Asset indices in dendrogram leaf order (the quasi-diagonal seriation). */
  seriatedOrder: number[];
  /** The agglomerative linkage tree (n-1 merges). */
  linkage: LinkageNode[];
  /** Human-readable summary. */
  interpretation: string;
}

export interface HrpInput {
  /** Either a returns matrix (assets × observations)… */
  returns?: number[][];
  /** …or a precomputed covariance matrix (assets × assets). */
  covariance?: number[][];
  /** Optional correlation matrix; derived from covariance when omitted. */
  correlation?: number[][];
  /** Optional asset labels, used only in the interpretation string. */
  labels?: string[];
}

// ---------------------------------------------------------------------------
// Correlation / distance
// ---------------------------------------------------------------------------

/** Pearson correlation from a covariance matrix. Zero-variance rows → 0 off-diagonal, 1 on-diagonal. */
export function covarianceToCorrelation(cov: number[][]): number[][] {
  const n = cov.length;
  const sd: number[] = new Array(n);
  for (let i = 0; i < n; i++) sd[i] = Math.sqrt(Math.max(0, cov[i]![i]!));
  const corr: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(n);
    for (let j = 0; j < n; j++) {
      if (i === j) {
        row[j] = 1;
      } else {
        const denom = sd[i]! * sd[j]!;
        row[j] = denom > 0 ? cov[i]![j]! / denom : 0;
      }
    }
    corr.push(row);
  }
  return corr;
}

/** Correlation → distance d = √((1−ρ)/2). ρ=1 → 0, ρ=0 → √0.5, ρ=−1 → 1. */
export function correlationDistance(corr: number[][]): number[][] {
  const n = corr.length;
  const dist: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row: number[] = new Array(n);
    for (let j = 0; j < n; j++) {
      const c = Math.max(-1, Math.min(1, corr[i]![j]!));
      row[j] = Math.sqrt(Math.max(0, (1 - c) / 2));
    }
    dist.push(row);
  }
  return dist;
}

// ---------------------------------------------------------------------------
// Single-linkage agglomerative clustering
// ---------------------------------------------------------------------------

/**
 * Single-linkage agglomerative clustering on a symmetric distance matrix.
 * Delegates to `ml-hclust`'s tested `agnes` (method `"single"`) and projects
 * its dendrogram into HRP's `LinkageNode[]` contract: leaves 0..n-1, internal
 * n..2n-2 numbered in merge order (post-order = ascending merge height, since
 * agnes builds bottom-up). The merged cluster's distance to any other is the
 * minimum over its members (single linkage), so `node.distance` is the merge
 * height. `left`/`right` follow the agnes child order, which is what
 * `quasiDiagonalize` walks to recover the seriation.
 */
export function singleLinkage(distance: number[][]): LinkageNode[] {
  const n = distance.length;
  if (n < 2) return [];

  const root = agnes(distance, { method: "single", isDistanceMatrix: true });

  // Post-order assignment of ids: leaves keep their original index, internal
  // nodes get n, n+1, … in the order their subtrees complete (children before
  // parent). Collect linkage nodes in that same order.
  const linkage: LinkageNode[] = [];
  let nextId = n;

  const assignId = (cluster: AgnesCluster): number => {
    if (cluster.isLeaf) return cluster.index;
    const left = assignId(cluster.children[0]!);
    const right = assignId(cluster.children[1]!);
    const id = nextId++;
    linkage.push({ left, right, distance: cluster.height, size: cluster.size });
    return id;
  };
  assignId(root as AgnesCluster);

  return linkage;
}

/** Minimal structural view of `ml-hclust`'s `Cluster` used by the converter. */
interface AgnesCluster {
  children: AgnesCluster[];
  height: number;
  size: number;
  index: number;
  isLeaf: boolean;
}

// ---------------------------------------------------------------------------
// Quasi-diagonalization (seriation)
// ---------------------------------------------------------------------------

/**
 * Recover the dendrogram leaf order from the linkage tree (López de Prado's
 * getQuasiDiag). Starts from the root merge and recursively replaces every
 * internal-cluster id with its two children until only leaves remain.
 */
export function quasiDiagonalize(linkage: LinkageNode[], n: number): number[] {
  if (n === 0) return [];
  if (n === 1) return [0];
  if (linkage.length === 0) return Array.from({ length: n }, (_, i) => i);

  // Map internal cluster id → its linkage node.
  const nodeById = new Map<number, LinkageNode>();
  for (let i = 0; i < linkage.length; i++) nodeById.set(n + i, linkage[i]!);

  const rootId = n + linkage.length - 1;
  let order: number[] = [rootId];

  // Expand internal ids (>= n) into their children, left-then-right, until
  // every entry is a leaf.
  let hasInternal = true;
  while (hasInternal) {
    hasInternal = false;
    const next: number[] = [];
    for (const id of order) {
      if (id >= n) {
        const node = nodeById.get(id)!;
        next.push(node.left, node.right);
        hasInternal = true;
      } else {
        next.push(id);
      }
    }
    order = next;
  }
  return order;
}

// ---------------------------------------------------------------------------
// Recursive bisection
// ---------------------------------------------------------------------------

/**
 * Inverse-variance allocation within a sub-list of assets (López de Prado's
 * getIVP), then the cluster variance under that allocation (getClusterVar).
 * Variance uses the full covariance sub-block so intra-cluster correlation is
 * respected.
 */
function clusterVariance(cov: number[][], items: number[]): number {
  // Inverse-variance weights within the cluster.
  const ivp: number[] = items.map((i) => {
    const v = cov[i]![i]!;
    return v > 0 ? 1 / v : 0;
  });
  const ivpSum = ivp.reduce((s, x) => s + x, 0);
  const w = ivpSum > 0 ? ivp.map((x) => x / ivpSum) : items.map(() => 1 / items.length);

  // wᵀ Σ_block w.
  let variance = 0;
  for (let a = 0; a < items.length; a++) {
    for (let b = 0; b < items.length; b++) {
      variance += w[a]! * w[b]! * cov[items[a]!]![items[b]!]!;
    }
  }
  return Math.max(0, variance);
}

/**
 * Recursive bisection (López de Prado's getRecBipart). Splits the seriated
 * list in two halves at each level and scales the running weights of each half
 * by α = 1 − Vᵢ/(V₁+V₂), the inverse-cluster-variance split. Iterative
 * worklist form to stay allocation-friendly.
 */
export function recursiveBisection(cov: number[][], seriated: number[]): number[] {
  const n = cov.length;
  const weights = new Array(n).fill(1);
  if (seriated.length === 0) return weights;

  let clusters: number[][] = [seriated.slice()];
  while (clusters.length > 0) {
    const next: number[][] = [];
    for (const cluster of clusters) {
      if (cluster.length < 2) continue;
      const mid = Math.floor(cluster.length / 2);
      const left = cluster.slice(0, mid);
      const right = cluster.slice(mid);

      const vLeft = clusterVariance(cov, left);
      const vRight = clusterVariance(cov, right);
      const denom = vLeft + vRight;
      // Lower-variance cluster gets the larger share.
      const alpha = denom > 0 ? 1 - vLeft / denom : 0.5;

      for (const i of left) weights[i] = weights[i]! * alpha;
      for (const i of right) weights[i] = weights[i]! * (1 - alpha);

      next.push(left, right);
    }
    clusters = next;
  }
  return weights;
}

// ---------------------------------------------------------------------------
// Top-level pipeline
// ---------------------------------------------------------------------------

function isSquare(m: number[][] | undefined): m is number[][] {
  if (!m || m.length === 0) return false;
  const n = m.length;
  for (const row of m) {
    if (row.length !== n) return false;
    for (const v of row) if (!Number.isFinite(v)) return false;
  }
  return true;
}

/**
 * Run the full HRP pipeline. Accepts either a returns matrix (assets ×
 * observations) or a covariance matrix (with optional precomputed
 * correlation). Returns null when inputs are insufficient or malformed:
 * fewer than 2 assets, non-square covariance, or a returns matrix that the
 * covariance estimator rejects (length mismatch / < 2 observations).
 */
export function hierarchicalRiskParity(input: HrpInput): HrpResult | null {
  let cov: number[][] | null = null;

  if (isSquare(input.covariance)) {
    cov = input.covariance;
  } else if (input.returns && input.returns.length > 0) {
    cov = computeCovarianceMatrix(input.returns);
  }
  if (cov === null || cov.length < 2 || !isSquare(cov)) return null;

  const n = cov.length;
  const corr =
    isSquare(input.correlation) && input.correlation.length === n
      ? input.correlation
      : covarianceToCorrelation(cov);

  const dist = correlationDistance(corr);
  const linkage = singleLinkage(dist);
  const seriatedOrder = quasiDiagonalize(linkage, n);
  const rawWeights = recursiveBisection(cov, seriatedOrder);

  const sum = rawWeights.reduce((s, x) => s + x, 0);
  const weights = (sum > 0 ? rawWeights.map((w) => w / sum) : new Array(n).fill(1 / n)).map((w) =>
    parseFloat(w.toFixed(6)),
  );

  const label = (i: number) => input.labels?.[i] ?? `asset${i}`;
  let maxI = 0;
  let minI = 0;
  for (let i = 1; i < n; i++) {
    if (weights[i]! > weights[maxI]!) maxI = i;
    if (weights[i]! < weights[minI]!) minI = i;
  }
  const interpretation =
    `HRP over ${n} assets via single-linkage tree + recursive bisection. ` +
    `Seriated order: [${seriatedOrder.map(label).join(", ")}]. ` +
    `Largest allocation ${label(maxI)} ${(weights[maxI]! * 100).toFixed(1)}%, ` +
    `smallest ${label(minI)} ${(weights[minI]! * 100).toFixed(1)}%. ` +
    `No covariance inversion — robust to noisy/near-singular estimates.`;

  return { weights, seriatedOrder, linkage, interpretation };
}
