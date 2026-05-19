/**
 * Dynamic Beta via Kalman Filter (GORDON_KALMAN_BETA).
 *
 * Treats the regression coefficient between an asset's returns and a
 * market index's returns as a hidden state that drifts over time, and
 * estimates it in real time from observed returns.
 *
 *   State:       β_t = β_{t-1} + w_t,    w_t ~ N(0, Q)
 *   Measurement: r_a,t = β_t × r_m,t + v_t,  v_t ~ N(0, R)
 *
 * Time-varying measurement matrix: H_t = r_m,t. Otherwise a standard
 * scalar Kalman filter.
 *
 * Replaces OLS-over-fixed-window beta with a live current-state beta +
 * uncertainty band. Composes with WW12 performanceDecomposition (which
 * currently takes a static marketBeta as input) and with hedge-sizing
 * logic that needs current beta rather than 60-day average.
 *
 * The smaller Q is, the smoother the beta estimate. The smaller R is,
 * the more aggressively the filter trusts each new observation. Defaults
 * match the article's example values (Q = 1e-5, R = 1e-3).
 */

export const KALMAN_BETA_FLAG_ENV = "GORDON_KALMAN_BETA";

export function isKalmanBetaEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[KALMAN_BETA_FLAG_ENV] === "1" || env[KALMAN_BETA_FLAG_ENV] === "true";
}

export interface KalmanBetaInput {
  assetReturns: ReadonlyArray<number>;
  marketReturns: ReadonlyArray<number>;
  /** Process noise variance. Smaller = smoother. Default 1e-5. */
  q?: number;
  /** Measurement noise variance. Smaller = trust observations more. Default 1e-3. */
  r?: number;
  /** Initial beta estimate. Default 1.0. */
  beta0?: number;
  /** Initial variance. Default 1.0. */
  p0?: number;
}

export interface KalmanBetaResult {
  /** Full series of beta estimates, one per observation. */
  betas: number[];
  /** Per-step posterior variance of beta. */
  variances: number[];
  /** Latest beta estimate. */
  currentBeta: number;
  /** Latest one-sigma uncertainty band. */
  currentStdDev: number;
  /** Min and max observed beta across the series. */
  minBeta: number;
  maxBeta: number;
  /** Average beta across the series. */
  meanBeta: number;
  sampleSize: number;
}

const DEFAULT_Q = 1e-5;
const DEFAULT_R = 1e-3;

export function kalmanBeta(input: KalmanBetaInput): KalmanBetaResult {
  const q = input.q ?? DEFAULT_Q;
  const r = input.r ?? DEFAULT_R;
  let beta = input.beta0 ?? 1.0;
  let p = input.p0 ?? 1.0;

  const n = Math.min(input.assetReturns.length, input.marketReturns.length);
  const betas: number[] = new Array(n);
  const variances: number[] = new Array(n);

  let minBeta = Number.POSITIVE_INFINITY;
  let maxBeta = Number.NEGATIVE_INFINITY;
  let sumBeta = 0;

  for (let t = 0; t < n; t++) {
    // Predict step — random-walk on beta, uncertainty grows by q.
    p = p + q;

    // Measurement: r_a = β × r_m + noise. H_t = r_m,t (time-varying).
    const H = input.marketReturns[t]!;
    const y = input.assetReturns[t]! - H * beta; // innovation
    const S = H * p * H + r; // innovation variance
    const K = (p * H) / S; // Kalman gain
    beta = beta + K * y;
    p = (1 - K * H) * p;

    betas[t] = beta;
    variances[t] = p;
    if (beta < minBeta) minBeta = beta;
    if (beta > maxBeta) maxBeta = beta;
    sumBeta += beta;
  }

  if (n === 0) {
    return {
      betas: [],
      variances: [],
      currentBeta: beta,
      currentStdDev: Math.sqrt(p),
      minBeta: beta,
      maxBeta: beta,
      meanBeta: beta,
      sampleSize: 0,
    };
  }

  return {
    betas,
    variances,
    currentBeta: betas[n - 1]!,
    currentStdDev: Math.sqrt(variances[n - 1]!),
    minBeta,
    maxBeta,
    meanBeta: sumBeta / n,
    sampleSize: n,
  };
}

export function kalmanBetaToPayload(result: KalmanBetaResult): Record<string, unknown> {
  return {
    kind: "kalman_beta.computed",
    currentBeta: Number(result.currentBeta.toFixed(4)),
    currentStdDev: Number(result.currentStdDev.toFixed(4)),
    minBeta: Number(result.minBeta.toFixed(4)),
    maxBeta: Number(result.maxBeta.toFixed(4)),
    meanBeta: Number(result.meanBeta.toFixed(4)),
    sampleSize: result.sampleSize,
  };
}
