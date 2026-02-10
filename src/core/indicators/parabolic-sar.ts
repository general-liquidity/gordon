/**
 * Parabolic SAR (Stop and Reverse)
 * Classic trend-following indicator that trails price with acceleration.
 * SAR below price = uptrend, above price = downtrend.
 * Direction flip = trend reversal signal.
 *
 * Based on Welles Wilder's Parabolic SAR formulation.
 */

import type { Candle } from "./types.ts";

export interface ParabolicSARResult {
  /** SAR series */
  values: number[];
  /** Direction series: 1 = uptrend, -1 = downtrend */
  direction: number[];
  /** Current SAR value */
  current: number | null;
  /** Current direction */
  currentDirection: 1 | -1;
  /** Whether direction just flipped */
  trendChange: boolean;
  /** Signal */
  signal: "buy" | "sell" | "hold";
  /** Distance from current price to SAR as percentage */
  distance: number | null;
  /** Current acceleration factor */
  af: number;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate Parabolic SAR.
 *
 * @param candles - OHLCV candle array
 * @param afStart - Initial acceleration factor (default 0.02)
 * @param afIncrement - AF increment per new extreme (default 0.02)
 * @param afMax - Maximum acceleration factor (default 0.2)
 * @returns ParabolicSARResult
 */
export function calculateParabolicSAR(
  candles: Candle[],
  afStart: number = 0.02,
  afIncrement: number = 0.02,
  afMax: number = 0.2
): ParabolicSARResult {
  if (candles.length < 5) {
    return {
      values: [],
      direction: [],
      current: null,
      currentDirection: 1,
      trendChange: false,
      signal: "hold",
      distance: null,
      af: afStart,
      interpretation: "Insufficient data for Parabolic SAR",
    };
  }

  const sarValues: number[] = [];
  const dirValues: number[] = [];

  // Initialize: determine initial trend from first 2 bars
  let isUptrend = candles[1]!.close > candles[0]!.close;
  let sar = isUptrend ? candles[0]!.low : candles[0]!.high;
  let ep = isUptrend ? candles[0]!.high : candles[0]!.low; // Extreme Point
  let af = afStart;

  sarValues.push(sar);
  dirValues.push(isUptrend ? 1 : -1);

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i]!.high;
    const low = candles[i]!.low;
    const prevHigh = candles[i - 1]!.high;
    const prevLow = candles[i - 1]!.low;

    // Calculate new SAR
    let newSar = sar + af * (ep - sar);

    if (isUptrend) {
      // SAR must not be above prior two lows
      newSar = Math.min(newSar, prevLow);
      if (i >= 2) newSar = Math.min(newSar, candles[i - 2]!.low);

      if (low <= newSar) {
        // Reversal: switch to downtrend
        isUptrend = false;
        newSar = ep; // SAR becomes the extreme point
        ep = low;
        af = afStart;
      } else {
        // Continue uptrend
        if (high > ep) {
          ep = high;
          af = Math.min(af + afIncrement, afMax);
        }
      }
    } else {
      // SAR must not be below prior two highs
      newSar = Math.max(newSar, prevHigh);
      if (i >= 2) newSar = Math.max(newSar, candles[i - 2]!.high);

      if (high >= newSar) {
        // Reversal: switch to uptrend
        isUptrend = true;
        newSar = ep; // SAR becomes the extreme point
        ep = high;
        af = afStart;
      } else {
        // Continue downtrend
        if (low < ep) {
          ep = low;
          af = Math.min(af + afIncrement, afMax);
        }
      }
    }

    sar = newSar;
    sarValues.push(parseFloat(sar.toFixed(4)));
    dirValues.push(isUptrend ? 1 : -1);
  }

  const currentSar = sarValues[sarValues.length - 1]!;
  const currentDir = dirValues[dirValues.length - 1]! as 1 | -1;
  const prevDir = dirValues.length >= 2 ? dirValues[dirValues.length - 2]! : currentDir;
  const trendChange = currentDir !== prevDir;

  const currentPrice = candles[candles.length - 1]!.close;
  const distance = parseFloat(((Math.abs(currentPrice - currentSar) / currentPrice) * 100).toFixed(2));

  let signal: "buy" | "sell" | "hold" = "hold";
  if (trendChange && currentDir === 1) signal = "buy";
  else if (trendChange && currentDir === -1) signal = "sell";

  const interpretation = buildSARInterpretation(currentSar, currentDir, trendChange, distance, af, currentPrice);

  return {
    values: sarValues,
    direction: dirValues,
    current: parseFloat(currentSar.toFixed(4)),
    currentDirection: currentDir,
    trendChange,
    signal,
    distance,
    af: parseFloat(af.toFixed(3)),
    interpretation,
  };
}

function buildSARInterpretation(
  sar: number, dir: number, change: boolean, dist: number, af: number, price: number
): string {
  let msg = `Parabolic SAR: ${sar.toFixed(2)} (${dir === 1 ? "UPTREND" : "DOWNTREND"}). `;
  msg += `Distance: ${dist}% ${dir === 1 ? "below" : "above"} price. AF: ${af}. `;

  if (change) {
    msg += dir === 1
      ? "TREND REVERSAL to BULLISH — SAR flipped below price. Buy signal."
      : "TREND REVERSAL to BEARISH — SAR flipped above price. Sell signal.";
  } else {
    msg += dir === 1
      ? "Uptrend intact — SAR acts as trailing stop below."
      : "Downtrend intact — SAR acts as trailing stop above.";
  }

  return msg;
}
