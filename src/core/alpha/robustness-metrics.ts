/**
 * Taguchi-style robustness metrics over a DISTRIBUTION of stress-test outcomes.
 *
 * The existing overfitting detector (`src/backtest/optimization/overfitting.ts`)
 * scores a SINGLE best/median ratio — "is the winning parameter set an
 * outlier?". This primitive is its complement: given the FULL distribution of a
 * performance metric (Sharpe, net return, …) across N stress runs — parameter
 * perturbations, walk-forward date windows, or noise/bootstrap injections — it
 * asks "how tightly clustered, and how survivable in the bad tail, is that
 * distribution?".
 *
 * Taguchi's robust-design lens: a strategy isn't good because its best run is
 * great; it's good because it stays acceptable under uncontrolled variation.
 * We read that off three ratios anchored on the 10th / 50th / 90th percentiles:
 *
 *   normalizedPercentileSpread = (p90 - p10) / (|median| + eps)   lower = tighter
 *   downsideRobustnessLoss     = (median - p10) / (|median| + eps) lower = less fragile
 *   survivalRatio              = p10 / (|median| + eps)            higher & >0 = bad tail still holds
 *
 * It does NOT run the stress tests — the operator supplies the outcome array
 * from a parameter sweep / walk-forward / synthetic-augment run.
 *
 * Percentile method: LINEAR INTERPOLATION between order statistics. For a sorted
 * array of length n and quantile q∈[0,1], rank = q·(n-1); the value is a linear
 * blend of the two bracketing order statistics (the "type-7" / numpy-default
 * convention). For q=0.5 on an even-length array this reduces to the usual
 * two-middle-element average.
 *
 * NULL-on-missing-input: returns null when fewer than MIN_OUTCOMES (5) finite
 * outcomes are present — percentiles on a tiny sample are noise, so we refuse
 * rather than fabricate. Never throws.
 *
 * Pure function. No I/O.
 */

export type RobustnessVerdict = "robust" | "moderate" | "fragile";

export interface RobustnessMetricsOptions {
  /**
   * Floor added to |median| in every denominator to keep ratios finite when
   * the median sits near zero. Default 1e-4.
   */
  eps?: number;
  /**
   * Direction of the metric. Default true: higher is better (Sharpe, total
   * return) — the bad tail is the LOW end (p10). Set false for metrics where
   * lower is better (max drawdown, turnover): the bad tail flips to the HIGH
   * end (p90), and the downside/survival reads are computed against p90.
   */
  higherIsBetter?: boolean;
}

export interface RobustnessMetricsResult {
  count: number;
  median: number;
  p10: number;
  p90: number;
  mean: number;
  min: number;
  max: number;
  /** (p90 - p10) / (|median| + eps). Lower = tighter = more robust. */
  normalizedPercentileSpread: number;
  /**
   * Fragility on the BAD side. Higher-is-better: (median - p10)/(|median|+eps).
   * Lower-is-better: (p90 - median)/(|median|+eps). Lower = less fragile.
   */
  downsideRobustnessLoss: number;
  /**
   * The bad-tail percentile relative to the median. Higher-is-better:
   * p10/(|median|+eps); lower-is-better: -p90/(|median|+eps) so that "positive
   * = the bad tail still looks acceptable" holds in both directions. >0 and
   * large = survivable.
   */
  survivalRatio: number;
  higherIsBetter: boolean;
  verdict: RobustnessVerdict;
  interpretation: string;
}

const MIN_OUTCOMES = 5;
const DEFAULT_EPS = 1e-4;

// ── Illustrative verdict thresholds ────────────────────────────────────────
// These are DEMONSTRATION defaults in the spirit of the Build-Alpha robustness
// write-up, NOT validated constants. Treat them as a starting point the
// operator should recalibrate per strategy class / metric — they are the
// knob, not the answer.
const ROBUST_SPREAD_MAX = 0.5;
const ROBUST_SURVIVAL_MIN = 0.5;
const FRAGILE_SPREAD_MIN = 1.5;
const FRAGILE_SURVIVAL_MAX = 0;

/**
 * Quantile via linear interpolation between order statistics (type-7).
 * `sorted` must be ascending and non-empty.
 */
function quantile(sorted: number[], q: number): number {
  const n = sorted.length;
  if (n === 1) return sorted[0]!;
  const rank = q * (n - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  const loVal = sorted[lo]!;
  if (lo === hi) return loVal;
  const hiVal = sorted[hi]!;
  const frac = rank - lo;
  return loVal + (hiVal - loVal) * frac;
}

function round(x: number, n: number): number {
  return parseFloat(x.toFixed(n));
}

export function computeRobustnessMetrics(
  outcomes: number[],
  options: RobustnessMetricsOptions = {},
): RobustnessMetricsResult | null {
  const eps = options.eps ?? DEFAULT_EPS;
  const higherIsBetter = options.higherIsBetter ?? true;

  const finite = outcomes.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (finite.length < MIN_OUTCOMES) return null;

  const sorted = [...finite].sort((a, b) => a - b);
  const n = sorted.length;

  const median = quantile(sorted, 0.5);
  const p10 = quantile(sorted, 0.1);
  const p90 = quantile(sorted, 0.9);
  const min = sorted[0]!;
  const max = sorted[n - 1]!;
  const mean = finite.reduce((s, x) => s + x, 0) / n;

  const denom = Math.abs(median) + eps;

  const normalizedPercentileSpread = (p90 - p10) / denom;

  // Bad tail: low end for higher-is-better, high end for lower-is-better.
  const downsideRobustnessLoss = higherIsBetter
    ? (median - p10) / denom
    : (p90 - median) / denom;

  // survivalRatio is signed so that "positive = bad tail still acceptable"
  // holds in both directions. Higher-is-better: a positive p10 (bad run still
  // makes money) → positive. Lower-is-better: a small p90 (bad run still has
  // low drawdown) → we negate p90 so low p90 reads as a high (good) ratio.
  const survivalRatio = higherIsBetter ? p10 / denom : -p90 / denom;

  let verdict: RobustnessVerdict;
  if (
    normalizedPercentileSpread < ROBUST_SPREAD_MAX &&
    survivalRatio > ROBUST_SURVIVAL_MIN
  ) {
    verdict = "robust";
  } else if (
    normalizedPercentileSpread > FRAGILE_SPREAD_MIN ||
    survivalRatio < FRAGILE_SURVIVAL_MAX
  ) {
    verdict = "fragile";
  } else {
    verdict = "moderate";
  }

  const dir = higherIsBetter ? "higher-is-better" : "lower-is-better";
  const verdictSentence =
    verdict === "robust"
      ? "ROBUST — outcomes cluster tightly and the bad tail still holds up under stress."
      : verdict === "fragile"
        ? "FRAGILE — the distribution is wide and/or the bad-tail run breaks down. Treat the headline result as fragile to uncontrolled variation."
        : "MODERATE — some dispersion or bad-tail erosion; acceptable but watch for regime sensitivity.";

  const interpretation =
    `${n} stress outcomes (${dir}): median ${round(median, 4)}, ` +
    `p10 ${round(p10, 4)} / p90 ${round(p90, 4)} (range ${round(min, 4)}–${round(max, 4)}). ` +
    `Spread ${round(normalizedPercentileSpread, 3)}×median, ` +
    `downside loss ${round(downsideRobustnessLoss, 3)}, ` +
    `survival ${round(survivalRatio, 3)}. ${verdictSentence}`;

  return {
    count: n,
    median: round(median, 6),
    p10: round(p10, 6),
    p90: round(p90, 6),
    mean: round(mean, 6),
    min: round(min, 6),
    max: round(max, 6),
    normalizedPercentileSpread: round(normalizedPercentileSpread, 4),
    downsideRobustnessLoss: round(downsideRobustnessLoss, 4),
    survivalRatio: round(survivalRatio, 4),
    higherIsBetter,
    verdict,
    interpretation,
  };
}
