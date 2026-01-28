/**
 * RSI (Relative Strength Index) calculation
 *
 * RSI measures momentum by comparing recent gains to recent losses.
 * Values above 70 indicate overbought conditions, below 30 indicate oversold.
 */

import type { Candle } from "../types/index.ts";

/**
 * Calculate the Simple Moving Average of an array of numbers
 */
export function calculateSMA(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((acc, val) => acc + val, 0);
  return sum / values.length;
}

/**
 * Calculate the Exponential Moving Average
 * Uses the standard smoothing factor: 2 / (period + 1)
 */
export function calculateEMA(values: number[], period: number): number | null {
  if (values.length < period) return null;

  const multiplier = 2 / (period + 1);

  // Start with SMA for the first 'period' values
  let ema = calculateSMA(values.slice(0, period));

  // Apply EMA formula for remaining values
  for (let i = period; i < values.length; i++) {
    ema = ((values[i] ?? 0) - ema) * multiplier + ema;
  }

  return ema;
}

/**
 * Calculate RSI (Relative Strength Index)
 *
 * Formula: RSI = 100 - (100 / (1 + RS))
 * Where RS = Average Gain / Average Loss over the period
 *
 * @param candles - Array of candle data (oldest first)
 * @param period - Lookback period (default: 14)
 * @returns RSI value between 0-100, or null if insufficient data
 */
export function calculateRSI(candles: Candle[], period: number = 14): number | null {
  // Need at least period + 1 candles to calculate period changes
  if (candles.length < period + 1) {
    return null;
  }

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const previous = candles[i - 1];
    if (current && previous) {
      changes.push(current.close - previous.close);
    }
  }

  // Separate gains and losses
  const gains: number[] = [];
  const losses: number[] = [];

  for (const change of changes) {
    if (change > 0) {
      gains.push(change);
      losses.push(0);
    } else {
      gains.push(0);
      losses.push(Math.abs(change));
    }
  }

  // Calculate initial average gain and loss using SMA
  let avgGain = calculateSMA(gains.slice(0, period));
  let avgLoss = calculateSMA(losses.slice(0, period));

  // Use Wilder's smoothing method for subsequent values
  // avgGain = (prevAvgGain * (period - 1) + currentGain) / period
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + (gains[i] ?? 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (losses[i] ?? 0)) / period;
  }

  // Avoid division by zero
  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100; // No movement = 50, all gains = 100
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}
