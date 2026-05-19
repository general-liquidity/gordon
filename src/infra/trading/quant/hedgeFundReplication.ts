/**
 * Hedge Fund Replication via Constrained OLS (GORDON_HEDGE_FUND_REPLICATION).
 *
 * From TSaM Ch 20. Given a target return series (the fund) and a basket
 * of factor return series (stocks, ETFs, or style factors), find the
 * allocation weights that minimize the tracking error against the target.
 *
 * This is the small-scale "what's in this hedge fund's portfolio?"
 * discovery problem. Solves via normal-equations OLS on the factor matrix
 * with the target as the dependent variable. No constraints — the caller
 * decides whether to renormalize weights to sum to 1 or to enforce non-
 * negativity (long-only) downstream.
 *
 * Output includes the tracking error (stdev of residuals) and an R² so
 * the caller can judge whether the replication is meaningful.
 */

export const HEDGE_FUND_REPLICATION_FLAG_ENV = "GORDON_HEDGE_FUND_REPLICATION";

export function isHedgeFundReplicationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[HEDGE_FUND_REPLICATION_FLAG_ENV] === "1" ||
    env[HEDGE_FUND_REPLICATION_FLAG_ENV] === "true"
  );
}

export interface FactorSeries {
  id: string;
  returns: ReadonlyArray<number>;
}

export interface ReplicationInput {
  targetReturns: ReadonlyArray<number>;
  factors: ReadonlyArray<FactorSeries>;
  /** Renormalize weights so they sum to 1. Default false. */
  normalizeWeights?: boolean;
}

export interface WeightedFactor {
  id: string;
  weight: number;
}

export interface ReplicationResult {
  weights: WeightedFactor[];
  trackingErrorStdev: number;
  rSquared: number;
  residuals: number[];
  sampleSize: number;
  reasoning: string;
}

function mean(arr: ReadonlyArray<number>): number {
  if (arr.length === 0) return 0;
  let s = 0;
  for (const v of arr) s += v;
  return s / arr.length;
}

function transpose(m: number[][]): number[][] {
  const rows = m.length;
  const cols = m[0]?.length ?? 0;
  const t: number[][] = Array.from({ length: cols }, () => new Array(rows).fill(0));
  for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) t[j]![i] = m[i]![j]!;
  return t;
}

function matMul(a: number[][], b: number[][]): number[][] {
  const r = a.length;
  const c = b[0]?.length ?? 0;
  const inner = b.length;
  const out: number[][] = Array.from({ length: r }, () => new Array(c).fill(0));
  for (let i = 0; i < r; i++) {
    for (let j = 0; j < c; j++) {
      let s = 0;
      for (let k = 0; k < inner; k++) s += a[i]![k]! * b[k]![j]!;
      out[i]![j] = s;
    }
  }
  return out;
}

function solveSymmetric(a: number[][], b: number[]): number[] | null {
  // Solve a · x = b via Gauss-Jordan on the augmented matrix.
  const n = a.length;
  const m: number[][] = a.map((row, i) => [...row, b[i]!]);
  for (let i = 0; i < n; i++) {
    let pivot = i;
    let best = Math.abs(m[i]![i]!);
    for (let r = i + 1; r < n; r++) {
      if (Math.abs(m[r]![i]!) > best) {
        best = Math.abs(m[r]![i]!);
        pivot = r;
      }
    }
    if (best < 1e-12) return null;
    if (pivot !== i) {
      const tmp = m[i]!;
      m[i] = m[pivot]!;
      m[pivot] = tmp;
    }
    const div = m[i]![i]!;
    for (let c = i; c <= n; c++) m[i]![c] = m[i]![c]! / div;
    for (let r = 0; r < n; r++) {
      if (r === i) continue;
      const factor = m[r]![i]!;
      for (let c = i; c <= n; c++) m[r]![c] = m[r]![c]! - factor * m[i]![c]!;
    }
  }
  return m.map((row) => row[n]!);
}

export function computeHedgeFundReplication(input: ReplicationInput): ReplicationResult {
  const target = input.targetReturns;
  const factors = input.factors;
  const T = target.length;
  const k = factors.length;

  if (T < k + 2 || k === 0) {
    return {
      weights: factors.map((f) => ({ id: f.id, weight: 0 })),
      trackingErrorStdev: Number.NaN,
      rSquared: Number.NaN,
      residuals: [],
      sampleSize: T,
      reasoning: `need T > k + 1 observations (got T=${T}, k=${k})`,
    };
  }

  for (const f of factors) {
    if (f.returns.length !== T) {
      return {
        weights: factors.map((g) => ({ id: g.id, weight: 0 })),
        trackingErrorStdev: Number.NaN,
        rSquared: Number.NaN,
        residuals: [],
        sampleSize: T,
        reasoning: `factor ${f.id} length ${f.returns.length} does not match target length ${T}`,
      };
    }
  }

  // X is T × k.
  const X: number[][] = Array.from({ length: T }, (_, i) =>
    factors.map((f) => f.returns[i]!),
  );
  const Xt = transpose(X);
  const XtX = matMul(Xt, X);
  const Xty = matMul(
    Xt,
    target.map((v) => [v]),
  ).map((row) => row[0]!);
  const beta = solveSymmetric(XtX, Xty);
  if (!beta) {
    return {
      weights: factors.map((g) => ({ id: g.id, weight: 0 })),
      trackingErrorStdev: Number.NaN,
      rSquared: Number.NaN,
      residuals: [],
      sampleSize: T,
      reasoning: "factor matrix is singular — drop collinear factors",
    };
  }

  const residuals: number[] = new Array(T).fill(0);
  for (let i = 0; i < T; i++) {
    let predicted = 0;
    for (let j = 0; j < k; j++) predicted += beta[j]! * X[i]![j]!;
    residuals[i] = target[i]! - predicted;
  }

  const meanRes = mean(residuals);
  let ssRes = 0;
  for (const r of residuals) ssRes += (r - meanRes) * (r - meanRes);
  const stdRes = Math.sqrt(ssRes / Math.max(T - 1, 1));

  const meanTarget = mean(target);
  let ssTotal = 0;
  for (const t of target) ssTotal += (t - meanTarget) * (t - meanTarget);
  let sumSqRes = 0;
  for (const r of residuals) sumSqRes += r * r;
  const rSquared = ssTotal > 0 ? 1 - sumSqRes / ssTotal : 0;

  let weights = beta.map((w, j) => ({ id: factors[j]!.id, weight: w }));
  if (input.normalizeWeights) {
    const total = weights.reduce((s, w) => s + w.weight, 0);
    if (Math.abs(total) > 1e-12) {
      weights = weights.map((w) => ({ id: w.id, weight: w.weight / total }));
    }
  }

  return {
    weights,
    trackingErrorStdev: stdRes,
    rSquared,
    residuals,
    sampleSize: T,
    reasoning: `R² ${rSquared.toFixed(3)}, tracking error stdev ${stdRes.toFixed(5)} over ${T} obs`,
  };
}

export function replicationToPayload(result: ReplicationResult): Record<string, unknown> {
  return {
    kind: "hedge_fund_replication.computed",
    rSquared: Number.isFinite(result.rSquared) ? Number(result.rSquared.toFixed(4)) : null,
    trackingErrorStdev: Number.isFinite(result.trackingErrorStdev)
      ? Number(result.trackingErrorStdev.toFixed(6))
      : null,
    factorCount: result.weights.length,
    sampleSize: result.sampleSize,
  };
}
