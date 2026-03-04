/**
 * Technical Indicator Calculations for Regime Detection
 *
 * Pure functions operating on OHLCV candle arrays.
 * All implementations are from-scratch (no external TA libraries).
 *
 * Default periods follow industry standard:
 *   ADX=14, ATR=14, BB=20/2, RSI=14, Volume MA=20, MACD=12/26/9
 */

import type { Candle } from "../../types/index.ts";

// ============================================================================
// Helpers
// ============================================================================

/** Extract close prices from candle array. */
function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close);
}

/** Simple Moving Average over the last `period` values. */
function sma(values: number[], period: number): number {
  if (values.length < period) return values.length > 0 ? values[values.length - 1]! : 0;
  let sum = 0;
  for (let i = values.length - period; i < values.length; i++) {
    sum += values[i]!;
  }
  return sum / period;
}

// ============================================================================
// EMA — Exponential Moving Average
// ============================================================================

/**
 * Calculate an EMA series from an array of values.
 * Returns an array of the same length (first value = first input).
 */
export function calculateEMA(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const result: number[] = [values[0]!];
  for (let i = 1; i < values.length; i++) {
    const prev = result[i - 1]!;
    result.push(values[i]! * k + prev * (1 - k));
  }
  return result;
}

// ============================================================================
// ATR — Average True Range
// ============================================================================

/**
 * Calculate ATR (Average True Range).
 * Uses Wilder smoothing (period-based exponential).
 * Requires at least `period + 1` candles; returns 0 if insufficient data.
 */
export function calculateATR(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0;

  // True range for each candle (skip the first since we need prev close)
  const trueRanges: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]!;
    const prevClose = candles[i - 1]!.close;
    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prevClose),
      Math.abs(curr.low - prevClose),
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) {
    // Not enough data — return simple average of what we have
    return trueRanges.reduce((a, b) => a + b, 0) / trueRanges.length;
  }

  // Initial ATR = SMA of first `period` true ranges
  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trueRanges[i]!;
  }
  atr /= period;

  // Wilder smoothing for subsequent values
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
  }

  return atr;
}

// ============================================================================
// ATR Percentile
// ============================================================================

/**
 * Where does the current ATR sit relative to its recent history?
 * Returns a value 0-100.
 */
export function calculateATRPercentile(candles: Candle[], lookback = 30): number {
  if (candles.length < 16) return 50; // default neutral

  const period = 14;
  // We need a rolling window to compute ATR at each point
  const atrValues: number[] = [];

  // Compute ATR at each position starting from index (period)
  const minLen = period + 1; // minimum candles to compute one ATR
  for (let end = minLen; end <= candles.length; end++) {
    const slice = candles.slice(Math.max(0, end - (period + 10)), end);
    atrValues.push(calculateATR(slice, period));
  }

  if (atrValues.length < 2) return 50;

  const currentATR = atrValues[atrValues.length - 1]!;
  const window = atrValues.slice(-lookback);
  const sorted = [...window].sort((a, b) => a - b);
  const rank = sorted.filter((v) => v < currentATR).length;
  return (rank / sorted.length) * 100;
}

// ============================================================================
// ADX — Average Directional Index
// ============================================================================

/**
 * Calculate ADX (Average Directional Index) — measures trend strength.
 * ADX > 25 ≈ trending, ADX < 20 ≈ ranging/choppy.
 * Returns 0 if insufficient data.
 */
export function calculateADX(candles: Candle[], period = 14): number {
  if (candles.length < period + 2) return 0;

  // Step 1: +DM, -DM, TR series
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const curr = candles[i]!;
    const prev = candles[i - 1]!;

    const upMove = curr.high - prev.high;
    const downMove = prev.low - curr.low;

    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);

    const tr = Math.max(
      curr.high - curr.low,
      Math.abs(curr.high - prev.close),
      Math.abs(curr.low - prev.close),
    );
    trueRanges.push(tr);
  }

  if (trueRanges.length < period) return 0;

  // Step 2: Wilder-smoothed +DM, -DM, TR
  const smooth = (arr: number[]): number[] => {
    const result: number[] = [];
    let val = 0;
    for (let i = 0; i < period; i++) {
      val += arr[i]!;
    }
    result.push(val);
    for (let i = period; i < arr.length; i++) {
      val = val - val / period + arr[i]!;
      result.push(val);
    }
    return result;
  };

  const smoothPlusDM = smooth(plusDM);
  const smoothMinusDM = smooth(minusDM);
  const smoothTR = smooth(trueRanges);

  // Step 3: +DI, -DI series
  const len = Math.min(smoothPlusDM.length, smoothMinusDM.length, smoothTR.length);
  const dxValues: number[] = [];
  for (let i = 0; i < len; i++) {
    const tr = smoothTR[i]!;
    if (tr === 0) {
      dxValues.push(0);
      continue;
    }
    const plusDI = (smoothPlusDM[i]! / tr) * 100;
    const minusDI = (smoothMinusDM[i]! / tr) * 100;
    const diSum = plusDI + minusDI;
    const dx = diSum === 0 ? 0 : (Math.abs(plusDI - minusDI) / diSum) * 100;
    dxValues.push(dx);
  }

  if (dxValues.length < period) {
    return dxValues.length > 0 ? dxValues[dxValues.length - 1]! : 0;
  }

  // Step 4: ADX = Wilder-smoothed DX
  let adx = 0;
  for (let i = 0; i < period; i++) {
    adx += dxValues[i]!;
  }
  adx /= period;

  for (let i = period; i < dxValues.length; i++) {
    adx = (adx * (period - 1) + dxValues[i]!) / period;
  }

  return adx;
}

// ============================================================================
// EMA Alignment
// ============================================================================

/**
 * Measure how well EMAs are stacked in order.
 *
 * Uses EMA 9, 21, 50, 100.
 * Returns:
 *   score: 0-1 (1 = perfect alignment)
 *   direction: +1 bullish, -1 bearish, 0 neutral
 */
export function calculateEMAAlignment(candles: Candle[]): {
  score: number;
  direction: number;
} {
  if (candles.length < 100) {
    // Need enough data for EMA-100
    const shortLen = Math.min(candles.length, 9);
    if (shortLen < 2) return { score: 0, direction: 0 };
    const c = closes(candles);
    const e9 = calculateEMA(c, Math.min(9, c.length));
    const e21 = calculateEMA(c, Math.min(21, c.length));
    const last9 = e9[e9.length - 1]!;
    const last21 = e21[e21.length - 1]!;
    const dir = last9 > last21 ? 1 : last9 < last21 ? -1 : 0;
    return { score: dir !== 0 ? 0.3 : 0, direction: dir };
  }

  const c = closes(candles);
  const e9 = calculateEMA(c, 9);
  const e21 = calculateEMA(c, 21);
  const e50 = calculateEMA(c, 50);
  const e100 = calculateEMA(c, 100);

  const last9 = e9[e9.length - 1]!;
  const last21 = e21[e21.length - 1]!;
  const last50 = e50[e50.length - 1]!;
  const last100 = e100[e100.length - 1]!;

  // Check bullish alignment: 9 > 21 > 50 > 100
  let bullishPairs = 0;
  if (last9 > last21) bullishPairs++;
  if (last21 > last50) bullishPairs++;
  if (last50 > last100) bullishPairs++;

  // Check bearish alignment: 9 < 21 < 50 < 100
  let bearishPairs = 0;
  if (last9 < last21) bearishPairs++;
  if (last21 < last50) bearishPairs++;
  if (last50 < last100) bearishPairs++;

  const maxPairs = 3;
  const bullishScore = bullishPairs / maxPairs;
  const bearishScore = bearishPairs / maxPairs;

  if (bullishScore >= bearishScore) {
    return { score: bullishScore, direction: bullishScore > 0 ? 1 : 0 };
  }
  return { score: bearishScore, direction: bearishScore > 0 ? -1 : 0 };
}

// ============================================================================
// Bollinger Band Width
// ============================================================================

/**
 * Bollinger Band width as a percentage of the middle band (SMA).
 * BB Width = (Upper - Lower) / Middle * 100
 */
export function calculateBBWidth(
  candles: Candle[],
  period = 20,
  stddev = 2,
): number {
  const c = closes(candles);
  if (c.length < period) return 0;

  const slice = c.slice(-period);
  const middle = slice.reduce((a, b) => a + b, 0) / period;

  if (middle === 0) return 0;

  const variance =
    slice.reduce((sum, v) => sum + (v - middle) ** 2, 0) / period;
  const sd = Math.sqrt(variance);

  const upper = middle + stddev * sd;
  const lower = middle - stddev * sd;

  return ((upper - lower) / middle) * 100;
}

// ============================================================================
// RSI — Relative Strength Index
// ============================================================================

/**
 * Calculate RSI using Wilder smoothing.
 * Returns the most recent RSI value (0-100).
 */
export function calculateRSI(candles: Candle[], period = 14): number {
  const c = closes(candles);
  if (c.length < period + 1) return 50; // neutral default

  // Calculate price changes
  const changes: number[] = [];
  for (let i = 1; i < c.length; i++) {
    changes.push(c[i]! - c[i - 1]!);
  }

  // Separate gains and losses
  const gains = changes.map((ch) => (ch > 0 ? ch : 0));
  const losses = changes.map((ch) => (ch < 0 ? -ch : 0));

  // Initial averages
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 0; i < period; i++) {
    avgGain += gains[i]!;
    avgLoss += losses[i]!;
  }
  avgGain /= period;
  avgLoss /= period;

  // Wilder smoothing
  for (let i = period; i < changes.length; i++) {
    avgGain = (avgGain * (period - 1) + gains[i]!) / period;
    avgLoss = (avgLoss * (period - 1) + losses[i]!) / period;
  }

  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

// ============================================================================
// Volume Ratio
// ============================================================================

/**
 * Current volume vs moving average volume.
 * Returns ratio (e.g. 1.5 = 50% above average).
 */
export function calculateVolumeRatio(candles: Candle[], period = 20): number {
  if (candles.length < 2) return 1;

  const volumes = candles.map((c) => c.volume);
  const currentVolume = volumes[volumes.length - 1]!;
  const avgVolume = sma(volumes.slice(0, -1), Math.min(period, volumes.length - 1));

  if (avgVolume === 0) return 1;
  return currentVolume / avgVolume;
}

// ============================================================================
// MACD
// ============================================================================

/**
 * Calculate MACD (12/26/9).
 * Returns histogram, signal, and macd line values (most recent).
 */
export function calculateMACD(candles: Candle[]): {
  histogram: number;
  signal: number;
  macd: number;
} {
  const c = closes(candles);
  if (c.length < 26) {
    return { histogram: 0, signal: 0, macd: 0 };
  }

  const ema12 = calculateEMA(c, 12);
  const ema26 = calculateEMA(c, 26);

  // MACD line = EMA12 - EMA26
  const macdLine: number[] = [];
  for (let i = 0; i < c.length; i++) {
    macdLine.push(ema12[i]! - ema26[i]!);
  }

  // Signal line = EMA9 of MACD line
  const signalLine = calculateEMA(macdLine, 9);

  const macdValue = macdLine[macdLine.length - 1]!;
  const signalValue = signalLine[signalLine.length - 1]!;

  return {
    macd: macdValue,
    signal: signalValue,
    histogram: macdValue - signalValue,
  };
}

// ============================================================================
// Volume Trend
// ============================================================================

/**
 * Determine if volume is increasing, decreasing, or stable.
 * Compares the recent 5-period volume average to the prior 5-period average.
 */
export function calculateVolumeTrend(
  candles: Candle[],
): "increasing" | "decreasing" | "stable" {
  if (candles.length < 10) return "stable";

  const volumes = candles.map((c) => c.volume);
  const recent = volumes.slice(-5);
  const prior = volumes.slice(-10, -5);

  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const priorAvg = prior.reduce((a, b) => a + b, 0) / prior.length;

  if (priorAvg === 0) return "stable";
  const ratio = recentAvg / priorAvg;

  if (ratio > 1.2) return "increasing";
  if (ratio < 0.8) return "decreasing";
  return "stable";
}
