/**
 * RSRS — Resistance-Support Relative Strength (阻力支撑相对强度).
 *
 * A regime/timing signal built from the slope of the daily high-on-low
 * OLS regression over a rolling window:
 *
 *   highᵢ = α + β·lowᵢ   (OLS over the last N bars)
 *
 * The slope β measures how strongly the day's high extends for a given
 * low. When demand dominates (support is strong), highs stretch up
 * faster than lows fall and β rises; when supply dominates (resistance
 * is strong), β falls. β alone is scale-free but noisy, so RSRS
 * standardises it against its own recent distribution:
 *
 *   standardized = (β − mean_M(β)) / std_M(β)         (z-score over M bars)
 *   modified     = standardized × R²                  (down-weight low-fit fits)
 *   right        = modified × β                       ("right-skewed" score —
 *                                                       restores slope level/sign)
 *
 * The standardized score is the canonical timing line: cross above
 * +buyThreshold = demand regime (long), below −sellThreshold = supply
 * regime (exit/short). The R²-modified and right-skewed variants reduce
 * whipsaw by discounting periods where the high-low relationship is
 * weakly linear.
 *
 * Distinct from ADX (no direction, trend strength only), the efficiency
 * ratio (path efficiency), and the regime classifier (state labels):
 * RSRS reads the *support/resistance balance* from the intrabar
 * high-low geometry, which none of those capture.
 */

import { linearRegression, rSquared, mean as statsMean, sampleStd } from "../stats/index.ts";

export interface Candle {
  high: number;
  low: number;
}

export type RsrsVerdict = "demand" | "lean_demand" | "neutral" | "lean_supply" | "supply";

export interface RsrsResult {
  /** Latest raw OLS slope β of high-on-low over the slope window. */
  beta: number | null;
  /** R² of that regression ∈ [0, 1]. */
  rSquared: number | null;
  /** Z-scored β over the standardization window. The canonical timing line. */
  standardizedRsrs: number | null;
  /** standardizedRsrs × R² — discounts weakly-linear windows. */
  modifiedRsrs: number | null;
  /** modifiedRsrs × β — the "right-skewed" score (restores slope level). */
  rightRsrs: number | null;
  slopeWindow: number;
  zWindow: number;
  sampleSize: number;
  verdict: RsrsVerdict;
  interpretation: string;
}

export interface RsrsOptions {
  /** OLS window for the high-on-low slope. Default 18. */
  slopeWindow?: number;
  /** Window for z-scoring the slope series. Default 250. */
  zWindow?: number;
  /** standardized ≥ this = demand regime. Default 0.7. */
  buyThreshold?: number;
  /** standardized ≤ −this = supply regime. Default 0.7. */
  sellThreshold?: number;
}

const DEFAULT_SLOPE_WINDOW = 18;
const DEFAULT_Z_WINDOW = 250;
const DEFAULT_BUY = 0.7;
const DEFAULT_SELL = 0.7;

function round(x: number, n = 6): number {
  return Number(x.toFixed(n));
}

function neutral(
  slopeWindow: number,
  zWindow: number,
  sampleSize: number,
  why: string,
): RsrsResult {
  return {
    beta: null,
    rSquared: null,
    standardizedRsrs: null,
    modifiedRsrs: null,
    rightRsrs: null,
    slopeWindow,
    zWindow,
    sampleSize,
    verdict: "neutral",
    interpretation: `Neutral — ${why}.`,
  };
}

/** OLS slope + R² of y on x over equal-length arrays. Returns null if x has no variance. */
function olsSlopeR2(x: number[], y: number[]): { beta: number; r2: number } | null {
  const n = x.length;
  if (n < 2) return null;

  const meanX = statsMean(x);
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i]! - meanX;
    sxx += dx * dx;
  }
  if (sxx < 1e-300) return null;

  const beta = linearRegression(x, y).slope;
  const r2 = rSquared(x, y);
  return { beta, r2 };
}

export function calculateRsrs(
  candles: ReadonlyArray<Candle>,
  options: RsrsOptions = {},
): RsrsResult {
  const slopeWindow = options.slopeWindow ?? DEFAULT_SLOPE_WINDOW;
  const zWindow = options.zWindow ?? DEFAULT_Z_WINDOW;
  const buy = options.buyThreshold ?? DEFAULT_BUY;
  const sell = options.sellThreshold ?? DEFAULT_SELL;

  const valid = candles.filter((c) => Number.isFinite(c.high) && Number.isFinite(c.low));
  const n = valid.length;
  if (slopeWindow < 2) return neutral(slopeWindow, zWindow, n, "slopeWindow must be ≥ 2");
  if (n < slopeWindow) {
    return neutral(slopeWindow, zWindow, n, `need ≥ slopeWindow (${slopeWindow}) bars, got ${n}`);
  }

  // Rolling β series: one slope per window-end from index slopeWindow-1 onward.
  const betas: number[] = [];
  let lastR2 = 0;
  for (let end = slopeWindow - 1; end < n; end++) {
    const lows: number[] = [];
    const highs: number[] = [];
    for (let i = end - slopeWindow + 1; i <= end; i++) {
      lows.push(valid[i]!.low);
      highs.push(valid[i]!.high);
    }
    const fit = olsSlopeR2(lows, highs);
    if (fit == null) {
      betas.push(betas.length > 0 ? betas[betas.length - 1]! : 0);
      continue;
    }
    betas.push(fit.beta);
    lastR2 = fit.r2;
  }

  const beta = betas[betas.length - 1]!;

  // Z-score the latest β over the trailing zWindow of the β series.
  const zSlice = betas.slice(-zWindow);
  let standardized: number | null = null;
  if (zSlice.length >= 2) {
    const mean = statsMean(zSlice);
    const std = sampleStd(zSlice);
    if (std > 1e-300) standardized = (beta - mean) / std;
  }

  if (standardized == null) {
    return {
      beta: round(beta),
      rSquared: round(lastR2),
      standardizedRsrs: null,
      modifiedRsrs: null,
      rightRsrs: null,
      slopeWindow,
      zWindow,
      sampleSize: n,
      verdict: "neutral",
      interpretation:
        `RSRS slope β=${round(beta, 4)} (R²=${round(lastR2, 3)}) but only ${zSlice.length} ` +
        `slope samples — need a longer history to standardize.`,
    };
  }

  const modified = standardized * lastR2;
  const right = modified * beta;

  let verdict: RsrsVerdict;
  if (standardized >= buy) verdict = "demand";
  else if (standardized >= buy / 2) verdict = "lean_demand";
  else if (standardized <= -sell) verdict = "supply";
  else if (standardized <= -sell / 2) verdict = "lean_supply";
  else verdict = "neutral";

  const verdictNote: Record<RsrsVerdict, string> = {
    demand: "support-led (demand regime) — highs extending; trend-follow long bias",
    lean_demand: "mild demand tilt",
    neutral: "balanced support/resistance",
    lean_supply: "mild supply tilt",
    supply: "resistance-led (supply regime) — highs capped; exit/short bias",
  };

  const interpretation =
    `RSRS standardized ${standardized >= 0 ? "+" : ""}${round(standardized, 3)} ` +
    `(β=${round(beta, 4)}, R²=${round(lastR2, 3)}, modified ${round(modified, 3)}) → ${verdictNote[verdict]}.`;

  return {
    beta: round(beta),
    rSquared: round(lastR2),
    standardizedRsrs: round(standardized),
    modifiedRsrs: round(modified),
    rightRsrs: round(right),
    slopeWindow,
    zWindow,
    sampleSize: n,
    verdict,
    interpretation,
  };
}
