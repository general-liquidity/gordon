/**
 * Williams %R
 * Momentum oscillator on a 0 to -100 scale showing close relative to the
 * high-low range over the lookback. -20 to 0 = overbought, -100 to -80 = oversold.
 *
 *   %R = (highestHigh - close) / (highestHigh - lowestLow) * -100
 */

import type { Candle } from "./types.ts";

export interface WilliamsRResult {
  /** Current %R value (0 to -100) */
  current: number | null;
  /** %R series (null during warmup) */
  values: (number | null)[];
  /** Signal zone */
  signal: "overbought" | "oversold" | "neutral";
  /** Interpretation string */
  interpretation: string;
  /** Lookback period */
  period: number;
}

/**
 * Calculate Williams %R.
 *
 * @param candles - OHLCV candle array
 * @param period - Lookback period (default 14)
 * @returns WilliamsRResult
 */
export function calculateWilliamsR(candles: Candle[], period: number = 14): WilliamsRResult {
  if (candles.length < period) {
    return {
      current: null,
      values: candles.map(() => null),
      signal: "neutral",
      interpretation: "Insufficient data for Williams %R calculation",
      period,
    };
  }

  const values: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      values.push(null);
      continue;
    }

    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j]!.high > highestHigh) highestHigh = candles[j]!.high;
      if (candles[j]!.low < lowestLow) lowestLow = candles[j]!.low;
    }

    const range = highestHigh - lowestLow;
    if (range < 1e-10) {
      values.push(-50);
    } else {
      const wr = ((highestHigh - candles[i]!.close) / range) * -100;
      values.push(parseFloat(wr.toFixed(2)));
    }
  }

  const current = values[values.length - 1] ?? null;

  let signal: "overbought" | "oversold" | "neutral" = "neutral";
  if (current !== null) {
    if (current > -20) signal = "overbought";
    else if (current < -80) signal = "oversold";
  }

  let interpretation = "";
  if (current === null) {
    interpretation = "Insufficient data for Williams %R.";
  } else if (signal === "overbought") {
    interpretation = `Williams %R: ${current.toFixed(1)} — overbought (close near range high), watch for pullback.`;
  } else if (signal === "oversold") {
    interpretation = `Williams %R: ${current.toFixed(1)} — oversold (close near range low), watch for bounce.`;
  } else {
    interpretation = `Williams %R: ${current.toFixed(1)} — mid-range, no extreme.`;
  }

  return { current, values, signal, interpretation, period };
}
