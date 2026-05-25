/**
 * Microprice — Stoikov 2017 fair-price estimator.
 *
 * Implementation of "The Micro-Price: A High Frequency Estimator of Future
 * Prices" (Sasha Stoikov, 2017), as restated by Sasson/Ho/Samson in the
 * Stanford MS&E 448 writeup.
 *
 * Why microprice over mid / weighted-mid:
 *   - Mid ignores book imbalance — a heavily-bid book at $10.00 / $10.02
 *     with 9 bid / 27 ask has the same mid as a balanced book.
 *   - Weighted-mid uses imbalance but isn't a martingale and produces
 *     counterintuitive moves on order arrival.
 *   - Microprice is defined as E[M_τ_∞ | F_t] — the expected mid-price
 *     conditional on the current order-book state — and converges in
 *     practice within ~6 iterations.
 *
 * Method (finite-state-space Markov model on `(imbalance, spread)`):
 *
 *   1. Discretize each observed book snapshot into a state
 *      x = (imbalance_bucket, spread_bucket).
 *   2. From a sequence of snapshots, estimate:
 *        Q_{xy} = P(M_{t+1} - M_t = 0 ∧ X_{t+1}=y | X_t=x)
 *        R1_{xk} = P(M_{t+1} - M_t = k | X_t=x), k ∈ {-2*tick, -1*tick, +1*tick, +2*tick}
 *        R2_{xy} = P(M_{t+1} - M_t = 0 ∧ X_{t+1}=y | X_t=x) (same as Q here —
 *                  the paper distinguishes them for cases where the new
 *                  state space differs from the conditioning one)
 *   3. Compute g_1 = (I - Q)^{-1} R1 K where K is the price-move vector.
 *      Practically: solve (I - Q) g_1 = R1 K column by column.
 *   4. Recurse: g_{n+1} = (I - Q)^{-1} R2 g_n.
 *   5. Microprice adjustment for state x is sum_{n=1..6} g_n[x].
 *   6. Microprice = M_t + adjustment[X_t].
 *
 * The implementation is intentionally self-contained — no external
 * matrix library. Linear solves use Gauss-Jordan with partial pivoting.
 * State space is small (default 10 imbalance × 3 spread = 30) so even
 * O(N^3) inversion costs are negligible.
 *
 * Honest caveats:
 *   - The paper trained on 0.1s bars over a single day. Real production
 *     use needs careful calibration of bar interval, history length,
 *     and discretization granularity to the instrument.
 *   - The original paper reports the microprice was "insightful but
 *     failed to make significant profit as a fair-price signal alone."
 *     Treat this as a building block (input to other signals + anomaly
 *     detection), not a strategy.
 *   - When data is sparse (some states never visited), transition rows
 *     become NaN. The estimator guards against this by falling back to
 *     mid-only adjustment for unobserved states.
 */

// ============================================================================
// Types
// ============================================================================

export interface BookSnapshot {
  /** Mid-price (= (bid + ask) / 2). */
  mid: number;
  /** Best bid price. */
  bid: number;
  /** Best ask price. */
  ask: number;
  /** Volume resting at the best bid. */
  bidVolume: number;
  /** Volume resting at the best ask. */
  askVolume: number;
  /** Timestamp (ms epoch or otherwise comparable). */
  timestamp: number;
}

export interface MicropriceConfig {
  /** Number of imbalance buckets. Default 10 (paper uses 10). */
  imbalanceBuckets?: number;
  /** Maximum spread (in ticks) to consider distinct. Default 3. */
  maxSpreadTicks?: number;
  /** Tick size. Caller-supplied; required because tick varies per asset. */
  tickSize: number;
  /** Iterations to run the recursion. Default 6 (paper converges by 6). */
  iterations?: number;
  /**
   * Outcome buckets — price-move size in units of ticks. Default
   * [-2, -1, +1, +2]. Microprice contribution per state is the dot
   * product of transition probabilities with this vector.
   */
  outcomeTicks?: ReadonlyArray<number>;
}

export interface MicropriceResult {
  /** Mid at the latest snapshot. */
  mid: number;
  /** Microprice estimate at the latest snapshot. */
  microprice: number;
  /** Microprice − mid; the per-state adjustment. */
  adjustment: number;
  /** State index of the latest snapshot. */
  state: number;
  /** (imbalance_bucket, spread_bucket) for the latest snapshot. */
  imbalanceBucket: number;
  spreadBucket: number;
  /**
   * Per-iteration adjustments. Sum equals `adjustment`. Useful to verify
   * convergence: |g_6| should be much smaller than |g_1|.
   */
  perIteration: number[];
  /** Number of state transitions observed in the input history. */
  transitionsObserved: number;
  /** True when the result is reliable (state was observed in history). */
  reliable: boolean;
}

// ============================================================================
// Discretization
// ============================================================================

function clampIndex(idx: number, n: number): number {
  if (idx < 0) return 0;
  if (idx >= n) return n - 1;
  return idx;
}

/**
 * Imbalance ∈ [0, 1]; bucket 0 = strong ask dominance, last = strong bid
 * dominance. Symmetric so that mirroring (swapping bid↔ask) maps bucket
 * i to bucket (N-1-i) — useful for the data-symmetrization trick from
 * the paper.
 */
export function imbalanceBucket(
  bidVolume: number,
  askVolume: number,
  numBuckets: number,
): number {
  const total = bidVolume + askVolume;
  if (total <= 0) return Math.floor(numBuckets / 2);
  const imbalance = bidVolume / total; // 0..1
  // Each bucket spans 1/numBuckets; index by floor.
  return clampIndex(Math.floor(imbalance * numBuckets), numBuckets);
}

/**
 * Spread in ticks, clipped to [0, maxSpreadTicks-1]. Spread of 0 means
 * bid == ask (a momentary cross — rare but possible on stale data).
 */
export function spreadBucket(
  bid: number,
  ask: number,
  tickSize: number,
  maxSpreadTicks: number,
): number {
  const spread = Math.max(0, ask - bid);
  const ticks = Math.round(spread / tickSize);
  return clampIndex(ticks, maxSpreadTicks);
}

function stateIndex(
  imbalanceBucket: number,
  spreadBucket: number,
  numImbalance: number,
): number {
  return spreadBucket * numImbalance + imbalanceBucket;
}

// ============================================================================
// Linear algebra (Gauss-Jordan with partial pivoting)
// ============================================================================

/**
 * Solve A x = b for x. Returns null on singular systems. Modifies a
 * private copy of A and b — caller's arrays are not mutated.
 *
 * Partial pivoting only (no full pivoting), which is sufficient for
 * the well-conditioned (I − Q) systems we solve here.
 */
function solveLinearSystem(
  A: ReadonlyArray<ReadonlyArray<number>>,
  b: ReadonlyArray<number>,
): number[] | null {
  const n = A.length;
  if (n === 0 || b.length !== n) return null;
  // Build augmented matrix as mutable copy.
  const M: number[][] = A.map((row, i) => [...row, b[i]!]);

  for (let i = 0; i < n; i++) {
    let pivot = i;
    let pivotMag = Math.abs(M[i]![i]!);
    for (let k = i + 1; k < n; k++) {
      const mag = Math.abs(M[k]![i]!);
      if (mag > pivotMag) {
        pivot = k;
        pivotMag = mag;
      }
    }
    if (pivotMag < 1e-12) return null;
    if (pivot !== i) {
      const tmp = M[i]!;
      M[i] = M[pivot]!;
      M[pivot] = tmp;
    }
    const inv = 1 / M[i]![i]!;
    for (let k = i + 1; k < n; k++) {
      const factor = M[k]![i]! * inv;
      if (factor === 0) continue;
      for (let j = i; j <= n; j++) {
        M[k]![j]! -= factor * M[i]![j]!;
      }
    }
  }
  // Back-substitution.
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = M[i]![n]!;
    for (let j = i + 1; j < n; j++) sum -= M[i]![j]! * x[j]!;
    x[i] = sum / M[i]![i]!;
  }
  return x;
}

/**
 * Solve (I − Q) X = RHS column by column. Both Q and RHS are N×N.
 * Returns an N×N matrix X, or null on singularity.
 */
function solveMatrixSystem(
  Q: ReadonlyArray<ReadonlyArray<number>>,
  RHS: ReadonlyArray<ReadonlyArray<number>>,
): number[][] | null {
  const n = Q.length;
  if (n === 0 || RHS.length !== n) return null;
  // Build (I − Q).
  const A: number[][] = Q.map((row, i) =>
    row.map((q, j) => (i === j ? 1 - q : -q)),
  );
  const cols = RHS[0]?.length ?? 0;
  if (cols === 0) return null;
  // Solve column-by-column.
  const X: number[][] = Array.from({ length: n }, () => new Array<number>(cols).fill(0));
  for (let c = 0; c < cols; c++) {
    const rhsCol = RHS.map((row) => row[c]!);
    const xCol = solveLinearSystem(A, rhsCol);
    if (!xCol) return null;
    for (let i = 0; i < n; i++) X[i]![c] = xCol[i]!;
  }
  return X;
}

// ============================================================================
// Transition estimation
// ============================================================================

interface TransitionMatrices {
  /** Q[x][y]: P(mid unchanged ∧ X_{t+1}=y | X_t=x). */
  Q: number[][];
  /** R1[x][k]: P(mid changed by outcomeTicks[k] | X_t=x). */
  R1: number[][];
  /** R2[x][y]: same as Q for the state-only conditioning case. */
  R2: number[][];
  /** Diagnostic — count of transitions originating from each state. */
  rowCounts: number[];
}

function estimateTransitions(
  snapshots: ReadonlyArray<BookSnapshot>,
  config: Required<Pick<MicropriceConfig, "imbalanceBuckets" | "maxSpreadTicks" | "tickSize" | "outcomeTicks">>,
): TransitionMatrices {
  const N = config.imbalanceBuckets * config.maxSpreadTicks;
  const K = config.outcomeTicks.length;

  const Qcounts: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  const R1counts: number[][] = Array.from({ length: N }, () => new Array<number>(K).fill(0));
  const rowCounts: number[] = new Array<number>(N).fill(0);

  for (let t = 0; t + 1 < snapshots.length; t++) {
    const a = snapshots[t]!;
    const b = snapshots[t + 1]!;
    const xa = stateIndex(
      imbalanceBucket(a.bidVolume, a.askVolume, config.imbalanceBuckets),
      spreadBucket(a.bid, a.ask, config.tickSize, config.maxSpreadTicks),
      config.imbalanceBuckets,
    );
    const xb = stateIndex(
      imbalanceBucket(b.bidVolume, b.askVolume, config.imbalanceBuckets),
      spreadBucket(b.bid, b.ask, config.tickSize, config.maxSpreadTicks),
      config.imbalanceBuckets,
    );
    const deltaTicks = Math.round((b.mid - a.mid) / config.tickSize);
    rowCounts[xa]!++;
    if (deltaTicks === 0) {
      Qcounts[xa]![xb]!++;
    } else {
      // Find nearest outcome bucket.
      let bestIdx = 0;
      let bestErr = Infinity;
      for (let k = 0; k < K; k++) {
        const err = Math.abs(config.outcomeTicks[k]! - deltaTicks);
        if (err < bestErr) {
          bestErr = err;
          bestIdx = k;
        }
      }
      R1counts[xa]![bestIdx]!++;
    }
  }

  // Normalize rows to probabilities; safe-divide unobserved rows.
  const Q: number[][] = Array.from({ length: N }, () => new Array<number>(N).fill(0));
  const R1: number[][] = Array.from({ length: N }, () => new Array<number>(K).fill(0));
  for (let x = 0; x < N; x++) {
    const total = rowCounts[x]!;
    if (total === 0) continue;
    for (let y = 0; y < N; y++) Q[x]![y] = Qcounts[x]![y]! / total;
    for (let k = 0; k < K; k++) R1[x]![k] = R1counts[x]![k]! / total;
  }
  // R2 is structurally the same as Q for this finite-state Markov form.
  const R2 = Q.map((row) => [...row]);

  return { Q, R1, R2, rowCounts };
}

// ============================================================================
// Public API
// ============================================================================

export const DEFAULT_MICROPRICE_CONFIG: Omit<Required<MicropriceConfig>, "tickSize"> = {
  imbalanceBuckets: 10,
  maxSpreadTicks: 3,
  iterations: 6,
  outcomeTicks: [-2, -1, 1, 2],
};

/**
 * Compute the microprice estimate at the LATEST snapshot in `snapshots`.
 *
 * Requires the input to be sorted oldest → newest. The last snapshot is
 * the "current" book; everything before is used to estimate transition
 * probabilities. Typical inputs: a rolling 1-2 hour window of book
 * updates at sub-second intervals.
 *
 * Returns `{ microprice, adjustment, ... }` plus a `reliable` flag that
 * is false when:
 *   - history is too short to estimate transitions
 *   - the current state was never observed in history (transition row
 *     is all-zero, so the adjustment defaults to 0 and microprice = mid)
 *   - the (I − Q) system is singular
 */
export function computeMicroprice(
  snapshots: ReadonlyArray<BookSnapshot>,
  config: MicropriceConfig,
): MicropriceResult {
  const cfg: Required<Pick<MicropriceConfig, "imbalanceBuckets" | "maxSpreadTicks" | "tickSize" | "outcomeTicks" | "iterations">> = {
    imbalanceBuckets: config.imbalanceBuckets ?? DEFAULT_MICROPRICE_CONFIG.imbalanceBuckets,
    maxSpreadTicks: config.maxSpreadTicks ?? DEFAULT_MICROPRICE_CONFIG.maxSpreadTicks,
    tickSize: config.tickSize,
    outcomeTicks: config.outcomeTicks ?? DEFAULT_MICROPRICE_CONFIG.outcomeTicks,
    iterations: config.iterations ?? DEFAULT_MICROPRICE_CONFIG.iterations,
  };

  const last = snapshots[snapshots.length - 1];
  if (!last) {
    return {
      mid: 0,
      microprice: 0,
      adjustment: 0,
      state: 0,
      imbalanceBucket: 0,
      spreadBucket: 0,
      perIteration: [],
      transitionsObserved: 0,
      reliable: false,
    };
  }
  const ib = imbalanceBucket(last.bidVolume, last.askVolume, cfg.imbalanceBuckets);
  const sb = spreadBucket(last.bid, last.ask, cfg.tickSize, cfg.maxSpreadTicks);
  const state = stateIndex(ib, sb, cfg.imbalanceBuckets);

  if (snapshots.length < 2) {
    return {
      mid: last.mid,
      microprice: last.mid,
      adjustment: 0,
      state,
      imbalanceBucket: ib,
      spreadBucket: sb,
      perIteration: [],
      transitionsObserved: 0,
      reliable: false,
    };
  }

  const { Q, R1, R2, rowCounts } = estimateTransitions(snapshots.slice(0, -1), cfg);
  const transitionsObserved = rowCounts.reduce((s, c) => s + c, 0);

  // g1 = (I − Q)^{-1} R1 K
  // First compute R1·K (N-vector), then solve (I − Q) g1 = R1·K.
  const N = Q.length;
  const tickPrice = cfg.outcomeTicks.map((t) => t * cfg.tickSize);
  const r1K = R1.map((row) =>
    row.reduce((sum, p, k) => sum + p * tickPrice[k]!, 0),
  );

  const ImQ: number[][] = Q.map((row, i) =>
    row.map((q, j) => (i === j ? 1 - q : -q)),
  );
  const g1 = solveLinearSystem(ImQ, r1K);
  if (!g1) {
    return {
      mid: last.mid,
      microprice: last.mid,
      adjustment: 0,
      state,
      imbalanceBucket: ib,
      spreadBucket: sb,
      perIteration: [],
      transitionsObserved,
      reliable: false,
    };
  }

  // For higher-order iterations we'd repeatedly solve (I − Q) g_{n+1} = R2 g_n.
  // To avoid solving from scratch each iteration, precompute (I − Q)^{-1} R2
  // once and reuse. With N small (default 30), the up-front cost is fine.
  const B = solveMatrixSystem(Q, R2); // (I − Q)^{-1} R2
  if (!B) {
    // Fall back to just g1.
    const adjustment = g1[state]!;
    return {
      mid: last.mid,
      microprice: last.mid + adjustment,
      adjustment,
      state,
      imbalanceBucket: ib,
      spreadBucket: sb,
      perIteration: [adjustment],
      transitionsObserved,
      reliable: rowCounts[state]! > 0,
    };
  }

  const perIteration: number[] = [g1[state]!];
  let gPrev = g1;
  for (let n = 1; n < cfg.iterations; n++) {
    const gNext: number[] = new Array<number>(N).fill(0);
    for (let i = 0; i < N; i++) {
      let s = 0;
      for (let j = 0; j < N; j++) s += B[i]![j]! * gPrev[j]!;
      gNext[i] = s;
    }
    perIteration.push(gNext[state]!);
    gPrev = gNext;
  }

  const adjustment = perIteration.reduce((s, g) => s + g, 0);
  const reliable = rowCounts[state]! > 0 && Number.isFinite(adjustment);

  return {
    mid: last.mid,
    microprice: reliable ? last.mid + adjustment : last.mid,
    adjustment: reliable ? adjustment : 0,
    state,
    imbalanceBucket: ib,
    spreadBucket: sb,
    perIteration,
    transitionsObserved,
    reliable,
  };
}

/** One-line operator summary, suitable for tool output / logging. */
export function summarizeMicroprice(result: MicropriceResult): string {
  if (!result.reliable) {
    return `Microprice: state (imb=${result.imbalanceBucket}, sp=${result.spreadBucket}) had insufficient history; falling back to mid=${result.mid.toFixed(4)}.`;
  }
  const sign = result.adjustment >= 0 ? "+" : "";
  const direction =
    Math.abs(result.adjustment) < 1e-9
      ? "balanced"
      : result.adjustment > 0
        ? "bid-pressured"
        : "ask-pressured";
  return `Microprice: ${result.microprice.toFixed(4)} (mid ${result.mid.toFixed(4)} ${sign}${result.adjustment.toFixed(4)}, ${direction}, state imb=${result.imbalanceBucket} sp=${result.spreadBucket}, ${result.transitionsObserved} transitions observed).`;
}

// Test seam.
export const _internals = {
  solveLinearSystem,
  solveMatrixSystem,
  estimateTransitions,
  stateIndex,
};
