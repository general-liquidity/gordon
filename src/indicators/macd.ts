/**
 * MACD (Moving Average Convergence Divergence) calculation
 *
 * MACD is a trend-following momentum indicator showing the relationship
 * between two moving averages of a security's price.
 */

import type { Candle } from "../types/index.ts";

/**
 * Calculate EMA for a series of values
 * Returns all EMA values (one for each input after the initial period)
 */
function calculateEMASeries(values: number[], period: number): number[] {
  if (values.length < period) return [];

  const multiplier = 2 / (period + 1);
  const emaValues: number[] = [];

  // Start with SMA for the first 'period' values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i] ?? 0;
  }
  let ema = sum / period;
  emaValues.push(ema);

  // Apply EMA formula for remaining values
  for (let i = period; i < values.length; i++) {
    ema = ((values[i] ?? 0) - ema) * multiplier + ema;
    emaValues.push(ema);
  }

  return emaValues;
}

/**
 * Calculate single EMA value from a series
 */
function calculateEMA(values: number[], period: number): number | null {
  const series = calculateEMASeries(values, period);
  if (series.length === 0) return null;
  return series[series.length - 1] ?? null;
}

export interface MACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 *
 * MACD Line = Fast EMA - Slow EMA
 * Signal Line = EMA of MACD Line
 * Histogram = MACD Line - Signal Line
 *
 * @param candles - Array of candle data (oldest first)
 * @param fastPeriod - Fast EMA period (default: 12)
 * @param slowPeriod - Slow EMA period (default: 26)
 * @param signalPeriod - Signal line EMA period (default: 9)
 * @returns MACD values or null if insufficient data
 */
export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult | null {
  // Need enough data for slow EMA + signal period
  const minRequired = slowPeriod + signalPeriod - 1;
  if (candles.length < minRequired) {
    return null;
  }

  // Extract closing prices
  const closes = candles.map(c => c.close);

  // Calculate fast and slow EMA series
  const fastEMASeries = calculateEMASeries(closes, fastPeriod);
  const slowEMASeries = calculateEMASeries(closes, slowPeriod);

  if (fastEMASeries.length === 0 || slowEMASeries.length === 0) {
    return null;
  }

  // Align the series - slow EMA starts later
  // Fast EMA starts at index fastPeriod-1, slow EMA starts at index slowPeriod-1
  // Difference in start: slowPeriod - fastPeriod
  const offset = slowPeriod - fastPeriod;

  // Calculate MACD line (fast EMA - slow EMA)
  // We align from the slow EMA start point
  const macdLine: number[] = [];
  for (let i = 0; i < slowEMASeries.length; i++) {
    const fastIndex = i + offset;
    const fastValue = fastEMASeries[fastIndex];
    const slowValue = slowEMASeries[i];
    if (fastIndex < fastEMASeries.length && fastValue !== undefined && slowValue !== undefined) {
      macdLine.push(fastValue - slowValue);
    }
  }

  if (macdLine.length < signalPeriod) {
    return null;
  }

  // Calculate signal line (EMA of MACD line)
  const signalLine = calculateEMA(macdLine, signalPeriod);

  if (signalLine === null) {
    return null;
  }

  // Get the latest MACD value
  const latestMACD = macdLine[macdLine.length - 1];

  if (latestMACD === undefined) {
    return null;
  }

  // Calculate histogram
  const histogram = latestMACD - signalLine;

  return {
    macd: latestMACD,
    signal: signalLine,
    histogram: histogram,
  };
}
