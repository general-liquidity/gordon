/**
 * Bar Permutation (GORDON_BAR_PERMUTATION).
 *
 * Port of Timothy Masters' bar-permutation algorithm from "Permutation
 * and Randomization Tests for Trading System Development" (2020), as
 * reimplemented in the open-source `mcpt` framework by neurotrader888 and
 * walked through in Phosphen's 2026 Monte Carlo Permutation Test article.
 *
 * Decomposes each OHLC bar into five components, shuffles two of them
 * independently, then reassembles. The result preserves first-bar and
 * last-close exactly, and preserves the marginal distributions of the
 * per-bar components (gap, intra-bar high/low/close), but destroys
 * temporal ordering — trends, mean reversion, regime persistence are
 * all randomised.
 *
 * Components per bar (in log space):
 *   - gap         = log(open[t])  − log(close[t−1])    (between-bar move)
 *   - intra_high  = log(high[t])  − log(open[t])
 *   - intra_low   = log(low[t])   − log(open[t])
 *   - intra_close = log(close[t]) − log(open[t])
 *   - start_bar   = original first bar (kept fixed)
 *
 * Two independent permutations:
 *   - perm1 shuffles (intra_high, intra_low, intra_close) TOGETHER
 *     → within-bar relationships preserved
 *   - perm2 shuffles gap separately
 *     → between-bar relationships destroyed
 *
 * Reassembly: walk forward from the start bar using the shuffled relative
 * quantities. Final price = exp(log_reassembled).
 *
 * Mathematical invariants:
 *   - First bar identical (preserved by construction)
 *   - log(last close) = log(first close) + Σ gap + Σ intra_close,
 *     and both sums are preserved under permutation → last close identical
 *   - Marginal distributions of gap, intra_high, intra_low, intra_close
 *     identical (each is a permutation of the original)
 *   - JOINT distribution of (gap, intra_close) is destroyed → log returns
 *     no longer have the same auto-correlation, regime structure, etc.
 *
 * For walk-forward MCPT, pass `startIndex = trainWindow` so only the
 * test portion is permuted. Bars [0, startIndex] stay identical to the
 * original — the strategy still learns parameters from real training data,
 * mimicking production.
 *
 * Failure modes worth documenting (caller responsibility — see mcpt.ts):
 *   - Volatility clustering destroyed → optimistic bias against GARCH-
 *     style strategies. For those, use block bootstrap instead.
 *   - Multi-market lead-lag destroyed → for cross-asset strategies that
 *     depend on lead-lag, this permutation under-rejects. Use phase
 *     randomisation or a dedicated lead-lag-preserving permutation.
 *
 * Pure compute. No I/O. Deterministic seeded LCG RNG.
 */

export const BAR_PERMUTATION_FLAG_ENV = "GORDON_BAR_PERMUTATION";

export function isBarPermutationEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[BAR_PERMUTATION_FLAG_ENV] === "1" ||
    env[BAR_PERMUTATION_FLAG_ENV] === "true"
  );
}

export interface OHLCBar {
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface BarPermutationInput {
  /** Original OHLC bars in chronological order. */
  ohlc: ReadonlyArray<OHLCBar>;
  /**
   * Index from which to start permuting. Bars at indices [0, startIndex]
   * are kept identical to the original. Default 0 (permute from bar 1).
   * For walk-forward MCPT, set this to the training-window length.
   */
  startIndex?: number;
  /** RNG seed. Default 1. */
  seed?: number;
}

export interface BarPermutationResult {
  /** Permuted OHLC bars; same length as input. */
  ohlc: OHLCBar[];
  startIndex: number;
  seed: number;
  /** Permutation index array for (high, low, close). For diagnostics. */
  perm1: number[];
  /** Permutation index array for gap. For diagnostics. */
  perm2: number[];
}

function makeLCG(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function fisherYates(n: number, rng: () => number): number[] {
  const idx = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = idx[i]!;
    idx[i] = idx[j]!;
    idx[j] = tmp;
  }
  return idx;
}

export function permuteOHLCBars(input: BarPermutationInput): BarPermutationResult {
  const startIndex = input.startIndex ?? 0;
  const seed = input.seed ?? 1;
  const N = input.ohlc.length;

  if (startIndex < 0) throw new Error("startIndex must be ≥ 0");
  if (N < startIndex + 2) {
    throw new Error(
      `need at least startIndex + 2 bars; got ${N} bars, startIndex=${startIndex}`,
    );
  }
  for (let i = 0; i < N; i++) {
    const b = input.ohlc[i]!;
    if (b.open <= 0 || b.high <= 0 || b.low <= 0 || b.close <= 0) {
      throw new Error(
        `bar ${i} has non-positive price; log-transform requires strict positives`,
      );
    }
    if (b.high < b.low) {
      throw new Error(`bar ${i} has high < low (${b.high} < ${b.low})`);
    }
  }

  const permIndex = startIndex + 1;
  const permN = N - permIndex;

  // Log-transform
  const logBars = input.ohlc.map((b) => ({
    o: Math.log(b.open),
    h: Math.log(b.high),
    l: Math.log(b.low),
    c: Math.log(b.close),
  }));

  // Relative quantities for indices [permIndex, N)
  const relOpen = new Array<number>(permN);
  const relHigh = new Array<number>(permN);
  const relLow = new Array<number>(permN);
  const relClose = new Array<number>(permN);
  for (let i = permIndex; i < N; i++) {
    const k = i - permIndex;
    const lb = logBars[i]!;
    const prev = logBars[i - 1]!;
    relOpen[k] = lb.o - prev.c;
    relHigh[k] = lb.h - lb.o;
    relLow[k] = lb.l - lb.o;
    relClose[k] = lb.c - lb.o;
  }

  // Two independent permutations
  const rng = makeLCG(seed);
  const perm1 = fisherYates(permN, rng);
  const perm2 = fisherYates(permN, rng);

  // Reassemble in log space
  const permLogBars: { o: number; h: number; l: number; c: number }[] = [];
  for (let i = 0; i <= startIndex; i++) {
    const lb = logBars[i]!;
    permLogBars.push({ o: lb.o, h: lb.h, l: lb.l, c: lb.c });
  }
  for (let i = permIndex; i < N; i++) {
    const k = i - permIndex;
    const o = permLogBars[i - 1]!.c + relOpen[perm2[k]!]!;
    permLogBars.push({
      o,
      h: o + relHigh[perm1[k]!]!,
      l: o + relLow[perm1[k]!]!,
      c: o + relClose[perm1[k]!]!,
    });
  }

  // Exponentiate back
  const ohlc: OHLCBar[] = permLogBars.map((b) => ({
    open: Math.exp(b.o),
    high: Math.exp(b.h),
    low: Math.exp(b.l),
    close: Math.exp(b.c),
  }));

  return { ohlc, startIndex, seed, perm1, perm2 };
}

export function barPermutationToPayload(
  result: BarPermutationResult,
): Record<string, unknown> {
  return {
    kind: "bar_permutation.computed",
    startIndex: result.startIndex,
    seed: result.seed,
    bars: result.ohlc.length,
    firstClose: Number(result.ohlc[0]!.close.toFixed(8)),
    lastClose: Number(result.ohlc[result.ohlc.length - 1]!.close.toFixed(8)),
  };
}
