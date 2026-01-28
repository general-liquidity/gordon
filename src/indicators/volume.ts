/**
 * Volume analysis indicators
 *
 * Volume is a key confirmation tool for price movements.
 * High volume on breakouts suggests conviction, low volume suggests weakness.
 */

import type { Candle } from "../types/index.ts";

/**
 * Calculate Simple Moving Average of volume
 *
 * @param candles - Array of candle data (oldest first)
 * @param period - Lookback period (default: 20)
 * @returns Volume MA or null if insufficient data
 */
export function calculateVolumeMA(candles: Candle[], period: number = 20): number | null {
  if (candles.length < period) {
    return null;
  }

  // Get the last 'period' candles
  const recentCandles = candles.slice(-period);

  // Calculate sum of volumes
  const sum = recentCandles.reduce((acc, candle) => acc + candle.volume, 0);

  return sum / period;
}

/**
 * Calculate Volume Ratio
 *
 * Compares current volume to the moving average.
 * Values > 1 indicate above-average volume, < 1 indicate below-average.
 *
 * @param candles - Array of candle data (oldest first)
 * @param period - Lookback period for MA (default: 20)
 * @returns Volume ratio or null if insufficient data
 */
export function calculateVolumeRatio(candles: Candle[], period: number = 20): number | null {
  if (candles.length < period) {
    return null;
  }

  const volumeMA = calculateVolumeMA(candles, period);

  if (volumeMA === null || volumeMA === 0) {
    return null;
  }

  // Current volume is the last candle's volume
  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) {
    return null;
  }
  const currentVolume = lastCandle.volume;

  return currentVolume / volumeMA;
}

/**
 * Calculate On-Balance Volume (OBV)
 *
 * OBV adds volume on up days and subtracts on down days.
 * Useful for confirming trends and detecting divergences.
 *
 * @param candles - Array of candle data (oldest first)
 * @returns Current OBV value or null if no data
 */
export function calculateOBV(candles: Candle[]): number | null {
  if (candles.length < 2) {
    return null;
  }

  let obv = 0;

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    if (!current || !previous) continue;

    const currentClose = current.close;
    const previousClose = previous.close;
    const volume = current.volume;

    if (currentClose > previousClose) {
      obv += volume;
    } else if (currentClose < previousClose) {
      obv -= volume;
    }
    // If equal, OBV stays the same
  }

  return obv;
}

/**
 * Calculate Volume Weighted Average Price (VWAP)
 *
 * VWAP is the average price weighted by volume.
 * Often used as a benchmark - price above VWAP suggests bullish bias.
 *
 * @param candles - Array of candle data (oldest first)
 * @returns VWAP value or null if no data
 */
export function calculateVWAP(candles: Candle[]): number | null {
  if (candles.length === 0) {
    return null;
  }

  let cumulativeTPV = 0; // Typical Price * Volume
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;
  }

  if (cumulativeVolume === 0) {
    return null;
  }

  return cumulativeTPV / cumulativeVolume;
}
