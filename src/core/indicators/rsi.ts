/**
 * Relative Strength Index (RSI) Indicator
 * Momentum oscillator measuring overbought/oversold conditions
 */

import type { RSIResult } from "./types.ts";

/**
 * Calculate RSI (Relative Strength Index)
 *
 * RSI measures speed and magnitude of price changes on a 0-100 scale.
 * - Above 70: Overbought (potential sell)
 * - Below 30: Oversold (potential buy)
 *
 * @param closes - Array of closing prices
 * @param period - RSI lookback period (default 14)
 * @returns RSI result with values, signals, and interpretation
 */
export function calculateRSI(closes: number[], period: number = 14): RSIResult {
  if (closes.length < period + 1) {
    return {
      values: closes.map(() => null),
      current: null,
      signal: "neutral",
      action: "hold",
      period,
    };
  }

  const result: (number | null)[] = [];

  // Calculate price changes
  const deltas: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    deltas.push(closes[i]! - closes[i - 1]!);
  }

  // Initialize first average gain/loss
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 0; i < period; i++) {
    const delta = deltas[i]!;
    if (delta > 0) {
      avgGain += delta;
    } else {
      avgLoss += Math.abs(delta);
    }
  }

  avgGain /= period;
  avgLoss /= period;

  // Fill initial nulls
  for (let i = 0; i < period; i++) {
    result.push(null);
  }

  // Calculate first RSI
  let rsi: number;
  if (avgLoss === 0) {
    rsi = 100;
  } else {
    const rs = avgGain / avgLoss;
    rsi = 100 - (100 / (1 + rs));
  }
  result.push(rsi);

  // Calculate remaining RSI values using Wilder's smoothing
  for (let i = period; i < deltas.length; i++) {
    const delta = deltas[i]!;
    const gain = delta > 0 ? delta : 0;
    const loss = delta < 0 ? Math.abs(delta) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      rsi = 100;
    } else {
      const rs = avgGain / avgLoss;
      rsi = 100 - (100 / (1 + rs));
    }
    result.push(rsi);
  }

  const current = result[result.length - 1];

  // Determine signal and action
  let signal: "oversold" | "neutral" | "overbought" = "neutral";
  let action: "potential_buy" | "hold" | "potential_sell" = "hold";

  if (current !== null) {
    if (current < 30) {
      signal = "oversold";
      action = "potential_buy";
    } else if (current > 70) {
      signal = "overbought";
      action = "potential_sell";
    } else if (current < 40) {
      signal = "neutral"; // But leaning oversold
      action = "hold";
    } else if (current > 60) {
      signal = "neutral"; // But leaning overbought
      action = "hold";
    }
  }

  return {
    values: result,
    current,
    signal,
    action,
    period,
  };
}

/**
 * Get RSI interpretation string
 */
export function interpretRSI(rsi: number | null): string {
  if (rsi === null) return "Insufficient data for RSI";

  if (rsi < 20) return `RSI at ${rsi.toFixed(1)} - Extremely oversold, potential reversal`;
  if (rsi < 30) return `RSI at ${rsi.toFixed(1)} - Oversold, watch for bounce`;
  if (rsi < 40) return `RSI at ${rsi.toFixed(1)} - Approaching oversold territory`;
  if (rsi < 50) return `RSI at ${rsi.toFixed(1)} - Below midline, slight bearish bias`;
  if (rsi < 60) return `RSI at ${rsi.toFixed(1)} - Above midline, slight bullish bias`;
  if (rsi < 70) return `RSI at ${rsi.toFixed(1)} - Approaching overbought territory`;
  if (rsi < 80) return `RSI at ${rsi.toFixed(1)} - Overbought, watch for pullback`;
  return `RSI at ${rsi.toFixed(1)} - Extremely overbought, high reversal risk`;
}
