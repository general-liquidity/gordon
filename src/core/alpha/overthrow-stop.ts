/**
 * Overthrow stop placement (CryptoCred lesson).
 *
 * When price breaks a level, overshoots (deviates past) it, then reclaims it,
 * the stop goes at EITHER the furthermost deviation (extreme of the overshoot
 * excursion — the conservative, wider stop) OR the thrust candle (the reclaim
 * candle's extreme — the tighter stop). This computes both from OHLC + the
 * broken level + side.
 *
 * Distinct from price-deviation-guard.ts (a pre-order abnormal-price gate) —
 * this is a pure trade-management primitive, not a safety gate.
 */

import type { Candle } from "../indicators/types.ts";

export interface OverthrowStopInput {
  candles: Candle[];
  brokenLevel: number;
  side: "long" | "short";
  lookback?: number;
}

export interface OverthrowStopResult {
  furthermostDeviationStop: number; // extreme of the overshoot excursion (the conservative, wider stop)
  thrustCandleStop: number; // the reclaim candle's extreme (the tighter stop)
  recommended: number; // = furthermostDeviationStop (the safer default)
  overshootBars: number; // count of bars on the wrong side before reclaim
  deviationPct: number; // |furthermostDeviationStop - brokenLevel| / brokenLevel * 100
  caution: string | null; // warn if thrustCandleStop sits within ~0.1% of brokenLevel
  interpretation: string;
}

function round(x: number, n: number): number {
  return parseFloat(x.toFixed(n));
}

export function computeOverthrowStop(input: OverthrowStopInput): OverthrowStopResult | null {
  const { candles, brokenLevel, side } = input;
  const lookback = input.lookback ?? 20;

  if (!Number.isFinite(brokenLevel) || brokenLevel <= 0) return null;
  if (!Array.isArray(candles) || candles.length < 2) return null;
  if (side !== "long" && side !== "short") return null;

  const window = candles.slice(-lookback);
  const n = window.length;

  if (side === "long") {
    // Reclaim: most recent bar that closed back ABOVE the broken level.
    let thrustIdx = -1;
    for (let i = n - 1; i >= 0; i--) {
      const bar = window[i]!;
      if (bar.close > brokenLevel) {
        thrustIdx = i;
        break;
      }
    }
    if (thrustIdx < 0) return null;

    const thrustCandleStop = window[thrustIdx]!.low;

    // Overshoot excursion = contiguous run of immediately-preceding bars
    // whose LOW < brokenLevel.
    let minLow = Infinity;
    let overshootBars = 0;
    for (let i = thrustIdx - 1; i >= 0; i--) {
      const bar = window[i]!;
      if (bar.low < brokenLevel) {
        overshootBars++;
        if (bar.low < minLow) minLow = bar.low;
      } else {
        break;
      }
    }
    if (overshootBars === 0) return null;

    const furthermostDeviationStop = round(minLow, 4);
    const tcStop = round(thrustCandleStop, 4);
    const deviationPct = round(
      (Math.abs(furthermostDeviationStop - brokenLevel) / brokenLevel) * 100,
      2,
    );
    const caution =
      Math.abs(tcStop - brokenLevel) / brokenLevel < 0.001
        ? "stop is essentially at the level"
        : null;

    return {
      furthermostDeviationStop,
      thrustCandleStop: tcStop,
      recommended: furthermostDeviationStop,
      overshootBars,
      deviationPct,
      caution,
      interpretation: `Long reclaim of ${brokenLevel}: ${overshootBars}-bar overshoot to ${furthermostDeviationStop} (${deviationPct}% beyond level). Conservative stop ${furthermostDeviationStop} (furthermost deviation); tighter stop ${tcStop} (thrust candle low).`,
    };
  }

  // side === "short": mirror.
  let thrustIdx = -1;
  for (let i = n - 1; i >= 0; i--) {
    const bar = window[i]!;
    if (bar.close < brokenLevel) {
      thrustIdx = i;
      break;
    }
  }
  if (thrustIdx < 0) return null;

  const thrustCandleStop = window[thrustIdx]!.high;

  let maxHigh = -Infinity;
  let overshootBars = 0;
  for (let i = thrustIdx - 1; i >= 0; i--) {
    const bar = window[i]!;
    if (bar.high > brokenLevel) {
      overshootBars++;
      if (bar.high > maxHigh) maxHigh = bar.high;
    } else {
      break;
    }
  }
  if (overshootBars === 0) return null;

  const furthermostDeviationStop = round(maxHigh, 4);
  const tcStop = round(thrustCandleStop, 4);
  const deviationPct = round(
    (Math.abs(furthermostDeviationStop - brokenLevel) / brokenLevel) * 100,
    2,
  );
  const caution =
    Math.abs(tcStop - brokenLevel) / brokenLevel < 0.001
      ? "stop is essentially at the level"
      : null;

  return {
    furthermostDeviationStop,
    thrustCandleStop: tcStop,
    recommended: furthermostDeviationStop,
    overshootBars,
    deviationPct,
    caution,
    interpretation: `Short reclaim of ${brokenLevel}: ${overshootBars}-bar overshoot to ${furthermostDeviationStop} (${deviationPct}% beyond level). Conservative stop ${furthermostDeviationStop} (furthermost deviation); tighter stop ${tcStop} (thrust candle high).`,
  };
}
