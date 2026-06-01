/**
 * Average Directional Movement Rating (ADXR)
 * Smoothed ADX: the average of the current ADX and the ADX `period` bars ago.
 * Wilder used it to dampen ADX noise for trend-vs-range classification.
 *
 *   ADXR = (ADX[now] + ADX[now - period]) / 2
 *
 * Reuses calculateADX from adx.ts read-only.
 */

import type { Candle } from "./types.ts";
import { calculateADX } from "./adx.ts";

export interface ADXRResult {
  /** Current ADXR value (0-100) */
  current: number | null;
  /** Current ADX value (0-100) */
  adx: number | null;
  /** Trend strength classification */
  trendStrength: "strong" | "moderate" | "weak" | "absent";
  /** Interpretation string */
  interpretation: string;
  /** Period */
  period: number;
}

/**
 * Calculate ADXR.
 *
 * @param candles - OHLCV candle array
 * @param period - ADX/ADXR period (default 14)
 * @returns ADXRResult
 */
export function calculateADXR(candles: Candle[], period: number = 14): ADXRResult {
  const adxResult = calculateADX(candles, period);
  const adxSeries = adxResult.adxValues;

  // Need at least `period` ADX values to look back one full period.
  if (adxSeries.length < period + 1) {
    return {
      current: null,
      adx: adxResult.adx,
      trendStrength: "absent",
      interpretation: "Insufficient data for ADXR calculation",
      period,
    };
  }

  const currentADX = adxSeries[adxSeries.length - 1]!;
  const pastADX = adxSeries[adxSeries.length - 1 - period]!;
  const adxr = parseFloat(((currentADX + pastADX) / 2).toFixed(2));

  let trendStrength: "strong" | "moderate" | "weak" | "absent" = "absent";
  if (adxr >= 25) trendStrength = "strong";
  else if (adxr >= 20) trendStrength = "moderate";
  else if (adxr >= 10) trendStrength = "weak";

  const interpretation = `ADXR: ${adxr.toFixed(1)} (${trendStrength} trend) — smoothed ADX, current ADX ${currentADX.toFixed(1)}.`;

  return {
    current: adxr,
    adx: adxResult.adx,
    trendStrength,
    interpretation,
    period,
  };
}
