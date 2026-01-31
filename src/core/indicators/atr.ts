/**
 * Average True Range (ATR) Indicator
 * Volatility measurement for position sizing and stop-loss calculation
 */

import type { Candle, ATRResult } from "./types.ts";

/**
 * Calculate True Range for a single candle
 */
function calculateTrueRange(
  high: number,
  low: number,
  prevClose: number
): number {
  const hl = high - low;
  const hc = Math.abs(high - prevClose);
  const lc = Math.abs(low - prevClose);
  return Math.max(hl, hc, lc);
}

/**
 * Calculate ATR (Average True Range)
 *
 * ATR measures market volatility by analyzing the range of price movement.
 * Used for:
 * - Setting stop-loss distances
 * - Position sizing based on volatility
 * - Identifying volatility expansions/contractions
 *
 * @param candles - Array of OHLC candles
 * @param period - ATR lookback period (default 14)
 * @param currentPrice - Current price for stop-loss calculation
 * @param atrMultiplier - Multiplier for stop-loss distance (default 1.5)
 * @returns ATR result with values and stop-loss levels
 */
export function calculateATR(
  candles: Candle[],
  period: number = 14,
  currentPrice?: number,
  atrMultiplier: number = 1.5
): ATRResult {
  if (candles.length < period + 1) {
    return {
      values: candles.map(() => null),
      current: null,
      period,
      stopLoss: {
        long: 0,
        short: 0,
        distance: 0,
      },
      interpretation: "Insufficient data for ATR calculation",
    };
  }

  const trueRanges: number[] = [];

  // Calculate True Range for each candle (starting from second candle)
  for (let i = 1; i < candles.length; i++) {
    const candle = candles[i]!;
    const prevCandle = candles[i - 1]!;
    const tr = calculateTrueRange(candle.high, candle.low, prevCandle.close);
    trueRanges.push(tr);
  }

  // Calculate ATR using Wilder's smoothing method
  const atrValues: (number | null)[] = [null]; // First candle has no TR

  // First ATR is simple average of first 'period' true ranges
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;

  // Fill nulls for initial period
  for (let i = 1; i < period; i++) {
    atrValues.push(null);
  }
  atrValues.push(atr);

  // Calculate remaining ATR values using Wilder's smoothing
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]!) / period;
    atrValues.push(atr);
  }

  const currentATR = atrValues[atrValues.length - 1] ?? null;
  const lastCandle = candles[candles.length - 1];
  const price = currentPrice ?? (lastCandle?.close ?? 0);

  // Calculate stop-loss levels
  const stopDistance = currentATR !== null ? currentATR * atrMultiplier : 0;
  const stopLoss = {
    long: price - stopDistance,    // Stop for long position
    short: price + stopDistance,   // Stop for short position
    distance: stopDistance,
  };

  // Generate interpretation
  let interpretation = "";
  if (currentATR !== null) {
    const atrPercent = (currentATR / price) * 100;

    if (atrPercent < 1) {
      interpretation = `Low volatility (ATR ${atrPercent.toFixed(2)}% of price) - tight stops possible`;
    } else if (atrPercent < 3) {
      interpretation = `Normal volatility (ATR ${atrPercent.toFixed(2)}% of price) - standard risk parameters`;
    } else if (atrPercent < 5) {
      interpretation = `Elevated volatility (ATR ${atrPercent.toFixed(2)}% of price) - wider stops recommended`;
    } else {
      interpretation = `High volatility (ATR ${atrPercent.toFixed(2)}% of price) - reduce position size or avoid`;
    }
  } else {
    interpretation = "Insufficient data for ATR calculation";
  }

  return {
    values: atrValues,
    current: currentATR,
    period,
    stopLoss,
    interpretation,
  };
}

/**
 * Calculate position size based on ATR and risk amount
 *
 * @param accountRisk - Amount willing to risk (e.g., $100)
 * @param atr - Current ATR value
 * @param atrMultiplier - ATR multiplier for stop distance
 * @param price - Current price
 * @returns Position size and details
 */
export function calculatePositionSize(
  accountRisk: number,
  atr: number,
  atrMultiplier: number,
  price: number
): {
  positionSize: number;
  shares: number;
  stopDistance: number;
  riskPerShare: number;
} {
  const stopDistance = atr * atrMultiplier;
  const riskPerShare = stopDistance;
  const shares = accountRisk / riskPerShare;
  const positionSize = shares * price;

  return {
    positionSize,
    shares,
    stopDistance,
    riskPerShare,
  };
}
