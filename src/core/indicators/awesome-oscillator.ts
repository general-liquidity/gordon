/**
 * Awesome Oscillator (AO)
 * Momentum acceleration: 5-period SMA minus 34-period SMA of midpoints.
 * AO > 0 = bullish momentum, AO < 0 = bearish.
 * Zero-line crossovers = momentum shifts.
 *
 * Awesome Oscillator (Bill Williams) implementation.
 */

import type { Candle } from "./types.ts";

export interface AOResult {
  /** Current AO value */
  current: number | null;
  /** AO series */
  values: (number | null)[];
  /** AO color: lime (positive + increasing), green (positive + decreasing),
   *  red (negative + decreasing), maroon (negative + increasing) */
  color: "lime" | "green" | "red" | "maroon";
  /** Zero-line crossover */
  crossover: "bullish_cross" | "bearish_cross" | "none";
  /** Momentum direction */
  momentum:
    | "accelerating_up"
    | "decelerating_up"
    | "accelerating_down"
    | "decelerating_down"
    | "flat";
  /** Signal */
  signal: "buy" | "sell" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

function sma(values: number[], period: number): (number | null)[] {
  const result: (number | null)[] = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      let sum = 0;
      for (let j = i - period + 1; j <= i; j++) sum += values[j]!;
      result.push(sum / period);
    }
  }
  return result;
}

/**
 * Calculate Awesome Oscillator.
 *
 * @param candles - OHLCV candle array
 * @param fastPeriod - Fast SMA period (default 5)
 * @param slowPeriod - Slow SMA period (default 34)
 * @returns AOResult
 */
export function calculateAO(
  candles: Candle[],
  fastPeriod: number = 5,
  slowPeriod: number = 34,
): AOResult {
  if (candles.length < slowPeriod + 5) {
    return {
      current: null,
      values: [],
      color: "green",
      crossover: "none",
      momentum: "flat",
      signal: "neutral",
      interpretation: "Insufficient data for Awesome Oscillator",
    };
  }

  // Median price = (High + Low) / 2
  const medianPrices = candles.map((c) => (c.high + c.low) / 2);

  // AO = SMA(median, fast) - SMA(median, slow)
  const fastSma = sma(medianPrices, fastPeriod);
  const slowSma = sma(medianPrices, slowPeriod);

  const aoValues: (number | null)[] = [];
  for (let i = 0; i < candles.length; i++) {
    const fast = fastSma[i];
    const slow = slowSma[i];
    if (fast == null || slow == null) {
      aoValues.push(null);
    } else {
      aoValues.push(parseFloat((fast - slow).toFixed(4)));
    }
  }

  const current = aoValues[aoValues.length - 1] ?? null;
  const prev = (aoValues.length >= 2 ? aoValues[aoValues.length - 2] : null) ?? null;
  const _prev2 = (aoValues.length >= 3 ? aoValues[aoValues.length - 3] : null) ?? null;

  // Color
  let color: "lime" | "green" | "red" | "maroon" = "green";
  if (current !== null && prev !== null) {
    if (current > 0) {
      color = current > prev ? "lime" : "green";
    } else {
      color = current < prev ? "maroon" : "red";
    }
  }

  // Crossover
  let crossover: "bullish_cross" | "bearish_cross" | "none" = "none";
  if (current !== null && prev !== null) {
    if (prev <= 0 && current > 0) crossover = "bullish_cross";
    else if (prev >= 0 && current < 0) crossover = "bearish_cross";
  }

  // Momentum
  let momentum:
    | "accelerating_up"
    | "decelerating_up"
    | "accelerating_down"
    | "decelerating_down"
    | "flat" = "flat";
  if (current !== null && prev !== null) {
    if (current > 0 && current > prev) momentum = "accelerating_up";
    else if (current > 0 && current <= prev) momentum = "decelerating_up";
    else if (current < 0 && current < prev) momentum = "accelerating_down";
    else if (current < 0 && current >= prev) momentum = "decelerating_down";
  }

  // Signal
  let signal: "buy" | "sell" | "neutral" = "neutral";
  if (crossover === "bullish_cross") signal = "buy";
  else if (crossover === "bearish_cross") signal = "sell";

  const interpretation = buildAOInterpretation(current, color, crossover, momentum, signal);

  return {
    current,
    values: aoValues,
    color,
    crossover,
    momentum,
    signal,
    interpretation,
  };
}

function buildAOInterpretation(
  ao: number | null,
  color: string,
  crossover: string,
  momentum: string,
  _signal: string,
): string {
  if (ao === null) return "Insufficient data for AO.";

  let msg = `AO: ${ao > 0 ? "+" : ""}${ao.toFixed(4)} (${color}). `;

  if (crossover === "bullish_cross") {
    msg += "ZERO-LINE BULLISH CROSSOVER — momentum shifted to buyers. ";
  } else if (crossover === "bearish_cross") {
    msg += "ZERO-LINE BEARISH CROSSOVER — momentum shifted to sellers. ";
  }

  msg += `Momentum: ${momentum.replace(/_/g, " ")}. `;

  if (color === "lime") msg += "Strong bullish acceleration.";
  else if (color === "green") msg += "Bullish but losing steam.";
  else if (color === "red") msg += "Bearish but losing steam.";
  else msg += "Strong bearish acceleration.";

  return msg;
}
