/**
 * Microstructure-derived SIGNAL primitives — the directional layer sitting on
 * top of the raw book-imbalance / microprice measurements in
 * `book-imbalance.ts`. Those primitives MEASURE the book (imbalance ∈ [−1,+1],
 * microprice-vs-mid lean); these turn a measurement into a directional view
 * (long / short / flat, with a strength in roughly [−1,+1]).
 *
 * Conventions (shared with the measurement layer):
 *   - Positive imbalance = bid-heavy book → upward (long) pressure.
 *   - Positive micropriceVsMid = microprice ABOVE the mid (size leans to the
 *     bid, pushing the fair price up) → upward (long) pressure.
 *   - Sign of every output: + = long bias, − = short bias, 0 = no view.
 *
 * Pure & defensive: empty / NaN inputs collapse to a neutral 0. No I/O, no
 * allocation beyond a scratch slice for the lookback window.
 */

/** Clamp to [−1, +1]; NaN → 0. */
function clamp1(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x > 1) return 1;
  if (x < -1) return -1;
  return x;
}

/** Mean of a numeric slice, ignoring non-finite entries. 0 when none finite. */
function finiteMean(xs: number[]): number {
  let sum = 0;
  let n = 0;
  for (const v of xs) {
    if (Number.isFinite(v)) {
      sum += v;
      n += 1;
    }
  }
  return n === 0 ? 0 : sum / n;
}

/**
 * Recent microprice-vs-mid drift as a signed pressure direction. The
 * microprice leans toward the thicker side, so a series of micropriceVsMid
 * values trending positive = persistent bid-side size pressure (upward).
 *
 * Returns the mean of the last `lookback` finite values, normalized by the
 * largest recent magnitude so the result is a unit-scaled pressure in
 * [−1, +1] rather than raw (tiny) price units. The sign is the pressure
 * direction; the magnitude is how decisively the recent window leans one way.
 *
 * Empty input / lookback <= 0 → 0.
 */
export function micropriceMomentum(micropriceVsMidSeries: number[], lookback: number): number {
  if (!Array.isArray(micropriceVsMidSeries) || micropriceVsMidSeries.length === 0) return 0;
  if (!Number.isFinite(lookback) || lookback <= 0) return 0;

  const start = Math.max(0, micropriceVsMidSeries.length - Math.floor(lookback));
  const window = micropriceVsMidSeries.slice(start);

  const avg = finiteMean(window);
  if (avg === 0) return 0;

  // Normalize by the largest recent magnitude → unit-scaled direction/strength.
  let maxMag = 0;
  for (const v of window) {
    if (Number.isFinite(v)) maxMag = Math.max(maxMag, Math.abs(v));
  }
  if (maxMag === 0) return 0;

  return clamp1(avg / maxMag);
}

/**
 * Discrete imbalance signal from a standardized imbalance z-score. A book that
 * is bid-heavy beyond +threshold standard deviations signals upward pressure
 * (long); ask-heavy beyond −threshold signals short. Inside the band → no view.
 *
 * NaN z / non-finite threshold → 0.
 */
export function imbalanceSignal(imbalanceZ: number, threshold = 1): -1 | 0 | 1 {
  if (!Number.isFinite(imbalanceZ) || !Number.isFinite(threshold)) return 0;
  const t = Math.abs(threshold);
  if (imbalanceZ > t) return 1;
  if (imbalanceZ < -t) return -1;
  return 0;
}

export interface OrderFlowInputs {
  /** Book imbalance ∈ [−1, +1]; positive = bid-heavy (upward pressure). */
  imbalance: number;
  /** Microprice-vs-mid lean; positive = microprice above mid (upward pressure).
   *  Raw price units — only its sign is used here. */
  micropriceVsMid: number;
}

export interface OrderFlowPressureOptions {
  /**
   * Weight on the book-imbalance leg (0..1). The micropriceVsMid leg gets the
   * complement. Default 0.6 — imbalance is the primary, continuous signal;
   * microprice lean is a sign-only confirmation/veto. Out-of-range / NaN →
   * clamped into [0,1] with the default on NaN.
   */
  imbalanceWeight?: number;
}

/**
 * Combined directional order-flow pressure in roughly [−1, +1]. Blends the
 * continuous book imbalance with the microprice lean:
 *
 *   - AGREE (both bid-heavy, or both ask-heavy): the legs reinforce → strong
 *     pressure in that direction.
 *   - CONFLICT (imbalance says one way, microprice the other): the legs partly
 *     cancel → weak / near-0 pressure. A flat (zero) microprice lean halves the
 *     imbalance's contribution rather than vetoing it outright.
 *
 * The imbalance leg is continuous (carries magnitude); the microprice leg is
 * sign-only (its raw magnitude is in price units and not comparable), so it
 * acts as a directional confirmation/veto scaled by `1 − imbalanceWeight`.
 *
 * Pure; NaN/empty fields treated as neutral 0.
 */
export function orderFlowPressure(
  inputs: OrderFlowInputs,
  options: OrderFlowPressureOptions = {},
): number {
  const imbalance = Number.isFinite(inputs?.imbalance) ? clamp1(inputs.imbalance) : 0;
  const microRaw = Number.isFinite(inputs?.micropriceVsMid) ? inputs.micropriceVsMid : 0;
  const microSign = microRaw > 0 ? 1 : microRaw < 0 ? -1 : 0;

  let w = options.imbalanceWeight;
  if (!Number.isFinite(w as number)) w = 0.6;
  w = Math.min(1, Math.max(0, w as number));

  // Imbalance leg: continuous and signed. Microprice leg: sign-only, weighted
  // by its complement. They are summed directly, so legs that AGREE in sign
  // reinforce (push toward ±1) and legs that CONFLICT cancel (toward 0). A flat
  // microprice (sign 0) leaves only the imbalance leg, scaled by w.
  const imbLeg = w * imbalance;
  const microLeg = (1 - w) * microSign;

  return clamp1(imbLeg + microLeg);
}
