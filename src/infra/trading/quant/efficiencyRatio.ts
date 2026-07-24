/**
 * Efficiency Ratio (GORDON_EFFICIENCY_RATIO).
 *
 * Kaufman's noise/trend gauge (TSaM Ch 1, also building block for KAMA).
 *
 *   ER = |p[t] - p[t-n]| / Σ |p[i] - p[i-1]| for i in (t-n+1 .. t)
 *
 * ER → 1 when prices move monotonically in one direction (perfect trend).
 * ER → 0 when prices wander symmetrically (pure noise; random walk).
 * Intermediate values reflect partial trendiness with proportional noise.
 *
 * Complementary to Hurst exponent (which measures long-memory persistence)
 * and to PCA concentration (which measures cross-strategy factor loading).
 * Cleanest "is this window trendy?" gate Kaufman provides.
 */

export interface EfficiencyRatioInput {
  prices: ReadonlyArray<number>;
  /** Lookback period. Default 10. */
  period?: number;
  /** Threshold above which the window is classified as trending. Default 0.3. */
  trendingThreshold?: number;
  /** Threshold below which the window is classified as choppy. Default 0.1. */
  choppyThreshold?: number;
}

export type ErRegime = "choppy" | "mixed" | "trending";

export interface EfficiencyRatioResult {
  efficiencyRatio: number;
  netChange: number;
  pathLength: number;
  sampleSize: number;
  regime: ErRegime;
  reasoning: string;
}

const DEFAULT_PERIOD = 10;
const DEFAULT_TRENDING = 0.3;
const DEFAULT_CHOPPY = 0.1;

export function computeEfficiencyRatio(input: EfficiencyRatioInput): EfficiencyRatioResult {
  const period = input.period ?? DEFAULT_PERIOD;
  const trendingT = input.trendingThreshold ?? DEFAULT_TRENDING;
  const choppyT = input.choppyThreshold ?? DEFAULT_CHOPPY;
  const prices = input.prices;

  if (prices.length < period + 1) {
    return {
      efficiencyRatio: 0,
      netChange: 0,
      pathLength: 0,
      sampleSize: prices.length,
      regime: "choppy",
      reasoning: `need ${period + 1} prices, got ${prices.length}`,
    };
  }

  const window = prices.slice(-(period + 1));
  const netChange = Math.abs(window[window.length - 1]! - window[0]!);
  let pathLength = 0;
  for (let i = 1; i < window.length; i++) {
    pathLength += Math.abs(window[i]! - window[i - 1]!);
  }

  const er = pathLength > 0 ? netChange / pathLength : 0;

  let regime: ErRegime = "mixed";
  if (er >= trendingT) regime = "trending";
  else if (er < choppyT) regime = "choppy";

  const reasoning =
    regime === "trending"
      ? `ER ${er.toFixed(3)} ≥ ${trendingT} — directional move dominates noise`
      : regime === "choppy"
        ? `ER ${er.toFixed(3)} < ${choppyT} — noise dominates; mean-reversion preferred`
        : `ER ${er.toFixed(3)} — mixed regime, no strong directional bias`;

  return {
    efficiencyRatio: er,
    netChange,
    pathLength,
    sampleSize: period,
    regime,
    reasoning,
  };
}

export function efficiencyRatioToPayload(result: EfficiencyRatioResult): Record<string, unknown> {
  return {
    kind: "efficiency_ratio.computed",
    efficiencyRatio: Number(result.efficiencyRatio.toFixed(4)),
    regime: result.regime,
    sampleSize: result.sampleSize,
  };
}
