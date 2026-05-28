/**
 * Standard Error Bands — regression-line centerline + ± k × standard
 * error bands.
 *
 * Distinct from Bollinger Bands: BB uses SMA centerline + price
 * stddev. SEB uses linear-regression centerline + standard error of
 * residuals around that regression. SEB is trend-focused (the
 * centerline IS the trend); BB is mean-reversion-focused (centerline
 * is the average price).
 *
 * Practical implications:
 *   - When price hugs the regression line, residuals are small,
 *     bands contract — trend is "clean."
 *   - When price oscillates wildly around the regression line,
 *     residuals grow, bands widen — trend is "noisy."
 *   - The slope tells you the direction; the band-width tells you
 *     how convincing the trend is.
 *
 * Common settings (per the source article): 21-bar window, k = 2.
 * Anything from 14–30 bars is reasonable for daily charts.
 */

import { rollingLinearRegression } from "./linearRegression.ts";

export type SebTrendVerdict =
  | "trending_up"
  | "trending_down"
  | "flat"
  | "noisy";

export interface StandardErrorBandsParams {
  /** Bars in each rolling regression. Default 21. */
  period?: number;
  /** Standard-error multiplier for the bands. Default 2. */
  multiplier?: number;
  /** Slope magnitude threshold (in price-units / bar) above which the
   *  trend is considered directional. Below this absolute value, the
   *  verdict is 'flat'. Default 0 (slope of zero → flat) — most
   *  callers leave this alone. */
  slopeThreshold?: number;
  /** R² floor below which the verdict is 'noisy' regardless of slope.
   *  Default 0.5 — under-fit windows shouldn't claim a clean trend. */
  rSquaredThreshold?: number;
}

export interface StandardErrorBandsResult {
  /** Regression-line value at each bar (centerline). Length matches
   *  input; nulls for the leading (period - 1) bars. */
  centerline: Array<number | null>;
  /** centerline + multiplier × standardError. */
  upperBand: Array<number | null>;
  /** centerline - multiplier × standardError. */
  lowerBand: Array<number | null>;
  /** Per-bar regression slope. */
  slopes: Array<number | null>;
  /** Per-bar R² of the regression fit. */
  rSquared: Array<number | null>;
  /** Per-bar standard error of the residuals. */
  standardErrors: Array<number | null>;
  /** Trend verdict at the LAST bar based on slope + R² thresholds. */
  latestVerdict: SebTrendVerdict | null;
  /** Most-recent (last-bar) centerline / upper / lower. Convenience
   *  accessor — null when the input was too short for a full window. */
  latestCenterline: number | null;
  latestUpperBand: number | null;
  latestLowerBand: number | null;
  /** Last-bar slope. */
  latestSlope: number | null;
  /** Period and multiplier actually used. */
  period: number;
  multiplier: number;
  /** Human-readable summary of the latest reading. */
  interpretation: string;
}

const DEFAULT_PERIOD = 21;
const DEFAULT_MULTIPLIER = 2;
const DEFAULT_R2_THRESHOLD = 0.5;

function classifyTrend(
  slope: number | null,
  rSq: number | null,
  slopeThreshold: number,
  rSqThreshold: number,
): SebTrendVerdict | null {
  if (slope == null || rSq == null) return null;
  if (rSq < rSqThreshold) return "noisy";
  if (Math.abs(slope) < slopeThreshold) return "flat";
  return slope > 0 ? "trending_up" : "trending_down";
}

export function calculateStandardErrorBands(
  closes: number[],
  params: StandardErrorBandsParams = {},
): StandardErrorBandsResult {
  const period = params.period ?? DEFAULT_PERIOD;
  const multiplier = params.multiplier ?? DEFAULT_MULTIPLIER;
  const slopeThreshold = params.slopeThreshold ?? 0;
  const rSqThreshold = params.rSquaredThreshold ?? DEFAULT_R2_THRESHOLD;

  if (!Number.isInteger(period) || period < 2) {
    throw new Error("standardErrorBands: period must be an integer >= 2");
  }
  if (!Number.isFinite(multiplier) || multiplier < 0) {
    throw new Error("standardErrorBands: multiplier must be a non-negative finite number");
  }

  const reg = rollingLinearRegression(closes, period);
  const n = closes.length;
  const upper: Array<number | null> = new Array(n).fill(null);
  const lower: Array<number | null> = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    const c = reg.centerline[i];
    const se = reg.standardErrors[i];
    if (c == null || se == null) continue;
    upper[i] = c + multiplier * se;
    lower[i] = c - multiplier * se;
  }

  const lastIdx = n - 1;
  const latestCenterline = lastIdx >= 0 ? reg.centerline[lastIdx] ?? null : null;
  const latestUpperBand = lastIdx >= 0 ? upper[lastIdx] ?? null : null;
  const latestLowerBand = lastIdx >= 0 ? lower[lastIdx] ?? null : null;
  const latestSlope = lastIdx >= 0 ? reg.slopes[lastIdx] ?? null : null;
  const latestRSquared = lastIdx >= 0 ? reg.rSquared[lastIdx] ?? null : null;
  const latestVerdict = classifyTrend(
    latestSlope,
    latestRSquared,
    slopeThreshold,
    rSqThreshold,
  );

  const interpretation =
    latestVerdict === null
      ? `Insufficient data — need at least ${period} bars; got ${n}.`
      : latestVerdict === "noisy"
        ? `Noisy regression (R² ${(latestRSquared! * 100).toFixed(0)}% < ${(rSqThreshold * 100).toFixed(0)}%). Bands wide; trend not reliable.`
        : latestVerdict === "flat"
          ? `Flat trend (slope ${latestSlope!.toFixed(4)} below threshold). Mean-reversion regime more likely than trend continuation.`
          : `${latestVerdict === "trending_up" ? "Up-trend" : "Down-trend"} (slope ${latestSlope!.toFixed(4)}, R² ${(latestRSquared! * 100).toFixed(0)}%). Centerline ${latestCenterline!.toFixed(2)} ± ${(multiplier * (reg.standardErrors[lastIdx] ?? 0)).toFixed(2)}.`;

  return {
    centerline: reg.centerline,
    upperBand: upper,
    lowerBand: lower,
    slopes: reg.slopes,
    rSquared: reg.rSquared,
    standardErrors: reg.standardErrors,
    latestVerdict,
    latestCenterline,
    latestUpperBand,
    latestLowerBand,
    latestSlope,
    period,
    multiplier,
    interpretation,
  };
}
