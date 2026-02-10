/**
 * Supertrend Indicator
 * ATR-based dynamic trailing support/resistance that only moves in trend direction.
 * Clean trend-following signal — no repainting.
 *
 * Supertrend implementation.
 *
 * Upper band = HL2 + (ATR * multiplier) → resistance in downtrend
 * Lower band = HL2 - (ATR * multiplier) → support in uptrend
 * Bands trail price: upper only moves down, lower only moves up.
 * Direction flips when price crosses the active band.
 */

import type { Candle } from "./types.ts";

export interface SupertrendResult {
  /** Supertrend line values (support in uptrend, resistance in downtrend) */
  values: number[];
  /** Direction per bar: 1 = bullish, -1 = bearish */
  direction: number[];
  /** Current supertrend value */
  current: number | null;
  /** Current direction */
  currentDirection: 1 | -1;
  /** Whether direction just changed */
  trendChange: boolean;
  /** Signal based on current state */
  signal: "buy" | "sell" | "hold";
  /** Distance from price to supertrend line (%) */
  distance: number | null;
  /** Interpretation string */
  interpretation: string;
}

/**
 * Calculate simple ATR values
 */
function computeATR(candles: Candle[], period: number): number[] {
  const atr: number[] = [];
  const trueRanges: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    const high = candles[i]!.high;
    const low = candles[i]!.low;
    const prevClose = i > 0 ? candles[i - 1]!.close : candles[i]!.close;

    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trueRanges.push(tr);

    if (i < period) {
      // Simple average for initial ATR
      let sum = 0;
      for (let j = 0; j <= i; j++) sum += trueRanges[j]!;
      atr.push(sum / (i + 1));
    } else {
      // Wilder's smoothing
      atr.push((atr[i - 1]! * (period - 1) + tr) / period);
    }
  }
  return atr;
}

/**
 * Calculate Supertrend indicator.
 *
 * @param candles - OHLCV candle array
 * @param atrPeriod - ATR period (default 10)
 * @param multiplier - ATR multiplier for bands (default 2.0)
 * @returns SupertrendResult
 */
export function calculateSupertrend(
  candles: Candle[],
  atrPeriod: number = 10,
  multiplier: number = 2.0
): SupertrendResult {
  if (candles.length < atrPeriod + 2) {
    return {
      values: [],
      direction: [],
      current: null,
      currentDirection: 1,
      trendChange: false,
      signal: "hold",
      distance: null,
      interpretation: "Insufficient data for Supertrend calculation",
    };
  }

  const atr = computeATR(candles, atrPeriod);
  const n = candles.length;

  const finalUpper: number[] = new Array(n).fill(0);
  const finalLower: number[] = new Array(n).fill(0);
  const supertrend: number[] = new Array(n).fill(0);
  const direction: number[] = new Array(n).fill(0);

  // Initialize at atrPeriod
  const hl2Init = (candles[atrPeriod]!.high + candles[atrPeriod]!.low) / 2;
  finalUpper[atrPeriod] = hl2Init + multiplier * atr[atrPeriod]!;
  finalLower[atrPeriod] = hl2Init - multiplier * atr[atrPeriod]!;

  for (let i = atrPeriod + 1; i < n; i++) {
    const hl2 = (candles[i]!.high + candles[i]!.low) / 2;
    const basicUpper = hl2 + multiplier * atr[i]!;
    const basicLower = hl2 - multiplier * atr[i]!;

    // Upper band: trails down — only decreases unless price broke above it
    if (basicUpper < finalUpper[i - 1]! || candles[i - 1]!.close > finalUpper[i - 1]!) {
      finalUpper[i] = basicUpper;
    } else {
      finalUpper[i] = finalUpper[i - 1]!;
    }

    // Lower band: trails up — only increases unless price broke below it
    if (basicLower > finalLower[i - 1]! || candles[i - 1]!.close < finalLower[i - 1]!) {
      finalLower[i] = basicLower;
    } else {
      finalLower[i] = finalLower[i - 1]!;
    }

    // Determine direction
    if (i === atrPeriod + 1) {
      direction[i] = candles[i]!.close <= finalUpper[i]! ? -1 : 1;
    } else if (direction[i - 1] === -1) {
      // Was bearish — switch to bullish if price breaks above upper band
      direction[i] = candles[i]!.close > finalUpper[i]! ? 1 : -1;
    } else {
      // Was bullish — switch to bearish if price breaks below lower band
      direction[i] = candles[i]!.close < finalLower[i]! ? -1 : 1;
    }

    // Supertrend line = lower band in uptrend, upper band in downtrend
    supertrend[i] = direction[i] === -1 ? finalUpper[i]! : finalLower[i]!;
  }

  const current = supertrend[n - 1]!;
  const currentDir = direction[n - 1]! as 1 | -1;
  const prevDir = direction[n - 2]!;
  const trendChange = currentDir !== prevDir && prevDir !== 0;

  const lastClose = candles[n - 1]!.close;
  const distance = ((lastClose - current) / current) * 100;

  // Signal: buy on bearish→bullish flip, sell on bullish→bearish flip
  let signal: "buy" | "sell" | "hold" = "hold";
  if (trendChange) {
    signal = currentDir === 1 ? "buy" : "sell";
  }

  const interpretation = buildSupertrendInterpretation(
    lastClose,
    current,
    currentDir,
    trendChange,
    distance,
    signal
  );

  return {
    values: supertrend,
    direction,
    current,
    currentDirection: currentDir,
    trendChange,
    signal,
    distance: parseFloat(distance.toFixed(2)),
    interpretation,
  };
}

function buildSupertrendInterpretation(
  price: number,
  st: number,
  dir: number,
  changed: boolean,
  dist: number,
  signal: string
): string {
  const trendStr = dir === 1 ? "BULLISH" : "BEARISH";
  let msg = `Supertrend: ${trendStr} at ${st.toFixed(2)}. Price is ${Math.abs(dist).toFixed(1)}% ${dist > 0 ? "above" : "below"} the line. `;

  if (changed) {
    if (signal === "buy") {
      msg += `TREND FLIP to bullish — buy signal. Previous resistance becomes support.`;
    } else {
      msg += `TREND FLIP to bearish — sell signal. Previous support becomes resistance.`;
    }
  } else if (dir === 1) {
    msg += `Uptrend intact — supertrend at ${st.toFixed(2)} acts as trailing support. Hold longs.`;
  } else {
    msg += `Downtrend intact — supertrend at ${st.toFixed(2)} acts as trailing resistance. Avoid longs.`;
  }

  return msg;
}
