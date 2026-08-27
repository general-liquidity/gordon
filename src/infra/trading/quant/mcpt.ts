/**
 * Monte Carlo Permutation Test (GORDON_MCPT).
 *
 * Port of the MCPT framework from Timothy Masters' "Permutation and
 * Randomization Tests for Trading System Development" (2020), as
 * walked through in Phosphen's 2026 article applying it to a Polymarket
 * Donchian-breakout backtest.
 *
 * Tests whether a strategy's profit factor on real data is statistically
 * distinguishable from what you'd get by re-optimising the same strategy
 * on random shuffles of the same data. The shuffles preserve the marginal
 * statistical structure of the market (via `barPermutation.ts`) but
 * destroy temporal ordering.
 *
 * Null hypothesis: the strategy has no real edge — its profit factor is
 * indistinguishable from data-mining bias produced on random shuffles.
 *
 * Algorithm:
 *   1. Compute the strategy's profit factor on the real series: `realPF`
 *   2. Generate N permutations of the series; re-run the optimiser on each
 *   3. Count permutations with `permPF >= realPF` (initialise at 1 — Masters
 *      convention bounds p ≥ 1/N)
 *   4. p = #beats / N. Reject null if p < α.
 *
 * Two operating modes (controlled by `startIndex`):
 *   - In-sample MCPT (`startIndex = 0`): permute everything. Tests whether
 *     the optimiser's selected parameters reflect real structure.
 *   - Walk-forward MCPT (`startIndex = trainWindow`): permute only the
 *     test portion. Tests whether walk-forward OOS performance is real
 *     edge or lucky alignment with the sample path.
 *
 * Significance thresholds (Phosphen, citing Masters):
 *   - < 1 year of walk-forward data → accept at α = 0.05
 *   - 2+ years of walk-forward data → accept at α = 0.01
 *
 * Failure modes (read before relying on the verdict):
 *   1. Target fiddling — running MCPT, tweaking the strategy on failure,
 *      re-running, eventually getting a pass. Statistically equivalent to
 *      running MCPT once and getting low p by chance after many tries.
 *      Lock the strategy spec BEFORE calling computeMCPT. If it fails,
 *      throw the strategy away.
 *   2. Volatility clustering — bar permutation destroys vol regimes,
 *      producing slight optimistic bias against GARCH-style strategies.
 *      Acceptable for most uses; use block bootstrap for vol-dependent
 *      strategies instead.
 *   3. Multi-market lead-lag — bar permutation per-market doesn't
 *      preserve cross-asset lead-lag. For lead-lag strategies, use
 *      phase randomisation or a synchronized permutation.
 *
 * Complements (orthogonal to, not redundant with) Gordon's existing
 * credibility primitives in `src/infra/trading/ops/backtestCredibility.ts`:
 *   - PSR/DSR (Bailey & López de Prado): account for non-normality +
 *     multiple-testing of returns
 *   - CPCV (López de Prado): out-of-sample test via combinatorial folds
 *   - MCPT (this): null-hypothesis test against statistically-matched
 *     shuffles. Asks "would noise look this good?", not "is this Sharpe
 *     real?" or "does this generalise OOS?"
 *
 * Use MCPT as a filter, not a guarantee. Pass it twice in a row across
 * different markets and you have a candidate strategy.
 *
 * Pure compute. No I/O. Deterministic seeded LCG RNG.
 */

import { permuteOHLCBars, type OHLCBar } from "./barPermutation.ts";

export interface MCPTInput {
  /** Original OHLC bars. */
  ohlc: ReadonlyArray<OHLCBar>;
  /**
   * Optimiser: given an OHLC series, return the best-found profit factor
   * (or any monotone fitness score where higher = better) for the
   * strategy under test. This is the function MCPT compares around.
   */
  optimize: (ohlc: ReadonlyArray<OHLCBar>) => number;
  /**
   * Number of permutations to run. Default 1000. The Phosphen article
   * uses 200 for walk-forward MCPT (per-permutation cost is much higher
   * because each runs the full walk-forward optimization).
   */
  numPermutations?: number;
  /**
   * For walk-forward MCPT: index from which to permute. Bars in [0,
   * startIndex] stay identical. Default 0 (in-sample MCPT — permute
   * everything except bar 0).
   */
  startIndex?: number;
  /** RNG seed for reproducibility. Default 0. */
  seed?: number;
}

export interface MCPTOptions {
  /**
   * P-value below which we reject the null and the strategy "passes".
   * Phosphen's recommendation:
   *   - In-sample / short walk-forward: 0.05
   *   - 2+ years walk-forward: 0.01
   * Default 0.01.
   */
  significanceThreshold?: number;
}

export interface MCPTResult {
  /** Profit factor on the real (unpermuted) data. */
  realProfitFactor: number;
  /** Sorted ascending. Length = numPermutations − 1 (excludes the real). */
  permutedProfitFactors: number[];
  /**
   * Number of permutations whose PF met or beat the real PF.
   * Initialised at 1 per Masters convention (bounds p ≥ 1/N).
   */
  permsBeatingReal: number;
  /** p-value = permsBeatingReal / numPermutations. */
  pValue: number;
  numPermutations: number;
  significanceThreshold: number;
  /** "pass" iff pValue < significanceThreshold. */
  verdict: "pass" | "fail";
  /** Centre of the null distribution. */
  meanPermutedPF: number;
  /** Median of the null distribution. */
  medianPermutedPF: number;
  /** Real PF's percentile rank in the null distribution, 0-1. */
  realPercentile: number;
  reasoning: string;
}

export function computeMCPT(input: MCPTInput, options: MCPTOptions = {}): MCPTResult {
  const numPerms = input.numPermutations ?? 1000;
  const sig = options.significanceThreshold ?? 0.01;
  const seed = input.seed ?? 0;

  if (numPerms < 2) throw new Error("numPermutations must be ≥ 2");
  if (sig <= 0 || sig >= 1) {
    throw new Error("significanceThreshold must lie in (0, 1)");
  }

  const realPF = input.optimize(input.ohlc);
  if (!Number.isFinite(realPF)) {
    throw new Error(`optimizer returned non-finite real profit factor: ${realPF}`);
  }

  let beatCount = 1; // Masters: initialise at 1 to bound p ≥ 1/N
  const permPFs: number[] = [];

  for (let i = 1; i < numPerms; i++) {
    const perm = permuteOHLCBars({
      ohlc: input.ohlc,
      startIndex: input.startIndex,
      seed: seed + i,
    });
    const permPF = input.optimize(perm.ohlc);
    if (Number.isFinite(permPF)) {
      if (permPF >= realPF) beatCount++;
      permPFs.push(permPF);
    }
  }

  const pValue = beatCount / numPerms;
  const verdict: "pass" | "fail" = pValue < sig ? "pass" : "fail";

  const sortedPFs = [...permPFs].sort((a, b) => a - b);
  const meanPerm = permPFs.length > 0 ? permPFs.reduce((a, b) => a + b, 0) / permPFs.length : NaN;
  const medianPerm = sortedPFs.length > 0 ? sortedPFs[Math.floor(sortedPFs.length / 2)]! : NaN;
  const belowReal = permPFs.filter((p) => p < realPF).length;
  const realPercentile = permPFs.length > 0 ? belowReal / permPFs.length : NaN;

  const reasoning =
    `real PF=${realPF.toFixed(4)}; ${beatCount}/${numPerms} ` +
    `permutations met-or-beat (median permuted PF=${medianPerm.toFixed(4)}); ` +
    `p=${pValue.toFixed(4)}; ${verdict.toUpperCase()} at α=${sig}`;

  return {
    realProfitFactor: realPF,
    permutedProfitFactors: sortedPFs,
    permsBeatingReal: beatCount,
    pValue,
    numPermutations: numPerms,
    significanceThreshold: sig,
    verdict,
    meanPermutedPF: meanPerm,
    medianPermutedPF: medianPerm,
    realPercentile,
    reasoning,
  };
}

export function mcptToPayload(result: MCPTResult): Record<string, unknown> {
  return {
    kind: "mcpt.computed",
    realProfitFactor: Number(result.realProfitFactor.toFixed(4)),
    pValue: Number(result.pValue.toFixed(4)),
    permsBeatingReal: result.permsBeatingReal,
    numPermutations: result.numPermutations,
    significanceThreshold: result.significanceThreshold,
    verdict: result.verdict,
    meanPermutedPF: Number(result.meanPermutedPF.toFixed(4)),
    medianPermutedPF: Number(result.medianPermutedPF.toFixed(4)),
    realPercentilePct: Number((result.realPercentile * 100).toFixed(2)),
  };
}
