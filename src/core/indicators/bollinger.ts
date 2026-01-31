/**
 * Bollinger Bands Indicator
 * Volatility bands for support/resistance and mean reversion
 */

import { calculateSMA } from "./ema.ts";
import type { BollingerResult } from "./types.ts";

/**
 * Calculate standard deviation
 */
function calculateStdDev(data: number[], mean: number): number {
  const squaredDiffs = data.map(value => Math.pow(value - mean, 2));
  const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / data.length;
  return Math.sqrt(avgSquaredDiff);
}

/**
 * Calculate Bollinger Bands
 *
 * Bollinger Bands create dynamic support/resistance using:
 * - Middle band: SMA of price
 * - Upper band: SMA + (stdDev * multiplier)
 * - Lower band: SMA - (stdDev * multiplier)
 *
 * Signals:
 * - Price at lower band: Potential oversold / buy
 * - Price at upper band: Potential overbought / sell
 * - Band squeeze: Low volatility, breakout imminent
 *
 * @param closes - Array of closing prices
 * @param period - SMA period (default 20)
 * @param stdDevMultiplier - Standard deviation multiplier (default 2)
 * @param currentPrice - Current price for position calculation
 * @returns Bollinger Bands result
 */
export function calculateBollingerBands(
  closes: number[],
  period: number = 20,
  stdDevMultiplier: number = 2,
  currentPrice?: number
): BollingerResult {
  if (closes.length < period) {
    const nullArray = closes.map(() => null);
    return {
      upper: nullArray,
      middle: nullArray,
      lower: nullArray,
      bandwidth: nullArray,
      current: {
        upper: null,
        middle: null,
        lower: null,
        bandwidth: null,
      },
      position: "middle",
      squeeze: false,
      interpretation: "Insufficient data for Bollinger Bands",
    };
  }

  const middle = calculateSMA(closes, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  const bandwidth: (number | null)[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(null);
      lower.push(null);
      bandwidth.push(null);
    } else {
      const window = closes.slice(i - period + 1, i + 1);
      const sma = middle[i]!;
      const stdDev = calculateStdDev(window, sma);

      const upperBand = sma + (stdDev * stdDevMultiplier);
      const lowerBand = sma - (stdDev * stdDevMultiplier);

      upper.push(upperBand);
      lower.push(lowerBand);

      // Bandwidth as percentage of middle band
      const bw = ((upperBand - lowerBand) / sma) * 100;
      bandwidth.push(bw);
    }
  }

  // Get current values
  const currentUpper = upper[upper.length - 1] ?? null;
  const currentMiddle = middle[middle.length - 1] ?? null;
  const currentLower = lower[lower.length - 1] ?? null;
  const currentBandwidth = bandwidth[bandwidth.length - 1] ?? null;
  const lastClose = closes[closes.length - 1];
  const price = currentPrice ?? (lastClose ?? 0);

  // Determine position within bands
  let position: "above_upper" | "upper" | "middle" | "lower" | "below_lower" = "middle";
  if (currentUpper !== null && currentLower !== null && currentMiddle !== null) {
    if (price > currentUpper) {
      position = "above_upper";
    } else if (price > currentMiddle + (currentUpper - currentMiddle) * 0.5) {
      position = "upper";
    } else if (price < currentLower) {
      position = "below_lower";
    } else if (price < currentMiddle - (currentMiddle - currentLower) * 0.5) {
      position = "lower";
    }
  }

  // Detect squeeze (bandwidth below 20-period average bandwidth)
  const recentBandwidths = bandwidth.slice(-20).filter((b): b is number => b !== null);
  const avgBandwidth = recentBandwidths.length > 0
    ? recentBandwidths.reduce((a, b) => a + b, 0) / recentBandwidths.length
    : 0;
  const squeeze = currentBandwidth !== null && currentBandwidth < avgBandwidth * 0.75;

  // Generate interpretation
  let interpretation = "";
  if (position === "above_upper") {
    interpretation = "Price above upper band - overbought, potential pullback";
  } else if (position === "upper") {
    interpretation = "Price in upper zone - bullish momentum but extended";
  } else if (position === "below_lower") {
    interpretation = "Price below lower band - oversold, potential bounce";
  } else if (position === "lower") {
    interpretation = "Price in lower zone - bearish but approaching support";
  } else {
    interpretation = "Price near middle band - neutral, watch for direction";
  }

  if (squeeze) {
    interpretation += ". SQUEEZE DETECTED - low volatility, breakout likely";
  }

  return {
    upper,
    middle,
    lower,
    bandwidth,
    current: {
      upper: currentUpper,
      middle: currentMiddle,
      lower: currentLower,
      bandwidth: currentBandwidth,
    },
    position,
    squeeze,
    interpretation,
  };
}
