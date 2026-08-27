/**
 * Conditional-vs-Unconditional Return Distribution Test
 * (Lo, Mamaysky & Wang 2000, "Foundations of Technical Analysis", §III.A)
 *
 * The actual scientific contribution of the LMW paper: a signal is
 * *informative* iff conditioning on it shifts the return distribution. This
 * compares a CONDITIONAL return sample (returns realized after a signal /
 * pattern fires) against the UNCONDITIONAL sample via the paper's two
 * goodness-of-fit diagnostics:
 *
 *   1. Decile χ² (Pearson): bucket the conditional returns into the
 *      unconditional distribution's deciles. Under H0 (same distribution)
 *      each decile holds 10%. Q = Σ (n_j − 0.1n)² / (0.1n) ~ χ²₉.
 *
 *   2. Two-sample Kolmogorov–Smirnov: γ = √(n1·n2/(n1+n2))·sup|F1−F2|, with
 *      the asymptotic Kolmogorov p-value.
 *
 * This is GENERAL — it validates any signal's informativeness, not just
 * chart patterns. Distinct from:
 *   - the eval harness (`domain/evals/`) — LLM-as-judge on agent trajectories.
 *   - `tradeEvaluator.ts` — realized-PnL scoring after the fact.
 * This is a distributional INFORMATION test — the weaker-but-cleaner test the
 * paper argues for (informativeness ≠ profitability). Pairs naturally with
 * `lmw-patterns.ts` (does a detected pattern actually move the distribution?).
 *
 * Pure functions. The caller supplies the two return samples; `normalize`
 * z-scores each sample (the paper normalizes per security before pooling).
 */

// ---------------------------------------------------------------------------
// Special functions — χ² survival delegates to the shared `@stdlib`-backed
// `core/numerics` module (SPEC Win #1). The KS asymptotic series below has no
// `@stdlib` equivalent, so it stays hand-rolled.
// ---------------------------------------------------------------------------

import { chiSquarePValue } from "../numerics/index.ts";

/** Upper-tail (survival) of the χ² distribution with `df` degrees of freedom. */
export function chiSquareSf(x: number, df: number): number {
  return chiSquarePValue(x, df);
}

/**
 * Asymptotic p-value of the two-sample Kolmogorov–Smirnov statistic γ:
 *   Q_KS(γ) = 2 Σ_{j≥1} (−1)^{j−1} exp(−2 j² γ²).
 */
export function ksPValue(gamma: number): number {
  if (gamma <= 0) return 1;
  let sum = 0;
  for (let j = 1; j <= 200; j++) {
    const sign = j % 2 === 1 ? 1 : -1;
    const term = 2 * sign * Math.exp(-2 * j * j * gamma * gamma);
    sum += term;
    if (Math.abs(term) < 1e-14) break;
  }
  return Math.min(1, Math.max(0, sum));
}

// ---------------------------------------------------------------------------
// Sample helpers
// ---------------------------------------------------------------------------

function zScore(xs: number[]): number[] {
  const n = xs.length;
  if (n === 0) return [];
  const mean = xs.reduce((s, v) => s + v, 0) / n;
  const variance = xs.reduce((s, v) => s + (v - mean) * (v - mean), 0) / n;
  const sd = Math.sqrt(variance);
  if (sd === 0) return xs.map(() => 0);
  return xs.map((v) => (v - mean) / sd);
}

/** Linear-interpolated quantile of a pre-sorted array. */
function quantileSorted(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return NaN;
  if (n === 1) return sorted[0]!;
  const pos = q * (n - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo]!;
  return sorted[lo]! + (pos - lo) * (sorted[hi]! - sorted[lo]!);
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ConditionalDistributionInput {
  /** Returns realized after the signal fires (the conditional sample). */
  conditionalReturns: number[];
  /** The baseline / unconditional return sample. */
  unconditionalReturns: number[];
  /**
   * Z-score each sample (subtract mean, divide by sd) before testing, as the
   * paper does per-security. Default true. The χ² test is invariant to this
   * (deciles rescale with it), but it makes the KS comparison about
   * distribution SHAPE rather than level/scale.
   */
  normalize?: boolean;
  /** Significance level for the `informative` verdict. Default 0.05. */
  alpha?: number;
}

export interface ChiSquareResult {
  /** Pearson Q statistic. */
  Q: number;
  df: number;
  pValue: number;
  /** Count of conditional returns falling in each unconditional decile. */
  decileCounts: number[];
  /** Fraction in each decile (should be ~0.10 under H0). */
  decileFractions: number[];
}

export interface KsResult {
  /** sup|F_cond − F_uncond| over the pooled support. */
  supDiff: number;
  /** The scaled statistic γ. */
  gamma: number;
  pValue: number;
}

export interface ConditionalDistributionResult {
  nConditional: number;
  nUnconditional: number;
  chiSquare: ChiSquareResult;
  ks: KsResult;
  /** True if either test rejects H0 at `alpha` — the signal moved the distribution. */
  informative: boolean;
  summary: string;
}

// ---------------------------------------------------------------------------
// Main test
// ---------------------------------------------------------------------------

export function conditionalDistributionTest(
  input: ConditionalDistributionInput,
): ConditionalDistributionResult {
  const normalize = input.normalize ?? true;
  const alpha = input.alpha ?? 0.05;

  const cond = normalize ? zScore(input.conditionalReturns) : [...input.conditionalReturns];
  const uncond = normalize ? zScore(input.unconditionalReturns) : [...input.unconditionalReturns];

  const nc = cond.length;
  const nu = uncond.length;

  const emptyResult = (reason: string): ConditionalDistributionResult => ({
    nConditional: nc,
    nUnconditional: nu,
    chiSquare: {
      Q: 0,
      df: 9,
      pValue: 1,
      decileCounts: new Array(10).fill(0),
      decileFractions: new Array(10).fill(0),
    },
    ks: { supDiff: 0, gamma: 0, pValue: 1 },
    informative: false,
    summary: `Insufficient data: ${reason}.`,
  });

  if (nc < 10 || nu < 10) {
    return emptyResult("need ≥10 returns in each sample");
  }

  // --- Decile χ² goodness-of-fit ---
  const sortedUncond = [...uncond].sort((a, b) => a - b);
  // 9 interior decile cut points of the unconditional distribution.
  const cuts: number[] = [];
  for (let k = 1; k <= 9; k++) cuts.push(quantileSorted(sortedUncond, k / 10));

  const decileCounts = new Array(10).fill(0);
  for (const r of cond) {
    // Find the decile bucket: first cut strictly greater than r.
    let bucket = 0;
    while (bucket < 9 && r > cuts[bucket]!) bucket++;
    decileCounts[bucket]++;
  }
  const expected = nc / 10;
  let Q = 0;
  for (let j = 0; j < 10; j++) {
    const diff = decileCounts[j]! - expected;
    Q += (diff * diff) / expected;
  }
  const chiPValue = chiSquareSf(Q, 9);
  const decileFractions = decileCounts.map((c: number) => c / nc);

  // --- Two-sample Kolmogorov–Smirnov ---
  const sortedCond = [...cond].sort((a, b) => a - b);
  const pooled = [...new Set([...sortedCond, ...sortedUncond])].sort((a, b) => a - b);
  const ecdf = (sorted: number[], x: number): number => {
    // fraction of sorted ≤ x via binary search for the upper bound.
    let lo = 0;
    let hi = sorted.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (sorted[mid]! <= x) lo = mid + 1;
      else hi = mid;
    }
    return lo / sorted.length;
  };
  let supDiff = 0;
  for (const x of pooled) {
    const d = Math.abs(ecdf(sortedCond, x) - ecdf(sortedUncond, x));
    if (d > supDiff) supDiff = d;
  }
  const gamma = Math.sqrt((nc * nu) / (nc + nu)) * supDiff;
  const ksP = ksPValue(gamma);

  const informative = chiPValue < alpha || ksP < alpha;

  const summary =
    `Conditional (n=${nc}) vs unconditional (n=${nu}) return distribution: ` +
    `χ²₉ Q=${Q.toFixed(2)} (p=${chiPValue.toFixed(4)}), ` +
    `KS γ=${gamma.toFixed(3)} (p=${ksP.toFixed(4)}). ` +
    (informative
      ? `INFORMATIVE at α=${alpha}: conditioning shifts the distribution.`
      : `Not distinguishable at α=${alpha}: no evidence the signal moves returns.`);

  return {
    nConditional: nc,
    nUnconditional: nu,
    chiSquare: {
      Q: parseFloat(Q.toFixed(6)),
      df: 9,
      pValue: parseFloat(chiPValue.toFixed(6)),
      decileCounts,
      decileFractions: decileFractions.map((f: number) => parseFloat(f.toFixed(4))),
    },
    ks: {
      supDiff: parseFloat(supDiff.toFixed(6)),
      gamma: parseFloat(gamma.toFixed(6)),
      pValue: parseFloat(ksP.toFixed(6)),
    },
    informative,
    summary,
  };
}
