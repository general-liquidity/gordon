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
}

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
  // Sum reductions in a single pass.
  let sumX = 0;
  let sumY = 0;
  let sumXY = 0;
  let sumXX = 0;
  for (let i = 0; i < n; i++) {
    sumX += i;
    sumY += values[i]!;
    sumXY += i * values[i]!;
    sumXX += i * i;
  }
  const meanX = sumX / n;
  const meanY = sumY / n;
  const ssXY = sumXY - n * meanX * meanY;
  const ssXX = sumXX - n * meanX * meanX;
  // Guard against degenerate input (all identical x — impossible here
  // since x is the index 0..n-1, but defensive anyway).
  const slope = ssXX === 0 ? 0 : ssXY / ssXX;
  const intercept = meanY - slope * meanX;

  // Compute residuals + sum-squared-error and total-sum-of-squares.
  let sse = 0;
  let sst = 0;
  for (let i = 0; i < n; i++) {
    const yHat = slope * i + intercept;
    const resid = values[i]! - yHat;
    sse += resid * resid;
    const dev = values[i]! - meanY;
    sst += dev * dev;
  }
  const rSquared = sst === 0 ? 1 : Math.max(0, 1 - sse / sst);
  // Standard error of residuals with (n - 2) df; n = 2 collapses to 0.
  const standardError = n > 2 ? Math.sqrt(sse / (n - 2)) : 0;
  const projectionAtLast = slope * (n - 1) + intercept;

  return { slope, intercept, rSquared, standardError, projectionAtLast, n };
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
