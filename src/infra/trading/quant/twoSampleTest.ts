/**
 * Two-sample significance tests for stress-scenario PnL.
 *
 * Companion to the named-pathology stress injectors in
 * `src/core/alpha/syntheticAugmentation.ts`. Workflow: backtest a strategy on
 * a real candle series (baseline PnL), inject a named pathology (gaps / crash
 * blocks / flatline / vol stretch / reversed path), re-backtest (scenario
 * PnL), then ask: does scenario PnL differ SIGNIFICANTLY from baseline?
 *
 * This is a distinct robustness axis from `mcpt.ts`. MCPT asks "would noise
 * look this good?" against statistically-matched shuffles. This asks "did
 * THIS specific pathology move the PnL distribution?" — a location/shift test
 * between two concrete samples (per-trade or per-bar PnL vectors).
 *
 * Two tests:
 *   - pairedTTest: parametric, paired (equal-length, bar-aligned samples).
 *     p-value via the reused incomplete-beta Student-t CDF from
 *     linearRegression.ts.
 *   - mannWhitneyU: non-parametric rank-sum, tie-corrected normal
 *     approximation. Unpaired-safe; robust to the fat tails PnL distributions
 *     carry. Always run by twoSamplePnlTest.
 *
 * Pure compute. No I/O. Deterministic. NULL on insufficient input
 * (either sample < MIN_SAMPLE); never throws, never fabricates.
 */

import { studentTTwoSidedPValue } from "../../../core/indicators/linearRegression.ts";

/** Minimum per-sample size below which the tests are not meaningful. */
export const MIN_SAMPLE = 5;

export interface PairedTTestResult {
  /** Paired t-statistic = meanDiff / (sdDiff / sqrt(n)). */
  t: number;
  /** Degrees of freedom = n − 1. */
  df: number;
  /** Two-sided p-value under H0: mean paired difference = 0. */
  pValue: number;
  /** Mean of (a[i] − b[i]). */
  meanDiff: number;
}

export interface MannWhitneyResult {
  /** Mann-Whitney U statistic (the smaller of U_a, U_b is reported). */
  u: number;
  /** z-score of the tie-corrected normal approximation. */
  z: number;
  /** Two-sided p-value from the normal approximation. */
  pValue: number;
}

export interface TwoSamplePnlResult {
  /** Present only when baseline and scenario have equal length. */
  paired?: PairedTTestResult;
  /** Always present (Mann-Whitney is unpaired-safe). */
  mannWhitney: MannWhitneyResult;
  /** True iff either test's p-value < alpha. */
  significantlyDifferent: boolean;
  /** Human-readable verdict. */
  interpretation: string;
}

function isFiniteVector(v: unknown): v is number[] {
  return Array.isArray(v) && v.every((x) => typeof x === "number" && Number.isFinite(x));
}

/**
 * Paired two-sided t-test on equal-length samples. Returns null when lengths
 * differ, n < 2, inputs contain non-finite values, or the paired differences
 * have zero variance (t undefined).
 */
export function pairedTTest(a: number[], b: number[]): PairedTTestResult | null {
  if (!isFiniteVector(a) || !isFiniteVector(b)) return null;
  if (a.length !== b.length || a.length < 2) return null;
  const n = a.length;
  const diffs: number[] = new Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const d = a[i]! - b[i]!;
    diffs[i] = d;
    sum += d;
  }
  const meanDiff = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const dev = diffs[i]! - meanDiff;
    ss += dev * dev;
  }
  const variance = ss / (n - 1);
  if (variance <= 0) return null;
  const se = Math.sqrt(variance / n);
  if (se <= 0) return null;
  const t = meanDiff / se;
  const df = n - 1;
  const p = studentTTwoSidedPValue(t, df);
  if (p == null) return null;
  return {
    t: parseFloat(t.toFixed(4)),
    df,
    pValue: parseFloat(p.toFixed(6)),
    meanDiff: parseFloat(meanDiff.toFixed(6)),
  };
}

/** Standard normal two-sided survival: 2 * (1 - Φ(|z|)) via erf. */
function normalTwoSidedPValue(z: number): number {
  const az = Math.abs(z);
  // Abramowitz & Stegun 7.1.26 rational approximation for erf.
  const t = 1 / (1 + 0.3275911 * (az / Math.SQRT2));
  const erf =
    1 -
    (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t +
      0.254829592) *
      t *
      Math.exp(-(az / Math.SQRT2) * (az / Math.SQRT2));
  const phi = 0.5 * (1 + erf); // Φ(az)
  const p = 2 * (1 - phi);
  return Math.min(1, Math.max(0, p));
}

/**
 * Mann-Whitney U test (two-sided) with tie-corrected normal approximation.
 * Returns null when either sample is empty or contains non-finite values.
 *
 * U is reported as min(U_a, U_b). The z uses the continuity-uncorrected,
 * tie-adjusted variance:
 *   var = n1*n2/12 * [ (N+1) − Σ(t³−t) / (N(N−1)) ].
 */
export function mannWhitneyU(a: number[], b: number[]): MannWhitneyResult | null {
  if (!isFiniteVector(a) || !isFiniteVector(b)) return null;
  const n1 = a.length;
  const n2 = b.length;
  if (n1 < 1 || n2 < 1) return null;
  const N = n1 + n2;

  // Pool + rank with average ranks for ties.
  const pooled: Array<{ v: number; group: 0 | 1 }> = [];
  for (const v of a) pooled.push({ v, group: 0 });
  for (const v of b) pooled.push({ v, group: 1 });
  pooled.sort((x, y) => x.v - y.v);

  const ranks: number[] = new Array(N);
  const tieGroups: number[] = [];
  let i = 0;
  while (i < N) {
    let j = i;
    while (j + 1 < N && pooled[j + 1]!.v === pooled[i]!.v) j++;
    // Average rank for the tie group [i..j] (1-based ranks).
    const avgRank = (i + 1 + (j + 1)) / 2;
    for (let k = i; k <= j; k++) ranks[k] = avgRank;
    const groupSize = j - i + 1;
    if (groupSize > 1) tieGroups.push(groupSize);
    i = j + 1;
  }

  let rankSumA = 0;
  for (let k = 0; k < N; k++) {
    if (pooled[k]!.group === 0) rankSumA += ranks[k]!;
  }

  const uA = rankSumA - (n1 * (n1 + 1)) / 2;
  const uB = n1 * n2 - uA;
  const u = Math.min(uA, uB);

  const meanU = (n1 * n2) / 2;
  let tieCorrection = 0;
  for (const t of tieGroups) tieCorrection += t * t * t - t;
  const varU =
    ((n1 * n2) / 12) * (N + 1 - tieCorrection / (N * (N - 1)));

  let z = 0;
  let pValue = 1;
  if (varU > 0) {
    z = (uA - meanU) / Math.sqrt(varU);
    pValue = normalTwoSidedPValue(z);
  }

  return {
    u: parseFloat(u.toFixed(4)),
    z: parseFloat(z.toFixed(4)),
    pValue: parseFloat(pValue.toFixed(6)),
  };
}

/**
 * Run the full two-sample PnL comparison. Mann-Whitney always (unpaired-safe);
 * paired-t additionally when the two samples are equal length. Verdict:
 * significantlyDifferent iff EITHER test's p < alpha (default 0.05).
 *
 * Returns null when either sample has fewer than MIN_SAMPLE points or inputs
 * are non-finite.
 */
export function twoSamplePnlTest(input: {
  baseline: number[];
  scenario: number[];
  alpha?: number;
}): TwoSamplePnlResult | null {
  const baseline = input?.baseline;
  const scenario = input?.scenario;
  if (!isFiniteVector(baseline) || !isFiniteVector(scenario)) return null;
  if (baseline.length < MIN_SAMPLE || scenario.length < MIN_SAMPLE) return null;
  const alpha = Number.isFinite(input.alpha) && input.alpha! > 0 && input.alpha! < 1
    ? input.alpha!
    : 0.05;

  const mw = mannWhitneyU(baseline, scenario);
  if (mw == null) return null;

  const paired =
    baseline.length === scenario.length
      ? pairedTTest(baseline, scenario) ?? undefined
      : undefined;

  const mwSig = mw.pValue < alpha;
  const pairedSig = paired != null && paired.pValue < alpha;
  const significantlyDifferent = mwSig || pairedSig;

  const parts: string[] = [];
  parts.push(
    `Mann-Whitney U=${mw.u} (z=${mw.z}, p=${mw.pValue.toFixed(4)}) ` +
      `${mwSig ? "SIGNIFICANT" : "not significant"}`,
  );
  if (paired != null) {
    parts.push(
      `paired t=${paired.t} (df=${paired.df}, p=${paired.pValue.toFixed(4)}, ` +
        `meanDiff=${paired.meanDiff}) ${pairedSig ? "SIGNIFICANT" : "not significant"}`,
    );
  } else {
    parts.push("paired-t skipped (unequal sample lengths)");
  }
  const verdict = significantlyDifferent
    ? `Scenario PnL DIFFERS from baseline at α=${alpha} — the pathology materially changed results.`
    : `Scenario PnL is NOT distinguishable from baseline at α=${alpha} — strategy robust to this pathology.`;
  const interpretation = `${parts.join("; ")}. ${verdict}`;

  return { paired, mannWhitney: mw, significantlyDifferent, interpretation };
}
