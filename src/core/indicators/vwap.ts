/**
 * Volume Weighted Average Price (VWAP)
 * Essential for intraday trading - shows fair value based on volume
 */

import type { Candle } from "./types.ts";

export interface VWAPResult {
  values: (number | null)[];
  current: number | null;
  pricePosition: "above" | "below" | "at";
  deviation: number | null;  // How far price is from VWAP as percentage
  interpretation: string;
}

/**
 * Calculate VWAP (Volume Weighted Average Price)
 *
 * VWAP = Cumulative(Typical Price * Volume) / Cumulative(Volume)
 * where Typical Price = (High + Low + Close) / 3
 *
 * Signals:
 * - Price > VWAP: Bullish bias, buyers in control
 * - Price < VWAP: Bearish bias, sellers in control
 * - Price at VWAP: Fair value, potential support/resistance
 *
 * @param candles - Array of OHLCV candles
 * @param currentPrice - Current price for position calculation
 * @returns VWAP result with values and interpretation
 */
export function calculateVWAP(
  candles: Candle[],
  currentPrice?: number
): VWAPResult {
  if (candles.length < 1) {
    return {
      values: [],
      current: null,
      pricePosition: "at",
      deviation: null,
      interpretation: "Insufficient data for VWAP calculation",
    };
  }

  const vwapValues: (number | null)[] = [];
  let cumulativeTPV = 0;  // Cumulative Typical Price * Volume
  let cumulativeVolume = 0;

  for (const candle of candles) {
    // Typical Price = (High + Low + Close) / 3
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;

    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    if (cumulativeVolume > 0) {
      vwapValues.push(cumulativeTPV / cumulativeVolume);
    } else {
      vwapValues.push(null);
    }
  }

  const currentVWAP = vwapValues[vwapValues.length - 1] ?? null;
  const lastCandle = candles[candles.length - 1];
  const price = currentPrice ?? (lastCandle?.close ?? 0);

  // Determine price position relative to VWAP
  let pricePosition: "above" | "below" | "at" = "at";
  let deviation: number | null = null;

  if (currentVWAP !== null) {
    deviation = ((price - currentVWAP) / currentVWAP) * 100;

    if (Math.abs(deviation) < 0.1) {
      pricePosition = "at";
    } else if (price > currentVWAP) {
      pricePosition = "above";
    } else {
      pricePosition = "below";
    }
  }

  // Generate interpretation
  let interpretation = "";
  if (currentVWAP === null) {
    interpretation = "Insufficient data for VWAP";
  } else if (pricePosition === "above") {
    if (deviation! > 2) {
      interpretation = `Price ${deviation!.toFixed(2)}% above VWAP - extended, potential pullback to VWAP`;
    } else {
      interpretation = `Price ${deviation!.toFixed(2)}% above VWAP - bullish bias, buyers in control`;
    }
  } else if (pricePosition === "below") {
    if (deviation! < -2) {
      interpretation = `Price ${Math.abs(deviation!).toFixed(2)}% below VWAP - oversold, potential bounce to VWAP`;
    } else {
      interpretation = `Price ${Math.abs(deviation!).toFixed(2)}% below VWAP - bearish bias, sellers in control`;
    }
  } else {
    interpretation = "Price at VWAP - fair value, watch for direction";
  }

  return {
    values: vwapValues,
    current: currentVWAP,
    pricePosition,
    deviation,
    interpretation,
  };
}

/**
 * Calculate VWAP with standard deviation bands
 * Similar to Bollinger Bands but anchored to VWAP
 */
export function calculateVWAPBands(
  candles: Candle[],
  stdDevMultiplier: number = 2,
  currentPrice?: number
): {
  vwap: VWAPResult;
  upperBand: number | null;
  lowerBand: number | null;
  bandwidth: number | null;
} {
  const vwap = calculateVWAP(candles, currentPrice);

  if (vwap.current === null || candles.length < 2) {
    return {
      vwap,
      upperBand: null,
      lowerBand: null,
      bandwidth: null,
    };
  }

  // Calculate standard deviation of typical prices from VWAP
  let sumSquaredDev = 0;
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (const candle of candles) {
    const typicalPrice = (candle.high + candle.low + candle.close) / 3;
    cumulativeTPV += typicalPrice * candle.volume;
    cumulativeVolume += candle.volume;

    if (cumulativeVolume > 0) {
      const vwapAtPoint = cumulativeTPV / cumulativeVolume;
      sumSquaredDev += Math.pow(typicalPrice - vwapAtPoint, 2);
    }
  }

  const variance = sumSquaredDev / candles.length;
  const stdDev = Math.sqrt(variance);

  const upperBand = vwap.current + (stdDev * stdDevMultiplier);
  const lowerBand = vwap.current - (stdDev * stdDevMultiplier);
  const bandwidth = ((upperBand - lowerBand) / vwap.current) * 100;

  return {
    vwap,
    upperBand,
    lowerBand,
    bandwidth,
  };
}
