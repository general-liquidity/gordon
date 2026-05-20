/**
 * Trendline Detection — TL1.
 *
 * Computes upper and lower trendlines for a price series using one of:
 *   - "peel_off" (default): iteratively fit OLS through the series,
 *     drop bars on the wrong side of the line, refit until the
 *     remaining set is stable or hits minInliers. The retained
 *     points form an envelope; the regression through them is the
 *     trendline. Inspired by Moon Dev's indicators_26 flag-
 *     continuation technique but fixed to use the same series for
 *     fit *and* intercept (the original mixed highs for the peel-
 *     off iterations and closes for the final fit, which is
 *     inconsistent).
 *   - "ols": plain ordinary-least-squares fit on the highs/lows.
 *     Returns the "general trend" best-fit line, not an envelope.
 *     Use for slope-as-state inputs to regime detectors.
 *
 * Why not RANSAC: trendlines are an *envelope* problem, not a
 * robust-fit problem. RANSAC finds a line most points lie on; the
 * trendline is the line all points lie above (lower) or below
 * (upper). Peel-off enforces the envelope constraint by construction.
 *
 * Plausible consumers (none wired):
 *   - chartTools VLM analysis: overlay computed trendlines so the
 *     VLM sees structural slope/resistance, not just candles
 *   - strategyEdgeThesis (ET1): theses like "breakout above 14-day
 *     resistance trendline" need a computable reference line
 *   - levelFreshness (LV2): horizontal-level freshness extends to
 *     sloped trendlines naturally
 *   - timeBasedExit (TM2): exit when price returns to a regression-
 *     derived trendline
 *   - regime detector / marketProfile: trendline slope as a state
 *     feature
 *
 * Pure compute. O(N · iterations) where iterations ≤ N / minInliers
 * in the worst case (typically 3-10 in practice).
 */

export const TRENDLINE_DETECTION_FLAG_ENV = "GORDON_TRENDLINE_DETECTION";

export function isTrendlineDetectionEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[TRENDLINE_DETECTION_FLAG_ENV] === "1" || env[TRENDLINE_DETECTION_FLAG_ENV] === "true";
}

export type TrendlineMethod = "peel_off" | "ols";
export type TrendlineSide = "upper" | "lower";

export interface PriceBar {
  high: number;
  low: number;
}

export interface TrendlineFit {
  side: TrendlineSide;
  /** Δprice per bar. Positive = rising. */
  slope: number;
  /** Line value at bar index 0. */
  intercept: number;
  /** Explained variance of the inlier set. In [0, 1]. */
  rSquared: number;
  /** Bars retained after envelope peel-off (peel_off) or full set (ols). */
  nInliers: number;
  /** Bars where |price − line| ≤ touchTolerance · |line|. */
  touchCount: number;
  /** Line value at index 0. Same as intercept; kept for symmetry. */
  startValue: number;
  /** Line value at index nBars − 1. */
  endValue: number;
}

export interface TrendlineDetectionInput {
  bars: ReadonlyArray<PriceBar>;
  /** Default "peel_off". */
  method?: TrendlineMethod;
  /** Peel-off termination floor. Default 3. */
  minInliers?: number;
  /** Relative tolerance for touch counting. Default 0.002 (0.2%). */
  touchTolerance?: number;
}

export interface TrendlineDetectionResult {
  upper: TrendlineFit;
  lower: TrendlineFit;
  method: TrendlineMethod;
  nBars: number;
  reasoning: string;
}

interface OLSResult {
  slope: number;
  intercept: number;
  rSquared: number;
}

function ols(xs: ReadonlyArray<number>, ys: ReadonlyArray<number>): OLSResult {
  const n = xs.length;
  if (n < 2) {
    throw new Error("ols requires at least 2 points");
  }
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  let sumXY = 0;
  let sumYY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sumX += x;
    sumY += y;
    sumXX += x * x;
    sumXY += x * y;
    sumYY += y * y;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const denom = sumXX - n * meanX * meanX;
  if (Math.abs(denom) < 1e-12) {
    return { slope: 0, intercept: meanY, rSquared: 0 };
  }
  const slope = (sumXY - n * meanX * meanY) / denom;
  const intercept = meanY - slope * meanX;
  const ssTot = sumYY - n * meanY * meanY;
  if (Math.abs(ssTot) < 1e-12) {
    return { slope, intercept, rSquared: 1 };
  }
  const ssRes = sumYY - intercept * sumY - slope * sumXY;
  const rSquared = 1 - ssRes / ssTot;
  return {
    slope,
    intercept,
    rSquared: Math.max(0, Math.min(1, rSquared)),
  };
}

function peelOffFit(
  values: ReadonlyArray<number>,
  side: TrendlineSide,
  minInliers: number,
): { slope: number; intercept: number; rSquared: number; nInliers: number } {
  let activeIdx: number[] = values.map((_, i) => i);

  while (activeIdx.length > minInliers) {
    const ax = activeIdx;
    const ay = activeIdx.map((i) => values[i]!);
    const fit = ols(ax, ay);
    const newActive = activeIdx.filter((i) => {
      const lineY = fit.slope * i + fit.intercept;
      return side === "upper" ? values[i]! >= lineY : values[i]! <= lineY;
    });
    if (newActive.length === activeIdx.length) break;
    if (newActive.length < minInliers) break;
    activeIdx = newActive;
  }

  const finalXs = activeIdx;
  const finalYs = activeIdx.map((i) => values[i]!);
  const finalFit = ols(finalXs, finalYs);
  return {
    slope: finalFit.slope,
    intercept: finalFit.intercept,
    rSquared: finalFit.rSquared,
    nInliers: activeIdx.length,
  };
}

function countTouches(
  values: ReadonlyArray<number>,
  slope: number,
  intercept: number,
  tolerance: number,
): number {
  let touches = 0;
  for (let i = 0; i < values.length; i++) {
    const lineY = slope * i + intercept;
    const tol = Math.max(1e-9, tolerance * Math.abs(lineY));
    if (Math.abs(values[i]! - lineY) <= tol) touches++;
  }
  return touches;
}

function fitSide(
  values: ReadonlyArray<number>,
  side: TrendlineSide,
  method: TrendlineMethod,
  minInliers: number,
  tolerance: number,
): TrendlineFit {
  let slope: number;
  let intercept: number;
  let rSquared: number;
  let nInliers: number;

  if (method === "peel_off") {
    const r = peelOffFit(values, side, minInliers);
    slope = r.slope;
    intercept = r.intercept;
    rSquared = r.rSquared;
    nInliers = r.nInliers;
  } else {
    const xs = values.map((_, i) => i);
    const r = ols(xs, values);
    slope = r.slope;
    intercept = r.intercept;
    rSquared = r.rSquared;
    nInliers = values.length;
  }

  const startValue = intercept;
  const endValue = slope * (values.length - 1) + intercept;
  const touchCount = countTouches(values, slope, intercept, tolerance);

  return { side, slope, intercept, rSquared, nInliers, touchCount, startValue, endValue };
}

function validateInput(input: TrendlineDetectionInput): {
  method: TrendlineMethod;
  minInliers: number;
  tolerance: number;
} {
  if (input.bars.length < 3) {
    throw new Error(`trendline detection requires at least 3 bars (got ${input.bars.length})`);
  }
  for (let i = 0; i < input.bars.length; i++) {
    const b = input.bars[i]!;
    if (!Number.isFinite(b.high) || !Number.isFinite(b.low)) {
      throw new Error(`bars[${i}] has non-finite high/low`);
    }
    if (b.low > b.high) {
      throw new Error(`bars[${i}] has low (${b.low}) > high (${b.high})`);
    }
  }
  const method: TrendlineMethod = input.method ?? "peel_off";
  if (method !== "peel_off" && method !== "ols") {
    throw new Error(`method must be "peel_off" or "ols" (got "${method}")`);
  }
  const minInliers = input.minInliers ?? 3;
  if (!Number.isInteger(minInliers) || minInliers < 2) {
    throw new Error(`minInliers must be an integer >= 2 (got ${minInliers})`);
  }
  if (minInliers > input.bars.length) {
    throw new Error(
      `minInliers (${minInliers}) cannot exceed bar count (${input.bars.length})`,
    );
  }
  const tolerance = input.touchTolerance ?? 0.002;
  if (!Number.isFinite(tolerance) || tolerance < 0) {
    throw new Error(`touchTolerance must be a non-negative finite number (got ${tolerance})`);
  }
  return { method, minInliers, tolerance };
}

export function detectTrendlines(input: TrendlineDetectionInput): TrendlineDetectionResult {
  const { method, minInliers, tolerance } = validateInput(input);
  const highs = input.bars.map((b) => b.high);
  const lows = input.bars.map((b) => b.low);

  const upper = fitSide(highs, "upper", method, minInliers, tolerance);
  const lower = fitSide(lows, "lower", method, minInliers, tolerance);

  const dir = (s: number) => (s > 0 ? "rising" : s < 0 ? "falling" : "flat");
  const reasoning =
    `Detected upper trendline (slope ${upper.slope.toFixed(6)}/bar, ${dir(upper.slope)}, ` +
    `r²=${upper.rSquared.toFixed(3)}, ${upper.touchCount} touches, ${upper.nInliers}/${input.bars.length} inliers) ` +
    `and lower trendline (slope ${lower.slope.toFixed(6)}/bar, ${dir(lower.slope)}, ` +
    `r²=${lower.rSquared.toFixed(3)}, ${lower.touchCount} touches, ${lower.nInliers}/${input.bars.length} inliers) ` +
    `via "${method}" over ${input.bars.length} bars.`;

  return { upper, lower, method, nBars: input.bars.length, reasoning };
}

export function trendlineDetectionToPayload(
  result: TrendlineDetectionResult,
): Record<string, unknown> {
  return {
    kind: "trendline.detected",
    method: result.method,
    nBars: result.nBars,
    upper: {
      slope: result.upper.slope,
      intercept: result.upper.intercept,
      rSquared: result.upper.rSquared,
      touchCount: result.upper.touchCount,
      nInliers: result.upper.nInliers,
    },
    lower: {
      slope: result.lower.slope,
      intercept: result.lower.intercept,
      rSquared: result.lower.rSquared,
      touchCount: result.lower.touchCount,
      nInliers: result.lower.nInliers,
    },
  };
}
