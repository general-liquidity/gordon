/**
 * Commodity Channel Index (CCI)
 * Measures deviation of typical price from its moving average, scaled by mean
 * deviation. CCI > +100 = strong uptrend/overbought, CCI < -100 = strong
 * downtrend/oversold.
 *
 *   TP    = (high + low + close) / 3
 *   CCI   = (TP - SMA(TP, n)) / (0.015 * meanDeviation)
 *
 * Lambert's original constant 0.015 makes ~70-80% of values fall in ±100.
 */

import type { Candle } from "./types.ts";

export interface CCIResult {
  /** Current CCI value */
  current: number | null;
  /** CCI series (null during warmup) */
  values: (number | null)[];
  /** Signal zone */
  signal: "overbought" | "oversold" | "neutral";
  /** Interpretation string */
  interpretation: string;
  /** Lookback period */
  period: number;
}

/**
 * Calculate Commodity Channel Index.
 *
 * @param candles - OHLCV candle array
 * @param period - Lookback period (default 20)
 * @returns CCIResult
 */
export function calculateCCI(candles: Candle[], period: number = 20): CCIResult {
  if (candles.length < period) {
    return {
      current: null,
      values: candles.map(() => null),
      signal: "neutral",
      interpretation: "Insufficient data for CCI calculation",
      period,
    };
  }

  const tp: number[] = candles.map((c) => (c.high + c.low + c.close) / 3);
  const values: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      values.push(null);
      continue;
    }

    // SMA of typical price over the window
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) sum += tp[j]!;
    const smaTP = sum / period;

    // Mean absolute deviation from the SMA
    let madSum = 0;
    for (let j = i - period + 1; j <= i; j++) madSum += Math.abs(tp[j]! - smaTP);
    const meanDev = madSum / period;

    if (meanDev < 1e-10) {
      values.push(0);
    } else {
      const cci = (tp[i]! - smaTP) / (0.015 * meanDev);
      values.push(parseFloat(cci.toFixed(2)));
    }
  }

  const current = values[values.length - 1] ?? null;

  let signal: "overbought" | "oversold" | "neutral" = "neutral";
  if (current !== null) {
    if (current > 100) signal = "overbought";
    else if (current < -100) signal = "oversold";
  }

  let interpretation = "";
  if (current === null) {
    interpretation = "Insufficient data for CCI.";
  } else if (signal === "overbought") {
    interpretation = `CCI: ${current.toFixed(1)} — above +100, strong upward momentum / overbought.`;
  } else if (signal === "oversold") {
    interpretation = `CCI: ${current.toFixed(1)} — below -100, strong downward momentum / oversold.`;
  } else {
    interpretation = `CCI: ${current.toFixed(1)} — within ±100, no extreme trend reading.`;
  }

  return { current, values, signal, interpretation, period };
}
