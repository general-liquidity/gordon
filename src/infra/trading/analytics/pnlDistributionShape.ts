/**
 * P&L Distribution Shape — convexity-aware portfolio diagnostic.
 *
 * Inspired by the options-trading framing of "long convexity" (lose
 * little frequently, win a lot rarely) vs "short convexity" (win
 * little frequently, blow up rarely). The concept applies to ANY
 * strategy's P&L distribution, options or not.
 *
 * Trend-following tends to be long convexity (positive skew).
 * Mean-reversion tends to be short convexity (negative skew).
 * The operator's intent and the realized distribution often diverge —
 * a strategy *meant* to be trend-following can show short-convexity
 * P&L if stops are too tight, or if entries are early.
 *
 * Surfaced as a single metric in `/weekend-review` and friends. Not
 * a signal generator — a diagnostic that tells the operator what kind
 * of distribution they're actually running, regardless of label.
 *
 * Math:
 *   - mean, stddev (population, n divisor)
 *   - skewness (third standardized moment, Pearson's formula)
 *   - kurtosis (fourth standardized moment; reported as EXCESS kurtosis
 *     i.e. minus 3 so Normal distribution = 0)
 *
 * NB: Gordon already has private skewness/kurtosis helpers in four
 * other files (strategy-claim-verifier, tailRisk, optimizationQuality,
 * backtestCredibility). Not consolidating in this commit — each is
 * specialized to its caller's data shape. Future refactor candidate.
 */

export type ConvexityVerdict =
  | "long_convexity"
  | "short_convexity"
  | "symmetric"
  | "insufficient_data";

export interface PnlDistributionShape {
  /** Number of P&L observations. */
  count: number;
  /** Arithmetic mean. */
  mean: number;
  /** Population standard deviation (n divisor). */
  stddev: number;
  /**
   * Pearson's skewness (third standardized moment). Positive = right
   * tail heavier than left (long convexity). Negative = left tail
   * heavier (short convexity). 0 = symmetric.
   */
  skewness: number;
  /**
   * EXCESS kurtosis (fourth standardized moment minus 3). Positive
   * = heavier tails than Normal. 0 = Normal. Negative = lighter tails.
   * Reported separately from skewness so callers can distinguish
   * "fat-tailed long convexity" (skew > 0, kurt > 0 → great) from
   * "fat-tailed short convexity" (skew < 0, kurt > 0 → blow-up risk).
   */
  excessKurtosis: number;
  /**
   * Portfolio convexity verdict derived from skewness + count gate.
   * `insufficient_data` is returned when count < 10 because the
   * standardized-moment formulas are noisy on tiny samples.
   */
  verdict: ConvexityVerdict;
  /** Minimum P&L observation. */
  min: number;
  /** Maximum P&L observation. */
  max: number;
}

const INSUFFICIENT_DATA_THRESHOLD = 10;

/**
 * Skewness magnitude considered "meaningfully" away from symmetric.
 * Below this in absolute value, the verdict is "symmetric" rather
 * than long/short convexity. 0.25 is a soft threshold — large enough
 * to avoid noise on small samples, small enough to catch real skew.
 */
const SKEWNESS_VERDICT_THRESHOLD = 0.25;

function mean(values: ReadonlyArray<number>): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

function stddev(values: ReadonlyArray<number>, m: number): number {
  if (values.length === 0) return 0;
  let sumSq = 0;
  for (const v of values) {
    const d = v - m;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
}

function skewnessOf(values: ReadonlyArray<number>, m: number, s: number): number {
  if (values.length === 0 || s === 0) return 0;
  let sum = 0;
  for (const v of values) {
    const z = (v - m) / s;
    sum += z * z * z;
  }
  return sum / values.length;
}

function excessKurtosisOf(values: ReadonlyArray<number>, m: number, s: number): number {
  if (values.length === 0 || s === 0) return 0;
  let sum = 0;
  for (const v of values) {
    const z = (v - m) / s;
    sum += z * z * z * z;
  }
  return sum / values.length - 3;
}

/**
 * Compute the shape of a P&L distribution from realized trade P&Ls.
 *
 * Input units don't matter (USD, % return, basis points) — output is
 * scale-invariant on skewness/kurtosis. Mean/stddev/min/max carry the
 * input units.
 */
export function computePnlDistributionShape(pnls: ReadonlyArray<number>): PnlDistributionShape {
  const count = pnls.length;
  if (count === 0) {
    return {
      count: 0,
      mean: 0,
      stddev: 0,
      skewness: 0,
      excessKurtosis: 0,
      verdict: "insufficient_data",
      min: 0,
      max: 0,
    };
  }
  const m = mean(pnls);
  const s = stddev(pnls, m);
  const sk = skewnessOf(pnls, m, s);
  const ek = excessKurtosisOf(pnls, m, s);

  let lo = pnls[0]!;
  let hi = pnls[0]!;
  for (const v of pnls) {
    if (v < lo) lo = v;
    if (v > hi) hi = v;
  }

  const verdict: ConvexityVerdict =
    count < INSUFFICIENT_DATA_THRESHOLD
      ? "insufficient_data"
      : sk > SKEWNESS_VERDICT_THRESHOLD
        ? "long_convexity"
        : sk < -SKEWNESS_VERDICT_THRESHOLD
          ? "short_convexity"
          : "symmetric";

  return {
    count,
    mean: m,
    stddev: s,
    skewness: sk,
    excessKurtosis: ek,
    verdict,
    min: lo,
    max: hi,
  };
}

/**
 * One-line operator summary for /weekend-review.
 *
 * Example output:
 *   "P&L shape: 47 trades, mean=+0.42%, skew=+0.81 → long convexity
 *    (right tail heavier); excess-kurt=+1.2 (fat-tailed)."
 */
export function summarizePnlDistributionShape(shape: PnlDistributionShape): string {
  if (shape.verdict === "insufficient_data") {
    return `P&L shape: ${shape.count} trade${shape.count === 1 ? "" : "s"} — not enough data for distribution shape (need ${INSUFFICIENT_DATA_THRESHOLD}+).`;
  }

  const sign = shape.mean >= 0 ? "+" : "";
  const skewSign = shape.skewness >= 0 ? "+" : "";
  const ekSign = shape.excessKurtosis >= 0 ? "+" : "";

  const verdictText =
    shape.verdict === "long_convexity"
      ? "long convexity (right tail heavier — trend-following / momentum shape)"
      : shape.verdict === "short_convexity"
        ? "short convexity (left tail heavier — mean-reversion / blow-up shape)"
        : "symmetric (no significant skew)";

  const tailText =
    shape.excessKurtosis > 1
      ? "fat-tailed"
      : shape.excessKurtosis < -1
        ? "thin-tailed"
        : "near-Normal";

  return [
    `P&L shape: ${shape.count} trades,`,
    `mean=${sign}${shape.mean.toFixed(4)},`,
    `skew=${skewSign}${shape.skewness.toFixed(2)} →`,
    `${verdictText};`,
    `excess-kurt=${ekSign}${shape.excessKurtosis.toFixed(2)} (${tailText}).`,
  ].join(" ");
}
