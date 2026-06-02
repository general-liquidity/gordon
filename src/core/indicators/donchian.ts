/**
 * Donchian Channel
 * Rolling high/low envelope over a lookback window — the classic Turtle
 * breakout band.
 *
 *   upper  = max(high)  over the last `period` bars
 *   lower  = min(low)   over the last `period` bars
 *   middle = (upper + lower) / 2
 *
 * Price tagging the upper band is a `period`-bar breakout to the upside; the
 * lower band, a breakout to the downside. The middle band acts as a mean.
 */

import type { Candle } from "./types.ts";

export interface DonchianResult {
  /** Upper band series (null during warmup) */
  upper: (number | null)[];
  /** Lower band series (null during warmup) */
  lower: (number | null)[];
  /** Middle band series (null during warmup) */
  middle: (number | null)[];
  /** Latest band values, or null if insufficient data */
  current: { upper: number; lower: number; middle: number } | null;
  /** Interpretation string */
  interpretation: string;
  /** Lookback period */
  period: number;
}

/**
 * Calculate the Donchian Channel.
 *
 * @param candles - OHLCV candle array
 * @param period - Lookback period (default 20)
 * @returns DonchianResult
 */
export function calculateDonchian(candles: Candle[], period: number = 20): DonchianResult {
  if (candles.length < period || period < 1) {
    return {
      upper: candles.map(() => null),
      lower: candles.map(() => null),
      middle: candles.map(() => null),
      current: null,
      interpretation: "Insufficient data for Donchian Channel calculation",
      period,
    };
  }

  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const middle: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      middle.push(null);
      continue;
    }

    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const c = candles[j]!;
      if (c.high > hi) hi = c.high;
      if (c.low < lo) lo = c.low;
    }
    const mid = (hi + lo) / 2;
    upper.push(parseFloat(hi.toFixed(4)));
    lower.push(parseFloat(lo.toFixed(4)));
    middle.push(parseFloat(mid.toFixed(4)));
  }

  const u = upper[upper.length - 1];
  const l = lower[lower.length - 1];
  const m = middle[middle.length - 1];
  const current = u == null || l == null || m == null ? null : { upper: u, lower: l, middle: m };

  let interpretation = "";
  if (current === null) {
    interpretation = "Insufficient data for Donchian Channel.";
  } else {
    const close = candles[candles.length - 1]!.close;
    if (close >= current.upper) {
      interpretation = `Price ${close} at/above Donchian upper ${current.upper} — ${period}-bar breakout (bullish).`;
    } else if (close <= current.lower) {
      interpretation = `Price ${close} at/below Donchian lower ${current.lower} — ${period}-bar breakdown (bearish).`;
    } else {
      interpretation = `Price ${close} inside Donchian band [${current.lower}, ${current.upper}] (mid ${current.middle}).`;
    }
  }

  return { upper, lower, middle, current, interpretation, period };
}
