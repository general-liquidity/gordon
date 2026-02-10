/**
 * Nadaraya-Watson Envelope Indicator
 * Non-parametric Gaussian kernel regression for smooth trend estimation
 * with ATR-based envelope bands for overbought/oversold detection.
 *
 * Nadaraya-Watson Envelope implementation.
 */

import type { Candle } from "./types.ts";

export interface NadarayaWatsonResult {
  /** Smoothed NW regression line values */
  values: number[];
  /** Upper envelope band values */
  upperBand: number[];
  /** Lower envelope band values */
  lowerBand: number[];
  /** Current NW line value */
  current: number | null;
  /** Current upper band */
  currentUpper: number | null;
  /** Current lower band */
  currentLower: number | null;
  /** Price position relative to bands */
  position: "above_upper" | "upper_zone" | "middle" | "lower_zone" | "below_lower";
  /** Trend direction from NW line slope */
  trend: "bullish" | "bearish" | "neutral";
  /** Bandwidth (envelope width as % of price) */
  envelopeWidth: number | null;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Gaussian kernel function
 * K(u) = exp(-u² / 2)
 */
function gaussianKernel(distance: number, bandwidth: number): number {
  const sigma = bandwidth / 4; // standard deviation
  return Math.exp(-(distance * distance) / (2 * sigma * sigma));
}

/**
 * Calculate ATR (Average True Range) for envelope bands
 */
function calculateATR(candles: Candle[], period: number): number[] {
  const atr: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      atr.push(candles[i]!.high - candles[i]!.low);
      continue;
    }

    const high = candles[i]!.high;
    const low = candles[i]!.low;
    const prevClose = candles[i - 1]!.close;

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));

    if (i < period) {
      // Simple average for initial values
      const slice = [tr];
      for (let j = Math.max(0, i - period + 1); j < i; j++) {
        const h = candles[j]!.high;
        const l = candles[j]!.low;
        const pc = j > 0 ? candles[j - 1]!.close : candles[j]!.close;
        slice.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
      }
      atr.push(slice.reduce((a, b) => a + b, 0) / slice.length);
    } else {
      // Smoothed ATR: prev_atr * (period-1)/period + tr/period
      atr.push((atr[i - 1]! * (period - 1) + tr) / period);
    }
  }

  return atr;
}

/**
 * Calculate Nadaraya-Watson kernel regression with envelope bands.
 *
 * @param candles - OHLCV candle array
 * @param bandwidth - Kernel bandwidth / lookback window (default 100)
 * @param bandMultiplier - ATR multiplier for envelope bands (default 2.0)
 * @param atrPeriod - ATR period for band width (default 14)
 * @returns NadarayaWatsonResult
 */
export function calculateNadarayaWatson(
  candles: Candle[],
  bandwidth: number = 100,
  bandMultiplier: number = 2.0,
  atrPeriod: number = 14
): NadarayaWatsonResult {
  if (candles.length < 10) {
    return {
      values: [],
      upperBand: [],
      lowerBand: [],
      current: null,
      currentUpper: null,
      currentLower: null,
      position: "middle",
      trend: "neutral",
      envelopeWidth: null,
      interpretation: "Insufficient data for Nadaraya-Watson calculation",
    };
  }

  const prices = candles.map((c) => c.close);
  const atrValues = calculateATR(candles, atrPeriod);
  const nwValues: number[] = [];

  // Calculate NW regression for each point
  for (let i = 0; i < prices.length; i++) {
    if (i < Math.min(bandwidth, 10)) {
      // Not enough lookback — use raw price
      nwValues.push(prices[i]!);
    } else {
      let weightSum = 0;
      let valueSum = 0;
      const lookbackStart = Math.max(0, i - bandwidth);

      for (let j = lookbackStart; j <= i; j++) {
        const distance = Math.abs(i - j);
        const weight = gaussianKernel(distance, bandwidth);
        weightSum += weight;
        valueSum += weight * prices[j]!;
      }

      nwValues.push(weightSum > 0 ? valueSum / weightSum : prices[i]!);
    }
  }

  // Build envelope bands: NW ± ATR * multiplier
  const upperBand: number[] = [];
  const lowerBand: number[] = [];
  for (let i = 0; i < nwValues.length; i++) {
    const atr = atrValues[i]!;
    upperBand.push(nwValues[i]! + atr * bandMultiplier);
    lowerBand.push(nwValues[i]! - atr * bandMultiplier);
  }

  const current = nwValues[nwValues.length - 1]!;
  const currentUpper = upperBand[upperBand.length - 1]!;
  const currentLower = lowerBand[lowerBand.length - 1]!;
  const lastClose = prices[prices.length - 1]!;

  // Price position
  const position = getPosition(lastClose, currentUpper, currentLower, current);

  // Trend from NW slope
  const prev = nwValues.length >= 2 ? nwValues[nwValues.length - 2]! : current;
  const slopeThreshold = current * 0.0001;
  const slope = current - prev;
  const trend: "bullish" | "bearish" | "neutral" =
    slope > slopeThreshold ? "bullish" : slope < -slopeThreshold ? "bearish" : "neutral";

  // Envelope width as % of price
  const envelopeWidth = ((currentUpper - currentLower) / current) * 100;

  const interpretation = buildNWInterpretation(
    lastClose,
    current,
    currentUpper,
    currentLower,
    position,
    trend,
    envelopeWidth
  );

  return {
    values: nwValues,
    upperBand,
    lowerBand,
    current,
    currentUpper,
    currentLower,
    position,
    trend,
    envelopeWidth: parseFloat(envelopeWidth.toFixed(2)),
    interpretation,
  };
}

function getPosition(
  price: number,
  upper: number,
  lower: number,
  middle: number
): "above_upper" | "upper_zone" | "middle" | "lower_zone" | "below_lower" {
  if (price > upper) return "above_upper";
  if (price > middle) return "upper_zone";
  if (price < lower) return "below_lower";
  if (price < middle) return "lower_zone";
  return "middle";
}

function buildNWInterpretation(
  price: number,
  nw: number,
  upper: number,
  lower: number,
  position: string,
  trend: string,
  width: number
): string {
  const trendStr = trend === "bullish" ? "upward" : trend === "bearish" ? "downward" : "flat";

  let msg =
    `NW regression at ${nw.toFixed(2)} (trend ${trendStr}). ` +
    `Envelope: ${lower.toFixed(2)} — ${upper.toFixed(2)} (${width.toFixed(1)}% wide). `;

  switch (position) {
    case "above_upper":
      msg += `Price above upper band — overbought, potential short/sell signal. Watch for rejection back inside.`;
      break;
    case "upper_zone":
      msg += `Price in upper zone — bullish momentum but approaching resistance at ${upper.toFixed(2)}.`;
      break;
    case "below_lower":
      msg += `Price below lower band — oversold, potential long/buy signal. Watch for rejection back inside.`;
      break;
    case "lower_zone":
      msg += `Price in lower zone — bearish pressure but approaching support at ${lower.toFixed(2)}.`;
      break;
    default:
      msg += `Price near the NW line — neutral, wait for directional move toward bands.`;
  }

  return msg;
}
