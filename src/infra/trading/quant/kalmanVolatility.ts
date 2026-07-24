/**
 * Dynamic Volatility via Kalman Filter (GORDON_KALMAN_VOLATILITY).
 *
 * Treats the log-variance of returns as a hidden state and estimates it
 * in real time from observed squared returns. Replaces backward-looking
 * GARCH / EWMA / rolling-realized with a state-space filter that tracks
 * current volatility.
 *
 *   State:       log(σ²_t) = log(σ²_{t-1}) + w_t,  w_t ~ N(0, Q)
 *   Measurement: log(r_t²) = log(σ²_t) + η_t
 *
 * The Gaussian approximation on the chi-squared measurement noise η_t
 * works in practice; vol-of-vol models at AQR and Two Sigma deploy
 * variants of this exact shape. Log-space keeps variance positive and
 * stabilizes dynamics across regimes.
 *
 * Composes with WW3 volatilityDrag (currently uses raw sample sigma —
 * Kalman gives a current-state estimate instead of a backward-looking
 * average), and with SC4 empiricalKelly (bootstrap-based; Kalman vol
 * is a conditioning input for vol-targeting before the Kelly fraction
 * is applied).
 *
 * The smaller Q is, the smoother the vol estimate (more lag). The
 * larger Q is, the more responsive (more noise). Default Q = 0.1
 * matches the article's responsive-vol-tracking example.
 */

export interface KalmanVolatilityInput {
  returns: ReadonlyArray<number>;
  /** Process noise. Higher = faster response. Default 0.1. */
  q?: number;
  /** Measurement noise. Default 1.0. */
  r?: number;
  /** Initial log-variance. Defaults to mean of log-squared-returns over the first 60 observations. */
  logVar0?: number;
  /** Initial variance of the log-variance estimate. Default 1.0. */
  p0?: number;
  /** Periods per year for annualization. Default 252. */
  periodsPerYear?: number;
}

export interface KalmanVolatilityResult {
  /** Filtered variance estimate per step (not annualized). */
  variance: number[];
  /** Annualized volatility per step. */
  annualVol: number[];
  /** Latest annualized volatility. */
  currentAnnualVol: number;
  /** Latest variance estimate (non-annualized). */
  currentVariance: number;
  /** Min and max annualized vol across the series. */
  minAnnualVol: number;
  maxAnnualVol: number;
  meanAnnualVol: number;
  sampleSize: number;
}

const DEFAULT_Q = 0.1;
const DEFAULT_R = 1.0;
const DEFAULT_PERIODS_PER_YEAR = 252;
const LOG_FLOOR = 1e-12;
/**
 * Bias correction for E[log(χ²(1))] = ψ(1/2) − log(1/2) ≈ −1.2704.
 * For Gaussian returns r ~ N(0, σ²), log(r²) is centered at log(σ²) − 1.2704.
 * Shifting the measurement by +1.2704 lets the filter recover log(σ²) directly.
 */
const LOG_CHI2_1_BIAS = 1.2704;

export function kalmanVolatility(input: KalmanVolatilityInput): KalmanVolatilityResult {
  const q = input.q ?? DEFAULT_Q;
  const r = input.r ?? DEFAULT_R;
  const periodsPerYear = input.periodsPerYear ?? DEFAULT_PERIODS_PER_YEAR;
  const n = input.returns.length;

  if (n === 0) {
    return {
      variance: [],
      annualVol: [],
      currentAnnualVol: 0,
      currentVariance: 0,
      minAnnualVol: 0,
      maxAnnualVol: 0,
      meanAnnualVol: 0,
      sampleSize: 0,
    };
  }

  const logSquaredReturns: number[] = new Array(n);
  for (let t = 0; t < n; t++) {
    const sq = input.returns[t]! * input.returns[t]!;
    // Bias-correct: shift measurement so filter recovers log(σ²) directly.
    logSquaredReturns[t] = Math.log(Math.max(sq, LOG_FLOOR)) + LOG_CHI2_1_BIAS;
  }

  let logVar: number;
  if (input.logVar0 !== undefined) {
    logVar = input.logVar0;
  } else {
    const warmupSize = Math.min(60, n);
    let warmupSum = 0;
    for (let t = 0; t < warmupSize; t++) warmupSum += logSquaredReturns[t]!;
    logVar = warmupSize > 0 ? warmupSum / warmupSize : 0;
  }
  let p = input.p0 ?? 1.0;

  const variance: number[] = new Array(n);
  const annualVol: number[] = new Array(n);
  let minAnnual = Number.POSITIVE_INFINITY;
  let maxAnnual = Number.NEGATIVE_INFINITY;
  let sumAnnual = 0;

  for (let t = 0; t < n; t++) {
    // Predict
    p = p + q;

    // Update with log(r²) as the noisy observation of log(σ²)
    const y = logSquaredReturns[t]! - logVar; // innovation
    const S = p + r;
    const K = p / S;
    logVar = logVar + K * y;
    p = (1 - K) * p;

    const varEstimate = Math.exp(logVar);
    variance[t] = varEstimate;
    const annual = Math.sqrt(varEstimate * periodsPerYear);
    annualVol[t] = annual;
    if (annual < minAnnual) minAnnual = annual;
    if (annual > maxAnnual) maxAnnual = annual;
    sumAnnual += annual;
  }

  return {
    variance,
    annualVol,
    currentAnnualVol: annualVol[n - 1]!,
    currentVariance: variance[n - 1]!,
    minAnnualVol: minAnnual,
    maxAnnualVol: maxAnnual,
    meanAnnualVol: sumAnnual / n,
    sampleSize: n,
  };
}

export function kalmanVolatilityToPayload(
  result: KalmanVolatilityResult,
): Record<string, unknown> {
  return {
    kind: "kalman_volatility.computed",
    currentAnnualVol: Number(result.currentAnnualVol.toFixed(4)),
    minAnnualVol: Number(result.minAnnualVol.toFixed(4)),
    maxAnnualVol: Number(result.maxAnnualVol.toFixed(4)),
    meanAnnualVol: Number(result.meanAnnualVol.toFixed(4)),
    sampleSize: result.sampleSize,
  };
}
