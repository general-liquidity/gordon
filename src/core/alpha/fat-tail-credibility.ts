/**
 * Fat-Tail Credibility Adjuster — Hill tail-index estimator + Taleb's
 * sample-size correction for heavy-tailed return distributions.
 *
 * Premise (Taleb): the standard LLN-based credibility tests (PSR / DSR /
 * minTRL — already in Gordon as `backtestCredibility`) implicitly
 * assume sub-Gaussian tails. For fat-tailed return distributions
 * (α ≤ 2, where α is the power-law tail index), the LLN converges
 * dramatically slower and a Gaussian-derived minimum-sample-size is
 * an underestimate by 10× to 100× or more.
 *
 * This primitive estimates the tail index α via Hill's estimator,
 * classifies the distribution, and outputs a multiplier the caller
 * applies to any Gaussian-derived sample-size requirement (e.g.,
 * `backtestCredibility`'s minTRL).
 *
 * Hill estimator:
 *   Given absolute returns sorted descending |X|_(1) ≥ |X|_(2) ≥ …,
 *
 *   α̂(k) = 1 / [(1/k) Σ_{i=1}^{k} ln(|X|_(i)) - ln(|X|_(k+1))]
 *
 *   where k is the number of upper-order statistics used. We compute
 *   α̂ at multiple k values and report the median for stability.
 *   Standard error: α̂ / √k. 95% CI ≈ α̂ ± 1.96·α̂/√k.
 *
 * Sample-size multiplier (Taleb's rule of thumb):
 *   α > 3              → 1×          (effectively Gaussian)
 *   2.5 < α ≤ 3        → 2×
 *   2 < α ≤ 2.5        → 5×
 *   1.5 < α ≤ 2        → 10×
 *   1.2 < α ≤ 1.5      → 50×
 *   1 < α ≤ 1.2        → 500×
 *   α ≤ 1              → ∞           (no finite mean)
 *
 * Distinct from:
 *   - `infra/trading/ops/backtestCredibility.ts`  (PSR / DSR / minTRL /
 *     CPCV — assumes Gaussian-derived inference; this primitive supplies
 *     the multiplier that corrects minTRL for heavy tails)
 *   - `loSharpeCorrection.ts`              (autocorrelation-adjusted Sharpe;
 *                                            orthogonal correction axis)
 *   - `tail-conditional-hedge.ts`          (hedging tail events, not
 *                                            estimating tail thickness)
 *
 * Composes with:
 *   - `backtestCredibility` minTRL  multiply by this primitive's
 *                                   `sampleSizeMultiplier` for the fat-
 *                                   tail-aware minimum-sample-size
 *
 * Pure compute. Pedigree: Hill (1975); Taleb's *The Black Swan* +
 * *Statistical Consequences of Fat Tails*; algo trader 2026 LLN video.
 */

export interface FatTailCredibilityInput {
  /** Return series (any units; absolute values used for tail estimation). */
  returns: ReadonlyArray<number>;
  /**
   * Fraction of upper-order statistics to use as the PRIMARY Hill k.
   * Default 0.10 (top 10%). Hill is sensitive to k; we also report a
   * range using kFractionGrid for stability assessment.
   */
  kFraction?: number;
  /**
   * Additional k fractions used to compute Hill α̂ over a grid; the
   * MEDIAN is reported as the primary estimate. Default [0.05, 0.075,
   * 0.10, 0.15, 0.20].
   */
  kFractionGrid?: ReadonlyArray<number>;
  /**
   * Minimum sample size. Below this returns insufficient_data.
   * Default 50 (Hill needs reasonable sample for any signal).
   */
  minSampleSize?: number;
  /**
   * Gaussian-derived minimum sample requirement supplied by the caller
   * (e.g., from backtestCredibility's minTRL). When provided, this
   * primitive outputs the fat-tail-adjusted equivalent. Optional.
   */
  baselineGaussianSampleSize?: number;
}

export type FatTailClass =
  | "gaussian_like"
  | "moderately_heavy"
  | "heavy_tailed"
  | "very_heavy_tailed"
  | "extreme_heavy_tailed"
  | "insufficient_data";

export interface HillEstimatePoint {
  kFraction: number;
  k: number;
  alpha: number;
}

export interface FatTailCredibilityResult {
  sampleSize: number;
  /** Number of non-zero absolute returns actually used. */
  effectiveSampleSize: number;
  /** Median Hill α̂ across kFractionGrid. */
  tailIndex: number;
  /** Standard error of the primary Hill estimate. */
  tailIndexStdError: number;
  /** Approximate 95% CI for tail index. */
  tailIndexCI: { low: number; high: number };
  /** Hill α̂ at each k fraction in the grid. */
  perK: HillEstimatePoint[];
  /** Min / max across grid — narrow range = more reliable estimate. */
  tailIndexRange: { min: number; max: number };
  fatTailClass: FatTailClass;
  /**
   * Multiplier to apply to a Gaussian-derived minimum-sample-size
   * (e.g., backtestCredibility's minTRL) to account for heavy tails.
   * Infinity when α ≤ 1 (no finite mean → LLN does not converge).
   */
  sampleSizeMultiplier: number;
  /**
   * If caller supplied baselineGaussianSampleSize, the fat-tail-adjusted
   * minimum sample size: baseline × multiplier.
   */
  adjustedMinimumSampleSize: number | null;
  summary: string;
}

const DEFAULT_K_FRACTION = 0.1;
const DEFAULT_K_GRID = [0.05, 0.075, 0.1, 0.15, 0.2] as const;
const DEFAULT_MIN_SAMPLE = 50;

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function hillEstimate(sortedDescAbs: ReadonlyArray<number>, k: number): number {
  // α̂(k) = 1 / [ (1/k) Σ_{i=1}^{k} ln(X_(i)) − ln(X_(k+1)) ]
  if (k < 2 || k >= sortedDescAbs.length) return NaN;
  const xKPlus1 = sortedDescAbs[k];
  if (xKPlus1 === undefined || xKPlus1 <= 0) return NaN;
  const lnRef = Math.log(xKPlus1);
  let sum = 0;
  for (let i = 0; i < k; i++) {
    const v = sortedDescAbs[i]!;
    if (v <= 0) return NaN;
    sum += Math.log(v) - lnRef;
  }
  const meanLogExcess = sum / k;
  if (meanLogExcess <= 0) return NaN;
  return 1 / meanLogExcess;
}

function classify(alpha: number): FatTailClass {
  if (!Number.isFinite(alpha) || alpha <= 0) return "insufficient_data";
  if (alpha > 3) return "gaussian_like";
  if (alpha > 2) return "moderately_heavy";
  if (alpha > 1.5) return "heavy_tailed";
  if (alpha > 1) return "very_heavy_tailed";
  return "extreme_heavy_tailed";
}

function multiplierFor(alpha: number): number {
  if (!Number.isFinite(alpha) || alpha <= 0) return Infinity;
  if (alpha > 3) return 1;
  if (alpha > 2.5) return 2;
  if (alpha > 2) return 5;
  if (alpha > 1.5) return 10;
  if (alpha > 1.2) return 50;
  if (alpha > 1) return 500;
  return Infinity;
}

function insufficient(reason: string, n: number): FatTailCredibilityResult {
  return {
    sampleSize: n,
    effectiveSampleSize: 0,
    tailIndex: 0,
    tailIndexStdError: 0,
    tailIndexCI: { low: 0, high: 0 },
    perK: [],
    tailIndexRange: { min: 0, max: 0 },
    fatTailClass: "insufficient_data",
    sampleSizeMultiplier: 1,
    adjustedMinimumSampleSize: null,
    summary: reason,
  };
}

export function estimateFatTailCredibility(
  input: FatTailCredibilityInput,
): FatTailCredibilityResult {
  const minSample = input.minSampleSize ?? DEFAULT_MIN_SAMPLE;
  const primaryFrac = input.kFraction ?? DEFAULT_K_FRACTION;
  const grid =
    input.kFractionGrid && input.kFractionGrid.length > 0 ? input.kFractionGrid : DEFAULT_K_GRID;

  if (input.returns.length < minSample) {
    return insufficient(
      `Sample size ${input.returns.length} < ${minSample}.`,
      input.returns.length,
    );
  }

  // Take absolute values, drop zeros (log undefined), sort descending
  const abs = input.returns
    .map((r) => Math.abs(r))
    .filter((v) => v > 0)
    .sort((a, b) => b - a);
  if (abs.length < minSample) {
    return insufficient(`Non-zero sample size ${abs.length} < ${minSample}.`, input.returns.length);
  }

  // Compute Hill α̂ across grid
  const perK: HillEstimatePoint[] = [];
  for (const frac of grid) {
    const k = Math.max(2, Math.floor(abs.length * frac));
    if (k >= abs.length) continue;
    const alpha = hillEstimate(abs, k);
    if (Number.isFinite(alpha)) {
      perK.push({
        kFraction: frac,
        k,
        alpha: parseFloat(alpha.toFixed(6)),
      });
    }
  }

  if (perK.length === 0) {
    return insufficient(
      "Hill estimator produced no valid estimates (degenerate tail).",
      input.returns.length,
    );
  }

  // Primary estimate: median across grid (more robust than picking a single k)
  const alphas = perK.map((p) => p.alpha);
  const tailIndex = median(alphas);

  // Standard error using primary k
  const primaryK = Math.max(2, Math.floor(abs.length * primaryFrac));
  const stdError = primaryK > 0 ? tailIndex / Math.sqrt(primaryK) : 0;
  const ciLow = Math.max(0, tailIndex - 1.96 * stdError);
  const ciHigh = tailIndex + 1.96 * stdError;

  const range = {
    min: Math.min(...alphas),
    max: Math.max(...alphas),
  };

  const fatTailClass = classify(tailIndex);
  const multiplier = multiplierFor(tailIndex);

  const adjusted =
    input.baselineGaussianSampleSize !== undefined
      ? Number.isFinite(multiplier)
        ? Math.round(input.baselineGaussianSampleSize * multiplier)
        : Infinity
      : null;

  const summary =
    fatTailClass === "gaussian_like"
      ? `Tail index α=${tailIndex.toFixed(2)} > 3 → Gaussian-like. No sample-size correction needed.`
      : fatTailClass === "moderately_heavy"
        ? `Tail index α=${tailIndex.toFixed(2)} → moderately heavy. Multiply Gaussian-derived sample-size by ${multiplier}×.`
        : fatTailClass === "heavy_tailed"
          ? `HEAVY TAILS — α=${tailIndex.toFixed(2)}. Multiply Gaussian-derived sample-size by ${multiplier}×. Standard credibility tests UNDERESTIMATE required samples.`
          : fatTailClass === "very_heavy_tailed"
            ? `VERY HEAVY TAILS — α=${tailIndex.toFixed(2)}. Multiply by ${multiplier}×. LLN convergence is dramatically slowed.`
            : fatTailClass === "extreme_heavy_tailed"
              ? `EXTREME HEAVY TAILS — α=${tailIndex.toFixed(2)} ≤ 1. No finite mean; LLN does not converge. Backtest credibility cannot be established.`
              : `Insufficient data.`;

  return {
    sampleSize: input.returns.length,
    effectiveSampleSize: abs.length,
    tailIndex: parseFloat(tailIndex.toFixed(6)),
    tailIndexStdError: parseFloat(stdError.toFixed(6)),
    tailIndexCI: {
      low: parseFloat(ciLow.toFixed(6)),
      high: parseFloat(ciHigh.toFixed(6)),
    },
    perK,
    tailIndexRange: {
      min: parseFloat(range.min.toFixed(6)),
      max: parseFloat(range.max.toFixed(6)),
    },
    fatTailClass,
    sampleSizeMultiplier: Number.isFinite(multiplier) ? multiplier : Infinity,
    adjustedMinimumSampleSize: adjusted,
    summary,
  };
}

export function formatFatTailCredibility(result: FatTailCredibilityResult): string {
  const lines = [
    `Fat-Tail Credibility — ${result.fatTailClass.toUpperCase()}`,
    "",
    `  Sample size:               ${result.sampleSize}`,
    `  Effective (non-zero):      ${result.effectiveSampleSize}`,
    `  Tail index α (median):     ${result.tailIndex.toFixed(3)}`,
    `  Stderr / 95% CI:           ±${result.tailIndexStdError.toFixed(3)}  [${result.tailIndexCI.low.toFixed(2)}, ${result.tailIndexCI.high.toFixed(2)}]`,
    `  α range across k grid:     [${result.tailIndexRange.min.toFixed(2)}, ${result.tailIndexRange.max.toFixed(2)}]`,
    `  Sample-size multiplier:    ${result.sampleSizeMultiplier === Infinity ? "∞ (LLN does not converge)" : `${result.sampleSizeMultiplier}×`}`,
    `  Adjusted min sample size:  ${result.adjustedMinimumSampleSize === null ? "n/a (no baseline supplied)" : result.adjustedMinimumSampleSize === Infinity ? "∞" : String(result.adjustedMinimumSampleSize)}`,
  ];
  if (result.perK.length > 0) {
    lines.push("");
    lines.push(`  Per-k α̂:`);
    for (const p of result.perK) {
      lines.push(
        `    k=${p.k.toString().padStart(4)} (${(p.kFraction * 100).toFixed(1)}%): α̂=${p.alpha.toFixed(3)}`,
      );
    }
  }
  lines.push("");
  lines.push(`Summary: ${result.summary}`);
  return lines.join("\n");
}
