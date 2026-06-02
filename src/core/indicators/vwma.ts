/**
 * Volume-Weighted Moving Average (VWMA)
 * A moving average that weights each close by its bar volume, so high-volume
 * bars dominate the average. Tracks price like an SMA but leans toward the
 * levels where real participation occurred.
 *
 *   VWMA = Σ(close · volume) / Σ(volume)   over the last `period` bars
 *
 * With equal volumes this collapses to a simple moving average.
 */

import type { Candle } from "./types.ts";

/**
 * Calculate the Volume-Weighted Moving Average.
 *
 * @param candles - OHLCV candle array
 * @param period - Lookback period (default 20)
 * @returns Aligned VWMA series (null during warmup)
 */
export function calculateVWMA(candles: Candle[], period: number = 20): (number | null)[] {
  if (candles.length < period || period < 1) return candles.map(() => null);

  const out: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      out.push(null);
      continue;
    }

    let pv = 0;
    let vol = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const c = candles[j]!;
      pv += c.close * c.volume;
      vol += c.volume;
    }

    if (vol <= 0) {
      // No volume in the window → fall back to an unweighted mean of closes.
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += candles[j]!.close;
      out.push(parseFloat((sum / period).toFixed(4)));
    } else {
      out.push(parseFloat((pv / vol).toFixed(4)));
    }
  }

  return out;
}
