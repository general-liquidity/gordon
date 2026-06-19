/**
 * Linear regression — least-squares fit.
 *
 * Two entry points:
 *   - linearRegression(values) — single fit over the whole series.
 *     Returns slope, intercept, rSquared, standardError, projection
 *     at the last index. Use for "what's the trend of the last N
 *     bars?" point queries.
 *
 *   - rollingLinearRegression(values, windowSize) — per-bar rolling
 *     fit. At bar i, fits regression to values[i - windowSize + 1..i].
 *     Returns arrays of length values.length; the first
 *     (windowSize - 1) entries are null (insufficient data).
 *     Foundation for the Standard Error Bands indicator.
 *
 * x-axis is bar index (0, 1, 2, ...). Standard error follows the
 * conventional formula with (n - 2) degrees of freedom — used for
 * confidence bands on the regression line.
 */

export interface LinearRegressionResult {
  /** Slope of the fit line (Δy per bar). */
  slope: number;
  /** Y-intercept at bar 0. */
  intercept: number;
  /** Coefficient of determination, 0..1. 1 = perfect fit, 0 = noise. */
  rSquared: number;
  /** Standard error of the residuals — sqrt(SSE / (n - 2)). */
  standardError: number;
  /** Projected value at the last index of the input series. */
  projectionAtLast: number;
  /** Number of points used in the fit. */
  n: number;
  /** Standard error of the slope estimate. Null when n <= 2 (no residual df). */
  slopeStdError: number | null;
  /** Standard error of the intercept estimate. Null when n <= 2. */
  interceptStdError: number | null;
  /** t-statistic of the slope (slope / slopeStdError). Null when undefined. */
  slopeTStat: number | null;
  /** Two-sided p-value of the slope under H0: slope = 0. Null when undefined. */
  slopePValue: number | null;
  /** t-statistic of the intercept. Null when undefined. */
  interceptTStat: number | null;
  /** Two-sided p-value of the intercept under H0: intercept = 0. Null when undefined. */
  interceptPValue: number | null;
  /** Residual degrees of freedom (n - 2). Null when n <= 2. */
  degreesOfFreedom: number | null;
  /** Durbin-Watson statistic on residuals (~2 = no autocorrelation). Null when n < 3. */
  durbinWatson: number | null;
  /** Lag-1 autocorrelation of residuals, -1..1. Null when n < 3. */
  residualAutocorrelation: number | null;
  /** Human-readable significance + autocorrelation note. */
  interpretation: string;
}

// ---------------------------------------------------------------------------
// Student-t two-sided p-value — thin re-export over the shared `@stdlib`-backed
// special-functions module (`core/numerics`). Kept exported here because
// hedgeFundReplication.ts, market-analog.ts, and lever-attribution.ts import
// it from this path. See `docs/library-adoption/SPEC.md` Win #1.
// ---------------------------------------------------------------------------

import { studentTTwoSidedPValue } from "../numerics/index.ts";
import { linearRegression as olsFit } from "../stats/index.ts";

/**
 * Two-sided p-value for a t-statistic with `df` degrees of freedom:
 *   p = 2 · (1 − F_t(|t|; df)).
 * Re-exported (callers import it from this path); returns null for
 * non-positive df or non-finite t.
 */
export { studentTTwoSidedPValue };

export interface RollingLinearRegressionResult {
  /** Per-bar slope (length matches input; nulls for windowSize-1 leading bars). */
  slopes: Array<number | null>;
  /** Per-bar intercept. */
  intercepts: Array<number | null>;
  /** Per-bar R². */
  rSquared: Array<number | null>;
  /** Per-bar standard error of residuals. */
  standardErrors: Array<number | null>;
  /** Per-bar projected value at THAT bar (regression value at the
   *  rightmost point of the window). This is the centerline of the
   *  Standard Error Bands. */
  centerline: Array<number | null>;
  /** Window size that was used. */
  windowSize: number;
}

/** Pure single-fit. Throws on inputs that don't have enough points or
 *  contain non-finite values — caller is responsible for sanitising. */
export function linearRegression(values: number[]): LinearRegressionResult {
  if (!Array.isArray(values) || values.length < 2) {
    throw new Error("linearRegression: need at least 2 points");
  }
  for (let i = 0; i < values.length; i++) {
    if (!Number.isFinite(values[i])) {
      throw new Error(`linearRegression: values[${i}] is not finite`);
    }
  }
  const n = values.length;
  // Sum reductions retained for the inference layer (Sxx, means feed the
  // coefficient standard errors below); the slope/intercept fit itself is
  // delegated to the shared OLS primitive.
  let sumX = 0;
  let sumY = 0;
  let sumXX = 0;
  const xIndex: number[] = new Array(n);
  for (let i = 0; i < n; i++) {
    xIndex[i] = i;
    sumX += i;
    sumY += values[i]!;
    sumXX += i * i;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const ssXX = sumXX - n * meanX * meanX;
  const { slope, intercept } = olsFit(xIndex, values);

  // Compute residuals + sum-squared-error and total-sum-of-squares.
  const residuals: number[] = new Array(n);
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const yHat = slope * i + intercept;
    const resid = values[i]! - yHat;
    residuals[i] = resid;
    sse += resid * resid;
    const dev = values[i]! - meanY;
    sst += dev * dev;
  }
  const rSquared = sst === 0 ? 1 : Math.max(0, 1 - sse / sst);
  // Standard error of residuals with (n - 2) df; n = 2 collapses to 0.
  const standardError = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  const projectionAtLast = slope * (n - 1) + intercept;

  // --- Coefficient inference (only meaningful with residual df). ---
  let slopeStdError: number | null = null;
  let interceptStdError: number | null = null;
  let slopeTStat: number | null = null;
  let slopePValue: number | null = null;
  let interceptTStat: number | null = null;
  let interceptPValue: number | null = null;
  let degreesOfFreedom: number | null = null;

  if (n > 2 && ssXX > 0) {
    const df = n - 2;
    degreesOfFreedom = df;
    const sigma2 = sse / df;
    // Var(slope) = σ² / Sxx; Var(intercept) = σ² (1/n + meanX²/Sxx).
    const seSlope = Math.sqrt(sigma2 / ssXX);
    const seIntercept = Math.sqrt(sigma2 * (1 / n + (meanX * meanX) / ssXX));
    slopeStdError = parseFloat(seSlope.toFixed(6));
    interceptStdError = parseFloat(seIntercept.toFixed(6));
    if (seSlope > 0) {
      slopeTStat = parseFloat((slope / seSlope).toFixed(4));
      const p = studentTTwoSidedPValue(slope / seSlope, df);
      slopePValue = p === null ? null : parseFloat(p.toFixed(6));
    }
    if (seIntercept > 0) {
      interceptTStat = parseFloat((intercept / seIntercept).toFixed(4));
      const p = studentTTwoSidedPValue(intercept / seIntercept, df);
      interceptPValue = p === null ? null : parseFloat(p.toFixed(6));
    }
  }

  // --- Residual diagnostics: Durbin-Watson + lag-1 autocorrelation. ---
  let durbinWatson: number | null = null;
  let residualAutocorrelation: number | null = null;
  if (n >= 3) {
    let dwNum = 0;
    let lagCross = 0;
    for (let i = 1; i < n; i++) {
      const diff = residuals[i]! - residuals[i - 1]!;
      dwNum += diff * diff;
      lagCross += residuals[i]! * residuals[i - 1]!;
    }
    let dwDen = 0;
    for (let i = 0; i < n; i++) dwDen += residuals[i]! * residuals[i]!;
    if (dwDen > 0) {
      durbinWatson = parseFloat((dwNum / dwDen).toFixed(4));
      residualAutocorrelation = parseFloat((lagCross / dwDen).toFixed(4));
    }
  }

  const slopeSig = slopePValue !== null && slopePValue < 0.05;
  const autocorr = durbinWatson !== null && (durbinWatson < 1.5 || durbinWatson > 2.5);
  const sigPart =
    slopePValue === null
      ? "slope significance undetermined (insufficient residual df)"
      : slopeSig
        ? `slope significant (|t|=${Math.abs(slopeTStat!).toFixed(2)}, p=${slopePValue.toFixed(4)})`
        : `slope NOT significant (|t|=${Math.abs(slopeTStat!).toFixed(2)}, p=${slopePValue.toFixed(4)})`;
  const acPart =
    durbinWatson === null
      ? "residual autocorrelation undetermined"
      : autocorr
        ? `residuals show autocorrelation (DW=${durbinWatson.toFixed(2)}, far from 2)`
        : `residuals show no strong autocorrelation (DW=${durbinWatson.toFixed(2)})`;
  const interpretation = `${sigPart}; ${acPart}.`;

  return {
    slope,
    intercept,
    rSquared,
    standardError,
    projectionAtLast,
    n,
    slopeStdError,
    interceptStdError,
    slopeTStat,
    slopePValue,
    interceptTStat,
    interceptPValue,
    degreesOfFreedom,
    durbinWatson,
    residualAutocorrelation,
    interpretation,
  };
}

/** Rolling per-bar regression. Bars before the first full window
 *  receive null entries — caller can skip them or zero-pad as needed. */
export function rollingLinearRegression(
  values: number[],
  windowSize: number,
): RollingLinearRegressionResult {
  if (!Number.isInteger(windowSize) || windowSize < 2) {
    throw new Error("rollingLinearRegression: windowSize must be an integer >= 2");
  }
  if (!Array.isArray(values) || values.length === 0) {
    return {
      slopes: [],
      intercepts: [],
      rSquared: [],
      standardErrors: [],
      centerline: [],
      windowSize,
    };
  }
  const n = values.length;
  const slopes: Array<number | null> = new Array(n).fill(null);
  const intercepts: Array<number | null> = new Array(n).fill(null);
  const rSquared: Array<number | null> = new Array(n).fill(null);
  const standardErrors: Array<number | null> = new Array(n).fill(null);
  const centerline: Array<number | null> = new Array(n).fill(null);
  for (let i = windowSize - 1; i < n; i++) {
    const slice = values.slice(i - windowSize + 1, i + 1);
    // Skip windows containing non-finite values rather than throwing —
    // a rolling indicator on noisy data should degrade gracefully.
    let valid = true;
    for (const v of slice) {
      if (!Number.isFinite(v)) {
        valid = false;
        break;
      }
    }
    if (!valid) continue;
    const fit = linearRegression(slice);
    slopes[i] = fit.slope;
    intercepts[i] = fit.intercept;
    rSquared[i] = fit.rSquared;
    standardErrors[i] = fit.standardError;
    centerline[i] = fit.projectionAtLast;
  }
  return { slopes, intercepts, rSquared, standardErrors, centerline, windowSize };
}
