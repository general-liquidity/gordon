/**
 * Kalman Filter for the Pairs Hedge Ratio — dynamic β (and intercept α).
 *
 * The pairs-Kalman (the article's Chapter 5): treat the hedge ratio as a hidden
 * state that drifts each bar rather than a single OLS constant. This is the
 * dynamic-spread upgrade to the static Engle-Granger/Johansen β — it adapts as
 * the cointegrating relationship slowly re-prices.
 *
 * Gordon's existing `kalmanBeta` is asset-vs-market (a 1-D rolling β of an asset
 * against a benchmark) — NOT the pairs spread. This is the 2-state pairs filter.
 *
 * Model (state = [β, α]):
 *   state:       x_t = x_{t-1} + w_t            w_t ~ N(0, W)   (random walk)
 *   observation: p1_t = β_t·p2_t + α_t + v_t    v_t ~ N(0, R)   (scalar)
 *
 * Observation design row is H_t = [p2_t, 1], so the predicted p1 is H_t·x.
 * Process-noise covariance is the standard delta-parameterization
 *   W = (delta / (1 − delta)) · I
 * (Chan, "Algorithmic Trading"): delta near 0 → slow-moving β; larger delta →
 * faster adaptation. R is the scalar observation (measurement) variance.
 *
 * Pure compute, no I/O, no RNG. All linear algebra is 2×2 explicit.
 */

// ============================================================================
// Types
// ============================================================================

export interface KalmanHedgeStep {
  /** Hedge ratio β after the bar's update (units of p2 per unit p1). */
  beta: number;
  /** Intercept α after the bar's update. */
  alpha: number;
  /** Spread = p1 − β·p2 − α using the POSTERIOR (updated) state. */
  spread: number;
  /** Innovation (prediction error) = p1 − (β_pred·p2 + α_pred), using the PRIOR state. */
  innovation: number;
  /** Innovation variance (forecast error variance) — H·P_prior·Hᵀ + R. */
  innovationVar: number;
}

export interface KalmanHedgeOptions {
  /**
   * Process-noise delta in (0,1). Smaller = slower β drift (smoother), larger =
   * faster adaptation. Default 1e-4 (Chan's pairs default — slow, stable β).
   */
  delta?: number;
  /** Scalar observation (measurement) variance R. Default 1e-3. */
  observationVar?: number;
  /** Initial state [β0, α0]. Default [0, 0]. */
  initialState?: [number, number];
  /** Initial state covariance scale (P0 = scale·I). Default 1. */
  initialCovScale?: number;
}

export interface KalmanHedgeResult {
  /** Per-bar filtered output, one entry per input bar. */
  steps: KalmanHedgeStep[];
  /** Final β. */
  beta: number;
  /** Final α. */
  alpha: number;
  /** Convenience: spread series (= steps.map(s => s.spread)). */
  spread: number[];
}

const DEFAULT_DELTA = 1e-4;
const DEFAULT_OBS_VAR = 1e-3;
const DEFAULT_COV_SCALE = 1;

// ============================================================================
// Kalman filter (2-state: [β, α])
// ============================================================================

/**
 * Run the pairs Kalman filter over aligned price series p1, p2.
 *
 * Observation: p1_t = β_t·p2_t + α_t. So we regress p1 ON p2 — β is "units of p2
 * per unit p1" and the spread p1 − β·p2 − α is what mean-reverts. The caller is
 * responsible for passing log-prices if a log-spread is desired.
 *
 * @param p1 Dependent price series (the regressand).
 * @param p2 Independent price series (the regressor).
 */
export function kalmanHedgeRatio(
  p1: number[],
  p2: number[],
  opts: KalmanHedgeOptions = {},
): KalmanHedgeResult {
  const n = Math.min(p1.length, p2.length);
  const delta = opts.delta ?? DEFAULT_DELTA;
  const R = opts.observationVar ?? DEFAULT_OBS_VAR;
  const covScale = opts.initialCovScale ?? DEFAULT_COV_SCALE;

  // State x = [β, α].
  let bx = opts.initialState?.[0] ?? 0;
  let ax = opts.initialState?.[1] ?? 0;

  // State covariance P (2×2, symmetric): [[p00, p01], [p10, p11]].
  let p00 = covScale;
  let p01 = 0;
  let p10 = 0;
  let p11 = covScale;

  // Process-noise W = wc · I (delta-parameterized).
  const wc = delta / (1 - delta);

  const steps: KalmanHedgeStep[] = new Array(n);

  for (let t = 0; t < n; t++) {
    const y = p1[t]!; // observation
    const h0 = p2[t]!; // H = [p2, 1]
    const h1 = 1;

    // ── Predict ──
    // State random-walk: x_pred = x (mean unchanged). Covariance P_pred = P + W.
    const pp00 = p00 + wc;
    const pp01 = p01;
    const pp10 = p10;
    const pp11 = p11 + wc;

    // Predicted observation ŷ = H·x_pred (prior state, unchanged mean).
    const yHat = h0 * bx + h1 * ax;
    const innovation = y - yHat;

    // Innovation variance S = H·P_pred·Hᵀ + R.
    // H·P_pred = [h0·pp00 + h1·pp10, h0·pp01 + h1·pp11].
    const hp0 = h0 * pp00 + h1 * pp10;
    const hp1 = h0 * pp01 + h1 * pp11;
    const S = hp0 * h0 + hp1 * h1 + R;

    // Kalman gain K = P_pred·Hᵀ / S  (2×1).
    // P_pred·Hᵀ = [pp00·h0 + pp01·h1, pp10·h0 + pp11·h1].
    const pht0 = pp00 * h0 + pp01 * h1;
    const pht1 = pp10 * h0 + pp11 * h1;
    const k0 = pht0 / S;
    const k1 = pht1 / S;

    // ── Update ──
    bx = bx + k0 * innovation;
    ax = ax + k1 * innovation;

    // P = (I − K·H)·P_pred. K·H is 2×2 (outer product of K and H):
    //   KH = [[k0·h0, k0·h1], [k1·h0, k1·h1]].
    const kh00 = k0 * h0;
    const kh01 = k0 * h1;
    const kh10 = k1 * h0;
    const kh11 = k1 * h1;

    // (I − KH)·P_pred.
    const n00 = (1 - kh00) * pp00 + -kh01 * pp10;
    const n01 = (1 - kh00) * pp01 + -kh01 * pp11;
    const n10 = -kh10 * pp00 + (1 - kh11) * pp10;
    const n11 = -kh10 * pp01 + (1 - kh11) * pp11;

    p00 = n00;
    p01 = n01;
    p10 = n10;
    p11 = n11;

    const spread = y - bx * h0 - ax * h1;

    steps[t] = { beta: bx, alpha: ax, spread, innovation, innovationVar: S };
  }

  return {
    steps,
    beta: bx,
    alpha: ax,
    spread: steps.map((s) => s.spread),
  };
}
