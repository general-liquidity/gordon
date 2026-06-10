/**
 * Scanner indicator bundle
 *
 * Scalar RSI/MACD/volume calculations used by the market scanner and analyzer.
 * Distinct from the richer indicator suite in core/indicators/index.ts.
 */

import type { Candle, Indicators, Level } from "../../types/market.ts";
import { detectLevels } from "./price-levels.ts";

// ============================================================================
// RSI
// ============================================================================

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
  for (let i = period; i < gains.length; i++) {
    avgGain = (avgGain * (period - 1) + (gains[i] ?? 0)) / period;
    avgLoss = (avgLoss * (period - 1) + (losses[i] ?? 0)) / period;
  }

  // Avoid division by zero
  if (avgLoss === 0) {
    return avgGain === 0 ? 50 : 100;
  }

  const rs = avgGain / avgLoss;
  const rsi = 100 - (100 / (1 + rs));

  return rsi;
}

// ============================================================================
// MACD
// ============================================================================

/**
 * Calculate EMA for a series of values
 */
function calculateEMASeries(values: number[], period: number): number[] {
  if (values.length < period) return [];

  const multiplier = 2 / (period + 1);
  const emaValues: number[] = [];

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i] ?? 0;
  }
  let ema = sum / period;
  emaValues.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = ((values[i] ?? 0) - ema) * multiplier + ema;
    emaValues.push(ema);
  }

  return emaValues;
}

/**
 * Calculate single EMA value from a series
 */
function calculateEMAFromSeries(values: number[], period: number): number | null {
  const series = calculateEMASeries(values, period);
  if (series.length === 0) return null;
  return series[series.length - 1] ?? null;
}

export interface ScannerMACDResult {
  macd: number;
  signal: number;
  histogram: number;
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
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
): ScannerMACDResult | null {
  const minRequired = slowPeriod + signalPeriod - 1;
  if (candles.length < minRequired) {
    return null;
  }

  const closes = candles.map((c) => c.close);

  const fastEMASeries = calculateEMASeries(closes, fastPeriod);
  const slowEMASeries = calculateEMASeries(closes, slowPeriod);

  if (fastEMASeries.length === 0 || slowEMASeries.length === 0) {
    return null;
  }

  const offset = slowPeriod - fastPeriod;

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

  const signalLine = calculateEMAFromSeries(macdLine, signalPeriod);

  if (signalLine === null) {
    return null;
  }

  const latestMACD = macdLine[macdLine.length - 1];

  if (latestMACD === undefined) {
    return null;
  }

  const histogram = latestMACD - signalLine;

  return {
    macd: latestMACD,
    signal: signalLine,
    histogram,
  };
}

// ============================================================================
// Volume
// ============================================================================

/**
 * Calculate Simple Moving Average of volume
 */
export function calculateVolumeMA(candles: Candle[], period: number = 20): number | null {
  if (candles.length < period) {
    return null;
  }

  const recentCandles = candles.slice(-period);
  const sum = recentCandles.reduce((acc, candle) => acc + candle.volume, 0);

  return sum / period;
}

/**
 * Calculate Volume Ratio (current volume / MA)
 */
export function calculateVolumeRatio(candles: Candle[], period: number = 20): number | null {
  if (candles.length < period) {
    return null;
  }

  const volumeMA = calculateVolumeMA(candles, period);

  if (volumeMA === null || volumeMA === 0) {
    return null;
  }

  const lastCandle = candles[candles.length - 1];
  if (!lastCandle) {
    return null;
  }

  return lastCandle.volume / volumeMA;
}

/**
 * Calculate On-Balance Volume (OBV)
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
  }

  return obv;
}

/**
 * Calculate Volume Weighted Average Price (VWAP)
 */
export function calculateScannerVWAP(candles: Candle[]): number | null {
  if (candles.length === 0) {
    return null;
  }

  let cumulativeTPV = 0;
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

// ============================================================================
// Combined scanner entry points
// ============================================================================

/**
 * Calculate all technical indicators for a set of candles
 */
export function calculateIndicators(candles: Candle[]): Indicators {
  const rsi = calculateRSI(candles, 14);
  const macd = calculateMACD(candles, 12, 26, 9);
  const volumeMA = calculateVolumeMA(candles, 20);
  const volumeRatio = calculateVolumeRatio(candles, 20);

  return {
    rsi,
    macd,
    volumeMA,
    volumeRatio,
  };
}

/**
 * Full analysis including indicators and levels
 */
export interface FullAnalysis {
  indicators: Indicators;
  levels: Level[];
}

/**
 * Calculate all indicators and detect support/resistance levels
 */
export function analyzeCandles(
  candles: Candle[],
  levelSensitivity: number = 3
): FullAnalysis {
  return {
    indicators: calculateIndicators(candles),
    levels: detectLevels(candles, levelSensitivity),
  };
}