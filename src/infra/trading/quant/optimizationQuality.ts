/**
 * Optimization Quality Q-Statistic (GORDON_OPTIMIZATION_QUALITY).
 *
 * Tests whether the Sharpe-ratio improvement from parameter optimization
 * is statistically meaningful or just noise:
 *
 *   Q = (SR_opt − SR_base) / sqrt(SE²(SR_opt) + SE²(SR_base))
 *
 * where SE(SR) is Lo's standard error of the Sharpe ratio accounting
 * for skew and excess kurtosis (non-normal returns):
 *
 *   SE²(SR) = (1 − γ·SR + (κ−1)/4·SR²) / T
 *
 *   γ = skewness of returns
 *   κ = kurtosis of returns
 *   T = sample size
 *
 * Q is approximately N(0, 1) under the null hypothesis that the two
 * Sharpe ratios are equal. Q >> 1 → meaningful optimization; |Q| < 1
 * → indistinguishable from noise. This is essentially the Jobson-Korkie
 * test specialized to "before vs after optimization".
 *
 * Complements Gordon's existing `backtestCredibility.ts` which tests a
 * single Sharpe against a benchmark via PSR/DSR; this primitive tests
 * the *delta* between two strategies.
 *
 * Pure compute. No I/O.
 */

import { normalCdf } from "../../../core/numerics/index.ts";
import { skewness, kurtosis as excessKurtosis } from "../../../core/stats/index.ts";

export interface OptimizationQualityInput {
  /** Baseline strategy per-period returns (decimals, not %). */
  baselineReturns: ReadonlyArray<number>;
  /** Optimized strategy per-period returns. */
  optimizedReturns: ReadonlyArray<number>;
  /** Annualization factor (252 daily-stock, 365 crypto). Default 365. */
  periodsPerYear?: number;
  /** Q magnitude above which the improvement is "meaningful." Default 2.0 (~95%). */
  meaningfulThreshold?: number;
  /** Q magnitude above which the improvement is "strong." Default 3.0. */
  strongThreshold?: number;
}

export type OptimizationVerdict = "noise" | "meaningful" | "strong";

export interface OptimizationQualityResult {
  baselineSharpe: number;
  optimizedSharpe: number;
  deltaSharpe: number;
  baselineStdError: number;
  optimizedStdError: number;
  qStatistic: number;
  /** Two-sided approximate p-value under N(0,1). */
  pValue: number;
  verdict: OptimizationVerdict;
  baselineSampleSize: number;
  optimizedSampleSize: number;
  reasoning: string;
}

const DEFAULT_PERIODS_PER_YEAR = 365;
const DEFAULT_MEANINGFUL = 2.0;
const DEFAULT_STRONG = 3.0;

function mean(xs: ReadonlyArray<number>): number {
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stddev(xs: ReadonlyArray<number>): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / (xs.length - 1));
}

/** Non-excess (Pearson) kurtosis = excess kurtosis + 3; normal = 3. */
function kurtosis(xs: ReadonlyArray<number>): number {
  const arr = xs as number[];
  if (arr.length < 4) return 3;
  const _m = mean(arr);
  const s = stddev(arr);
  if (s === 0) return 3;
  return excessKurtosis(arr) + 3;
}

/**
 * Annualized Sharpe ratio with Lo standard error.
 */
function sharpeWithSE(
  returns: ReadonlyArray<number>,
  periodsPerYear: number,
): { sharpeAnnual: number; sePerPeriod: number; sharpePerPeriod: number } {
  if (returns.length < 2) {
    return { sharpeAnnual: 0, sePerPeriod: 0, sharpePerPeriod: 0 };
  }
  const m = mean(returns);
  const s = stddev(returns);
  if (s === 0) return { sharpeAnnual: 0, sePerPeriod: 0, sharpePerPeriod: 0 };
  const srPerPeriod = m / s;
  const sharpeAnnual = srPerPeriod * Math.sqrt(periodsPerYear);
  const skew = skewness(returns as number[]);
  const kurt = kurtosis(returns);
  // Lo (2002) standard error with non-normal correction.
  const varSr =
    (1 - skew * srPerPeriod + ((kurt - 1) / 4) * srPerPeriod * srPerPeriod) / returns.length;
  const sePerPeriod = Math.sqrt(Math.max(varSr, 0));
  return { sharpeAnnual, sePerPeriod, sharpePerPeriod: srPerPeriod };
}

function classify(q: number, meaningful: number, strong: number): OptimizationVerdict {
  const absQ = Math.abs(q);
  if (absQ >= strong) return "strong";
  if (absQ >= meaningful) return "meaningful";
  return "noise";
}

export function computeOptimizationQuality(
  input: OptimizationQualityInput,
): OptimizationQualityResult {
  const periodsPerYear = input.periodsPerYear ?? DEFAULT_PERIODS_PER_YEAR;
  const meaningful = input.meaningfulThreshold ?? DEFAULT_MEANINGFUL;
  const strong = input.strongThreshold ?? DEFAULT_STRONG;

  const baseline = sharpeWithSE(input.baselineReturns, periodsPerYear);
  const optimized = sharpeWithSE(input.optimizedReturns, periodsPerYear);

  const baselineSharpe = baseline.sharpeAnnual;
  const optimizedSharpe = optimized.sharpeAnnual;
  const deltaSharpe = optimizedSharpe - baselineSharpe;

  // Both SEs are per-period; the difference SE is sqrt(sum of variances).
  // Annualize the delta SE the same way as the Sharpes.
  const seDeltaPerPeriod = Math.sqrt(
    baseline.sePerPeriod * baseline.sePerPeriod + optimized.sePerPeriod * optimized.sePerPeriod,
  );
  const seDeltaAnnual = seDeltaPerPeriod * Math.sqrt(periodsPerYear);
  const qStatistic = seDeltaAnnual > 0 ? deltaSharpe / seDeltaAnnual : 0;
  const pValue = 2 * (1 - normalCdf(Math.abs(qStatistic)));
  const verdict = classify(qStatistic, meaningful, strong);

  const reasoning =
    `ΔSR=${deltaSharpe.toFixed(3)} (base=${baselineSharpe.toFixed(2)}, opt=${optimizedSharpe.toFixed(2)}); ` +
    `SE(Δ)=${seDeltaAnnual.toFixed(3)}; Q=${qStatistic.toFixed(2)} ` +
    `(|Q|≥${meaningful} meaningful, ≥${strong} strong) → ${verdict} (p=${pValue.toFixed(4)})`;

  return {
    baselineSharpe,
    optimizedSharpe,
    deltaSharpe,
    baselineStdError: baseline.sePerPeriod * Math.sqrt(periodsPerYear),
    optimizedStdError: optimized.sePerPeriod * Math.sqrt(periodsPerYear),
    qStatistic,
    pValue,
    verdict,
    baselineSampleSize: input.baselineReturns.length,
    optimizedSampleSize: input.optimizedReturns.length,
    reasoning,
  };
}

export function optimizationQualityToPayload(
  result: OptimizationQualityResult,
): Record<string, unknown> {
  return {
    kind: "optimization_quality.computed",
    baselineSharpe: Number(result.baselineSharpe.toFixed(3)),
    optimizedSharpe: Number(result.optimizedSharpe.toFixed(3)),
    deltaSharpe: Number(result.deltaSharpe.toFixed(3)),
    qStatistic: Number(result.qStatistic.toFixed(3)),
    pValue: Number(result.pValue.toFixed(5)),
    verdict: result.verdict,
  };
}
