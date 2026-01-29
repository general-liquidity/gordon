/**
 * Exponential Moving Average (EMA) Indicator
 * Also includes SMA for completeness
 */

import type { EMAResult, MultiEMAResult } from "./types.ts";

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(data: number[], period: number): (number | null)[] {
  if (data.length < period) {
    return data.map(() => null);
  }

  const result: (number | null)[] = [];

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(null);
    } else {
      const window = data.slice(i - period + 1, i + 1);
      const sum = window.reduce((a, b) => a + b, 0);
      result.push(sum / period);
    }
  }

  return result;
}

/**
 * Calculate Exponential Moving Average
 */
export function calculateEMA(data: number[], period: number): EMAResult {
  if (data.length < period) {
    return {
      values: data.map(() => null),
      current: null,
      period,
    };
  }

  const multiplier = 2 / (period + 1);
  const result: (number | null)[] = [];

  // Start with SMA for first EMA value
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Fill nulls for initial period
  for (let i = 0; i < period - 1; i++) {
    result.push(null);
  }
  result.push(ema);

  // Calculate EMA for remaining data
  for (let i = period; i < data.length; i++) {
    ema = (data[i]! - ema) * multiplier + ema;
    result.push(ema);
  }

  return {
    values: result,
    current: result[result.length - 1] ?? null,
    period,
  };
}

/**
 * Calculate multiple EMAs and determine alignment
 */
export function calculateMultiEMA(
  closes: number[],
  currentPrice: number
): MultiEMAResult {
  const ema9 = calculateEMA(closes, 9);
  const ema20 = calculateEMA(closes, 20);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);

  const ema9Val = ema9.current;
  const ema20Val = ema20.current;
  const ema50Val = ema50.current;
  const ema200Val = ema200.current;

  // Determine alignment
  let alignment: "bullish" | "bearish" | "mixed" = "mixed";

  if (ema9Val && ema20Val && ema50Val && ema200Val) {
    if (ema9Val > ema20Val && ema20Val > ema50Val && ema50Val > ema200Val) {
      alignment = "bullish";
    } else if (ema9Val < ema20Val && ema20Val < ema50Val && ema50Val < ema200Val) {
      alignment = "bearish";
    }
  }

  // Determine price position relative to EMAs
  let pricePosition: "above_all" | "below_all" | "mixed" = "mixed";

  if (ema9Val && ema20Val && ema50Val && ema200Val) {
    if (currentPrice > ema9Val && currentPrice > ema20Val &&
        currentPrice > ema50Val && currentPrice > ema200Val) {
      pricePosition = "above_all";
    } else if (currentPrice < ema9Val && currentPrice < ema20Val &&
               currentPrice < ema50Val && currentPrice < ema200Val) {
      pricePosition = "below_all";
    }
  }

  // Generate interpretation
  let interpretation = "";
  if (alignment === "bullish" && pricePosition === "above_all") {
    interpretation = "Strong uptrend - all EMAs aligned bullish with price above all";
  } else if (alignment === "bearish" && pricePosition === "below_all") {
    interpretation = "Strong downtrend - all EMAs aligned bearish with price below all";
  } else if (alignment === "bullish") {
    interpretation = "Bullish EMA alignment but price pulling back";
  } else if (alignment === "bearish") {
    interpretation = "Bearish EMA alignment but price attempting recovery";
  } else if (ema200Val && currentPrice > ema200Val) {
    interpretation = "Mixed signals but price above 200 EMA - long-term trend intact";
  } else if (ema200Val && currentPrice < ema200Val) {
    interpretation = "Mixed signals with price below 200 EMA - caution warranted";
  } else {
    interpretation = "Mixed EMA signals - wait for clearer trend";
  }

  return {
    ema9: ema9Val,
    ema20: ema20Val,
    ema50: ema50Val,
    ema200: ema200Val,
    alignment,
    pricePosition,
    interpretation,
  };
}
