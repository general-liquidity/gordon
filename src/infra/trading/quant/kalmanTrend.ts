/**
 * Constant-Velocity Kalman Trend Filter (K2).
 *
 * A 2-state state-space filter that tracks BOTH the level and the velocity
 * (rate of change) of a price series jointly, rather than the single-state
 * level filter in kalman.ts / kalmanFilter.ts which only smooths the level
 * and reports a first-difference slope after the fact.
 *
 *   State:       x = [level, velocity]^T
 *   Transition:  F = [[1, 1], [0, 1]]      (per-bar dt = 1, level += velocity)
 *   Process:     Q = q * [[1/3, 1/2], [1/2, 1]]  (white-noise-acceleration)
 *   Measurement: z = level + noise,  H = [1, 0],  R
 *
 * The filtered velocity is a causal, model-based trend estimate. A sign flip
 * of the velocity (a zero-crossing) is a reversal signal: velocity crossing
 * up through zero = bullish reversal, down through zero = bearish reversal.
 * This is distinct from the single-state Kalman slope proxy, which reads the
 * difference of consecutive filtered levels and has no explicit velocity state
 * or process model for how velocity itself evolves.
 *
 * When processNoise / measurementNoise are omitted they are derived from the
 * variance of the series' first differences, which keeps the tracking behavior
 * scale-invariant across instruments (a $100 stock and a $60k BTC print get
 * comparable smoothing rather than one being trusted far more than the other).
 */

export interface KalmanTrendInput {
  /** Raw price (or spread) observations, oldest first. */
  prices: ReadonlyArray<number>;
  /**
   * Process noise q. Scales the white-noise-acceleration covariance.
   * Higher = the velocity state is allowed to change faster (more responsive).
   * Default: derived from first-difference variance (scale-invariant).
   */
  processNoise?: number;
  /**
   * Measurement noise R (variance of the observation noise).
   * Higher = the filter trusts each print less (smoother).
   * Default: first-difference variance of the series.
   */
  measurementNoise?: number;
  /** Initial state error variance (both diagonal entries). Default 1.0. */
  initialErrorVariance?: number;
  /**
   * Velocity magnitude below which the trend is reported "neutral".
   * Default: currentLevel * 1e-4 (0.01% of price per bar), matching the
   * single-state Kalman slope threshold.
   */
  velocityThreshold?: number;
}

export type KalmanTrendSignal = "bullish_reversal" | "bearish_reversal" | "none";

export interface KalmanTrendResult {
  /** Filtered level series (aligned to prices). */
  levels: number[];
  /** Filtered velocity series (per-bar rate of change; aligned to prices). */
  velocities: number[];
  /** Latest filtered level. */
  currentLevel: number | null;
  /** Latest filtered velocity. */
  currentVelocity: number | null;
  /** Trend from the sign of the latest velocity vs the neutral threshold. */
  trend: "bullish" | "bearish" | "neutral";
  /**
   * Reversal signal for the LATEST bar: fires only when the most recent bar is
   * itself a velocity zero-crossing. Otherwise "none".
   */
  signal: KalmanTrendSignal;
  /** Index of the most recent velocity zero-crossing, or null if none. */
  lastCrossingIndex: number | null;
  /** Direction of the most recent zero-crossing. */
  lastCrossingDirection: "up" | "down" | null;
  /** Number of observations used. */
  sampleSize: number;
  interpretation: string;
}

const DEFAULT_INITIAL_ERROR_VARIANCE = 1.0;
/** Ratio q/R when both are derived; ~sqrt(0.05) maneuver index = moderate tracking. */
const DERIVED_Q_OVER_R = 0.05;

function firstDifferenceVariance(prices: ReadonlyArray<number>): number {
  if (prices.length < 2) return 0;
  const diffs: number[] = [];
  for (let i = 1; i < prices.length; i++) diffs.push(prices[i]! - prices[i - 1]!);
  const mean = diffs.reduce((s, d) => s + d, 0) / diffs.length;
  const varD =
    diffs.reduce((s, d) => s + (d - mean) * (d - mean), 0) / Math.max(diffs.length - 1, 1);
  return varD;
}

export function computeKalmanTrend(input: KalmanTrendInput): KalmanTrendResult {
  const prices = input.prices;
  const n = prices.length;

  if (n < 2) {
    return {
      levels: [],
      velocities: [],
      currentLevel: null,
      currentVelocity: null,
      trend: "neutral",
      signal: "none",
      lastCrossingIndex: null,
      lastCrossingDirection: null,
      sampleSize: n,
      interpretation: "Insufficient data for Kalman trend filter (need >= 2 observations).",
    };
  }

  // Derive scale-invariant defaults from the series when knobs are omitted.
  const varD = firstDifferenceVariance(prices);
  const scale = varD > 0 ? varD : Math.max((prices[0]! * 1e-4) ** 2, 1e-12);
  const R = input.measurementNoise ?? scale;
  const q = input.processNoise ?? scale * DERIVED_Q_OVER_R;

  // White-noise-acceleration process covariance with dt = 1.
  const Q00 = q / 3;
  const Q01 = q / 2;
  const Q11 = q;

  // State: [level, velocity]. Initialize velocity from the first step.
  let level = prices[0]!;
  let velocity = prices[1]! - prices[0]!;

  // Symmetric 2x2 covariance P = [[p00, p01], [p01, p11]].
  const p0 = input.initialErrorVariance ?? DEFAULT_INITIAL_ERROR_VARIANCE;
  let p00 = p0;
  let p01 = 0;
  let p11 = p0;

  const levels: number[] = new Array(n);
  const velocities: number[] = new Array(n);

  for (let t = 0; t < n; t++) {
    // Predict: x_pred = F x, P_pred = F P F^T + Q, with F = [[1,1],[0,1]].
    const levelPred = level + velocity;
    const velPred = velocity;
    const p00Pred = p00 + 2 * p01 + p11 + Q00;
    const p01Pred = p01 + p11 + Q01;
    const p11Pred = p11 + Q11;

    // Update with the observation z = prices[t], H = [1, 0].
    const z = prices[t]!;
    const S = p00Pred + R;
    const K0 = p00Pred / S;
    const K1 = p01Pred / S;
    const y = z - levelPred;

    level = levelPred + K0 * y;
    velocity = velPred + K1 * y;

    // P = (I - K H) P_pred (symmetric by construction for H = [1,0]).
    p00 = (1 - K0) * p00Pred;
    p01 = (1 - K0) * p01Pred;
    p11 = p11Pred - K1 * p01Pred;

    levels[t] = level;
    velocities[t] = velocity;
  }

  // Scan for velocity zero-crossings across the filtered series.
  let lastCrossingIndex: number | null = null;
  let lastCrossingDirection: "up" | "down" | null = null;
  for (let t = 1; t < n; t++) {
    const prev = velocities[t - 1]!;
    const curr = velocities[t]!;
    if (prev <= 0 && curr > 0) {
      lastCrossingIndex = t;
      lastCrossingDirection = "up";
    } else if (prev >= 0 && curr < 0) {
      lastCrossingIndex = t;
      lastCrossingDirection = "down";
    }
  }

  const currentLevel = levels[n - 1]!;
  const currentVelocity = velocities[n - 1]!;
  const threshold = input.velocityThreshold ?? Math.abs(currentLevel) * 1e-4;
  const trend: "bullish" | "bearish" | "neutral" =
    currentVelocity > threshold ? "bullish" : currentVelocity < -threshold ? "bearish" : "neutral";

  // The latest-bar reversal signal fires only if the last bar is the crossing.
  const signal: KalmanTrendSignal =
    lastCrossingIndex === n - 1
      ? lastCrossingDirection === "up"
        ? "bullish_reversal"
        : "bearish_reversal"
      : "none";

  const interpretation = buildInterpretation(
    currentLevel,
    currentVelocity,
    trend,
    signal,
    lastCrossingIndex,
    lastCrossingDirection,
  );

  return {
    levels,
    velocities,
    currentLevel,
    currentVelocity,
    trend,
    signal,
    lastCrossingIndex,
    lastCrossingDirection,
    sampleSize: n,
    interpretation,
  };
}

function buildInterpretation(
  level: number,
  velocity: number,
  trend: string,
  signal: KalmanTrendSignal,
  lastCrossingIndex: number | null,
  lastCrossingDirection: "up" | "down" | null,
): string {
  let msg = `Kalman trend level ${level.toFixed(2)}, velocity ${velocity.toFixed(4)}/bar (${trend}).`;

  if (signal === "bullish_reversal") {
    msg += " Velocity just crossed up through zero: bullish reversal signal.";
  } else if (signal === "bearish_reversal") {
    msg += " Velocity just crossed down through zero: bearish reversal signal.";
  } else if (lastCrossingIndex !== null) {
    const dir = lastCrossingDirection === "up" ? "bullish" : "bearish";
    msg += ` Last velocity zero-crossing (${dir}) was at bar ${lastCrossingIndex}.`;
  } else {
    msg += " No velocity zero-crossing over the window.";
  }

  return msg;
}
