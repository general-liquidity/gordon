/**
 * Kalman Filter — Adaptive Price Smoothing
 *
 * State-space filter that adapts to changing volatility automatically.
 * Superior to moving averages: no lag at trend changes, smooth in noise.
 *
 * Use cases:
 *   - Smooth noisy price data before applying indicators
 *   - Generate trend signal (Kalman slope)
 *   - Pairs trading: filter the spread before z-score
 *   - Any indicator input benefits from Kalman pre-filtering
 *
 * Parameters:
 *   Q (process variance): how much the true price changes per step.
 *     Higher Q → filter follows price more closely (less smoothing).
 *   R (measurement variance): how noisy the observations are.
 *     Higher R → filter trusts observations less (more smoothing).
 */

// ============================================================================
// Types
// ============================================================================

export interface KalmanState {
  /** Current estimate of the true value. */
  estimate: number;
  /** Current estimation error variance. */
  errorVariance: number;
  /** Kalman gain from last update. */
  kalmanGain: number;
}

export interface KalmanConfig {
  /** Process variance (Q). How much true value changes per step. Default 0.01. */
  processVariance: number;
  /** Measurement variance (R). How noisy observations are. Default 1.0. */
  measurementVariance: number;
  /** Initial estimate. Default: first observation. */
  initialEstimate?: number;
  /** Initial error variance. Default 1.0. */
  initialErrorVariance?: number;
}

export const DEFAULT_KALMAN_CONFIG: KalmanConfig = {
  processVariance: 0.01,
  measurementVariance: 1.0,
  initialErrorVariance: 1.0,
};

export interface KalmanResult {
  /** Filtered (smoothed) values. */
  filtered: number[];
  /** Kalman gain at each step (shows how much filter trusts new data). */
  gains: number[];
  /** Slope estimate (first difference of filtered). */
  slopes: number[];
  /** Final state. */
  state: KalmanState;
}

// ============================================================================
// Single-Step Update
// ============================================================================

/**
 * One step of the Kalman filter.
 */
export function kalmanUpdate(
  state: KalmanState,
  measurement: number,
  Q: number,
  R: number,
): KalmanState {
  // Predict
  const predictedEstimate = state.estimate;
  const predictedError = state.errorVariance + Q;

  // Update
  const kalmanGain = predictedError / (predictedError + R);
  const estimate = predictedEstimate + kalmanGain * (measurement - predictedEstimate);
  const errorVariance = (1 - kalmanGain) * predictedError;

  return { estimate, errorVariance, kalmanGain };
}

// ============================================================================
// Full Series Filter
// ============================================================================

/**
 * Apply Kalman filter to a price series.
 *
 * @param prices Raw price observations.
 * @param config Filter parameters.
 * @returns Filtered series + gains + slopes.
 */
export function kalmanFilter(
  prices: number[],
  config: KalmanConfig = DEFAULT_KALMAN_CONFIG,
): KalmanResult {
  if (prices.length === 0) {
    return {
      filtered: [],
      gains: [],
      slopes: [],
      state: { estimate: 0, errorVariance: 1, kalmanGain: 0 },
    };
  }

  const Q = config.processVariance;
  const R = config.measurementVariance;

  let state: KalmanState = {
    estimate: config.initialEstimate ?? prices[0]!,
    errorVariance: config.initialErrorVariance ?? 1.0,
    kalmanGain: 0,
  };

  const filtered: number[] = [];
  const gains: number[] = [];
  const slopes: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    state = kalmanUpdate(state, prices[i]!, Q, R);
    filtered.push(state.estimate);
    gains.push(state.kalmanGain);
    slopes.push(i > 0 ? filtered[i]! - filtered[i - 1]! : 0);
  }

  return { filtered, gains, slopes, state };
}

/**
 * Auto-tune Kalman parameters from data.
 * Estimates Q and R from the variance of price changes and price levels.
 */
export function autoTuneKalman(prices: number[]): KalmanConfig {
  if (prices.length < 10) return DEFAULT_KALMAN_CONFIG;

  // Estimate measurement noise from price volatility
  const returns: number[] = [];
  for (let i = 1; i < prices.length; i++) {
    returns.push(prices[i]! - prices[i - 1]!);
  }

  const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
  const returnVariance =
    returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / (returns.length - 1);

  // R = measurement noise ≈ half of return variance
  // Q = process noise ≈ fraction of return variance (how fast true value moves)
  const R = returnVariance * 0.5;
  const Q = returnVariance * 0.1;

  return {
    processVariance: Q,
    measurementVariance: R,
    initialErrorVariance: returnVariance,
  };
}

/**
 * Generate trading signal from Kalman filter.
 * Uses slope direction + gain stability.
 */
export function kalmanSignal(
  prices: number[],
  config?: KalmanConfig,
): { signal: "bullish" | "bearish" | "neutral"; strength: number; filtered: number[] } {
  const effectiveConfig = config ?? autoTuneKalman(prices);
  const result = kalmanFilter(prices, effectiveConfig);

  if (result.slopes.length < 5) {
    return { signal: "neutral", strength: 0, filtered: result.filtered };
  }

  // Average slope over last 5 periods
  const recentSlopes = result.slopes.slice(-5);
  const avgSlope = recentSlopes.reduce((s, v) => s + v, 0) / recentSlopes.length;

  // Normalize by price level for strength
  const lastPrice = prices[prices.length - 1] ?? 1;
  const normalizedSlope = (avgSlope / lastPrice) * 10000; // basis points

  let signal: "bullish" | "bearish" | "neutral";
  if (normalizedSlope > 5) signal = "bullish";
  else if (normalizedSlope < -5) signal = "bearish";
  else signal = "neutral";

  return {
    signal,
    strength: Math.min(100, Math.abs(normalizedSlope)),
    filtered: result.filtered,
  };
}

// ============================================================================
// Adaptive-Q variant (K3)
// ============================================================================

/**
 * Result of the adaptive-Q filter: the standard fields plus the per-step
 * process variance actually used, so the vol-conditioning is inspectable.
 */
export interface AdaptiveKalmanResult extends KalmanResult {
  /** Process variance Q applied at each step. */
  qSeries: number[];
}

export interface AdaptiveKalmanConfig extends KalmanConfig {
  /**
   * Reference volatility the injected series is normalized against. When the
   * trailing realized vol equals this reference, Q equals the base
   * processVariance. Default: the median of the finite, positive realized-vol
   * values (robust to spikes).
   */
  referenceVol?: number;
  /** Clamp on the per-step vol scale factor (vol / referenceVol). Default 10. */
  maxScale?: number;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1]! + sorted[mid]!) / 2 : sorted[mid]!;
}

/**
 * Kalman filter with a process noise Q that is scaled per step by an injected
 * trailing realized-vol series. In calm regimes (low vol) Q shrinks and the
 * filter is smooth / trusts its model; in volatile regimes Q grows and the
 * filter becomes responsive / tracks price more closely. This is the same
 * single-state predict-correct filter as `kalmanFilter`, but with a
 * time-varying Q instead of a constant one.
 *
 * The scale is variance-consistent: since realized vol is a standard deviation,
 * Q_t = processVariance * (vol_t / referenceVol)^2. The injected series is the
 * caller's responsibility (e.g. a trailing stdev of returns, ATR/price, or the
 * kalmanVolatility estimate) and is aligned by index to `prices`; if it is
 * shorter than the price series, the last value is carried forward.
 *
 * @param prices        Raw price observations.
 * @param realizedVol   Trailing realized-vol per step (a standard deviation).
 * @param config        Filter parameters; processVariance is the BASE Q.
 */
export function kalmanFilterAdaptiveQ(
  prices: number[],
  realizedVol: ReadonlyArray<number>,
  config: AdaptiveKalmanConfig = DEFAULT_KALMAN_CONFIG,
): AdaptiveKalmanResult {
  if (prices.length === 0) {
    return {
      filtered: [],
      gains: [],
      slopes: [],
      qSeries: [],
      state: { estimate: 0, errorVariance: 1, kalmanGain: 0 },
    };
  }

  const baseQ = config.processVariance;
  const R = config.measurementVariance;
  const maxScale = config.maxScale ?? 10;

  // Reference vol: explicit, else the median of the finite positive vols.
  const positiveVols = realizedVol.filter((v) => Number.isFinite(v) && v > 0) as number[];
  const referenceVol = config.referenceVol ?? (positiveVols.length > 0 ? median(positiveVols) : 0);

  let state: KalmanState = {
    estimate: config.initialEstimate ?? prices[0]!,
    errorVariance: config.initialErrorVariance ?? 1.0,
    kalmanGain: 0,
  };

  const filtered: number[] = [];
  const gains: number[] = [];
  const slopes: number[] = [];
  const qSeries: number[] = [];

  for (let i = 0; i < prices.length; i++) {
    // Align the vol series by index; carry the last value forward if shorter.
    const rawVol =
      realizedVol.length > 0 ? realizedVol[Math.min(i, realizedVol.length - 1)]! : referenceVol;
    let scale = 1;
    if (referenceVol > 0 && Number.isFinite(rawVol) && rawVol > 0) {
      scale = Math.min(rawVol / referenceVol, maxScale);
    }
    const Q = baseQ * scale * scale;
    qSeries.push(Q);

    state = kalmanUpdate(state, prices[i]!, Q, R);
    filtered.push(state.estimate);
    gains.push(state.kalmanGain);
    slopes.push(i > 0 ? filtered[i]! - filtered[i - 1]! : 0);
  }

  return { filtered, gains, slopes, qSeries, state };
}
