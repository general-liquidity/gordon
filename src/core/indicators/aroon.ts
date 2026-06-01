/**
 * Aroon + Aroon Oscillator
 * Measures how long since the highest high / lowest low within the lookback,
 * identifying trend strength and direction.
 *
 *   AroonUp   = 100 * (period - barsSinceHighestHigh) / period
 *   AroonDown = 100 * (period - barsSinceLowestLow)  / period
 *   AroonOsc  = AroonUp - AroonDown
 *
 * AroonUp near 100 = fresh highs (uptrend); AroonDown near 100 = fresh lows.
 * Note: the lookback window spans period+1 bars (the current bar plus `period`
 * prior bars), per the standard Aroon definition.
 */

import type { Candle } from "./types.ts";

export interface AroonResult {
  /** Current Aroon Up (0-100) */
  up: number | null;
  /** Current Aroon Down (0-100) */
  down: number | null;
  /** Current Aroon Oscillator (-100 to +100) */
  oscillator: number | null;
  /** Aroon Up series */
  upValues: (number | null)[];
  /** Aroon Down series */
  downValues: (number | null)[];
  /** Aroon Oscillator series */
  oscValues: (number | null)[];
  /** Trend classification */
  trend: "uptrend" | "downtrend" | "consolidating";
  /** Interpretation string */
  interpretation: string;
  /** Lookback period */
  period: number;
}

/**
 * Calculate Aroon and Aroon Oscillator.
 *
 * @param candles - OHLCV candle array
 * @param period - Lookback period (default 25)
 * @returns AroonResult
 */
export function calculateAroon(candles: Candle[], period: number = 25): AroonResult {
  if (candles.length < period + 1) {
    return {
      up: null,
      down: null,
      oscillator: null,
      upValues: candles.map(() => null),
      downValues: candles.map(() => null),
      oscValues: candles.map(() => null),
      trend: "consolidating",
      interpretation: "Insufficient data for Aroon calculation",
      period,
    };
  }

  const upValues: (number | null)[] = [];
  const downValues: (number | null)[] = [];
  const oscValues: (number | null)[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      upValues.push(null);
      downValues.push(null);
      oscValues.push(null);
      continue;
    }

    // Window of period+1 bars ending at i.
    let highestHigh = -Infinity;
    let lowestLow = Infinity;
    let highIdx = i;
    let lowIdx = i;
    for (let j = i - period; j <= i; j++) {
      if (candles[j]!.high >= highestHigh) {
        highestHigh = candles[j]!.high;
        highIdx = j;
      }
      if (candles[j]!.low <= lowestLow) {
        lowestLow = candles[j]!.low;
        lowIdx = j;
      }
    }

    const barsSinceHigh = i - highIdx;
    const barsSinceLow = i - lowIdx;
    const up = (100 * (period - barsSinceHigh)) / period;
    const down = (100 * (period - barsSinceLow)) / period;

    upValues.push(parseFloat(up.toFixed(2)));
    downValues.push(parseFloat(down.toFixed(2)));
    oscValues.push(parseFloat((up - down).toFixed(2)));
  }

  const up = upValues[upValues.length - 1] ?? null;
  const down = downValues[downValues.length - 1] ?? null;
  const oscillator = oscValues[oscValues.length - 1] ?? null;

  let trend: "uptrend" | "downtrend" | "consolidating" = "consolidating";
  if (up !== null && down !== null) {
    if (up > 70 && down < 30) trend = "uptrend";
    else if (down > 70 && up < 30) trend = "downtrend";
  }

  let interpretation = "";
  if (up === null || down === null) {
    interpretation = "Insufficient data for Aroon.";
  } else if (trend === "uptrend") {
    interpretation = `Aroon Up ${up.toFixed(0)} / Down ${down.toFixed(0)} — established uptrend (fresh highs).`;
  } else if (trend === "downtrend") {
    interpretation = `Aroon Up ${up.toFixed(0)} / Down ${down.toFixed(0)} — established downtrend (fresh lows).`;
  } else {
    interpretation = `Aroon Up ${up.toFixed(0)} / Down ${down.toFixed(0)} — consolidating / no clear trend.`;
  }

  return {
    up,
    down,
    oscillator,
    upValues,
    downValues,
    oscValues,
    trend,
    interpretation,
    period,
  };
}
