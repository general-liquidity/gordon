/**
 * Touch-Level Dynamics Monitor (GORDON_TOUCH_DYNAMICS).
 *
 * Tracks the volatility of the best bid/offer over a sliding window.
 * Quote stuffing at the touch (Section 4.4 of the microstructure piece)
 * shows up as rapid quote-update intensity, displayed-size flicker, and
 * spread volatility — all observable at L2.
 *
 *   Signals computed:
 *     - update rate (quote events per second at the touch)
 *     - size flicker (coefficient of variation of displayed size at best)
 *     - spread volatility (stddev of spread / mean spread)
 *     - mid-price jitter (high-frequency reversals in the mid)
 *
 * Used as a sub-signal for MS1 microstructureToxicity. Standalone
 * verdict for "is the touch being puppeted right now?" via a composite
 * score thresholded into quiet / elevated / hot.
 */

export interface TouchSnapshot {
  t: number;
  bestBid: number;
  bestAsk: number;
  bidSize: number;
  askSize: number;
}

export interface TouchDynamicsInput {
  snapshots: ReadonlyArray<TouchSnapshot>;
  /** Threshold for "hot" verdict on composite score. Default 0.6. */
  hotThreshold?: number;
  /** Threshold for "elevated" verdict. Default 0.3. */
  elevatedThreshold?: number;
}

export type TouchState = "quiet" | "elevated" | "hot";

export interface TouchDynamicsResult {
  updateRatePerSec: number;
  sizeFlickerCv: number;
  spreadVolatility: number;
  midJitter: number;
  compositeScore: number;
  state: TouchState;
  sampleSize: number;
  reason: string;
}

const DEFAULT_HOT = 0.6;
const DEFAULT_ELEVATED = 0.3;

function meanOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const v of xs) s += v;
  return s / xs.length;
}

function stddevOf(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = meanOf(xs);
  let s = 0;
  for (const v of xs) {
    const d = v - m;
    s += d * d;
  }
  return Math.sqrt(s / xs.length);
}

export function evaluateTouchDynamics(input: TouchDynamicsInput): TouchDynamicsResult {
  const snaps = input.snapshots;
  const n = snaps.length;

  if (n < 5) {
    return {
      updateRatePerSec: 0,
      sizeFlickerCv: 0,
      spreadVolatility: 0,
      midJitter: 0,
      compositeScore: 0,
      state: "quiet",
      sampleSize: n,
      reason: "insufficient samples",
    };
  }

  const windowMs = snaps[n - 1]!.t - snaps[0]!.t;
  const updateRate = windowMs > 0 ? (n * 1000) / windowMs : 0;

  const sizes: number[] = [];
  const spreads: number[] = [];
  const mids: number[] = [];
  for (const s of snaps) {
    sizes.push((s.bidSize + s.askSize) / 2);
    spreads.push(s.bestAsk - s.bestBid);
    mids.push((s.bestBid + s.bestAsk) / 2);
  }

  const meanSize = meanOf(sizes);
  const sizeFlickerCv = meanSize > 0 ? stddevOf(sizes) / meanSize : 0;

  const meanSpread = meanOf(spreads);
  const spreadVol = meanSpread > 0 ? stddevOf(spreads) / meanSpread : 0;

  let reversals = 0;
  for (let i = 2; i < mids.length; i++) {
    const d1 = mids[i - 1]! - mids[i - 2]!;
    const d2 = mids[i]! - mids[i - 1]!;
    if (d1 !== 0 && d2 !== 0 && Math.sign(d1) !== Math.sign(d2)) reversals++;
  }
  const midJitter = mids.length > 2 ? reversals / (mids.length - 2) : 0;

  const rateScore = Math.min(1, updateRate / 50);
  const compositeScore =
    rateScore * 0.3 +
    Math.min(1, sizeFlickerCv) * 0.3 +
    Math.min(1, spreadVol) * 0.2 +
    midJitter * 0.2;

  const hotT = input.hotThreshold ?? DEFAULT_HOT;
  const elevT = input.elevatedThreshold ?? DEFAULT_ELEVATED;
  let state: TouchState = "quiet";
  if (compositeScore >= hotT) state = "hot";
  else if (compositeScore >= elevT) state = "elevated";

  const reason =
    `${updateRate.toFixed(1)} updates/s, size CV ${sizeFlickerCv.toFixed(2)}, ` +
    `spread vol ${spreadVol.toFixed(2)}, mid jitter ${midJitter.toFixed(2)} → score ${compositeScore.toFixed(2)}`;

  return {
    updateRatePerSec: updateRate,
    sizeFlickerCv,
    spreadVolatility: spreadVol,
    midJitter,
    compositeScore,
    state,
    sampleSize: n,
    reason,
  };
}

export function touchDynamicsToPayload(result: TouchDynamicsResult): Record<string, unknown> {
  return {
    kind: "touch_dynamics.evaluated",
    state: result.state,
    compositeScore: Number(result.compositeScore.toFixed(3)),
    updateRatePerSec: Number(result.updateRatePerSec.toFixed(2)),
    sizeFlickerCv: Number(result.sizeFlickerCv.toFixed(3)),
    spreadVolatility: Number(result.spreadVolatility.toFixed(3)),
    midJitter: Number(result.midJitter.toFixed(3)),
  };
}
