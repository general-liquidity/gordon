/**
 * Camarilla Pivot Points
 * 8 intraday support/resistance levels (R1-R4, S1-S4)
 * calculated from the previous period's OHLC range.
 *
 * Camarilla Pivot strategy.
 *
 * Camarilla multipliers (using 1.1 factor):
 *   R4 = close + range * 1.1/2   (breakout level)
 *   R3 = close + range * 1.1/4   (reversal resistance)
 *   R2 = close + range * 1.1/6
 *   R1 = close + range * 1.1/12
 *   S1 = close - range * 1.1/12
 *   S2 = close - range * 1.1/6
 *   S3 = close - range * 1.1/4   (reversal support)
 *   S4 = close - range * 1.1/2   (breakdown level)
 */

import type { Candle } from "./types.ts";

export interface CamarillaLevel {
  label: string;
  price: number;
  type: "support" | "resistance";
  role: "reversal" | "breakout" | "intermediate";
}

export interface CamarillaPivotResult {
  /** All 8 levels ordered R4 → S4 */
  levels: CamarillaLevel[];
  /** Previous period high used for calculation */
  prevHigh: number;
  /** Previous period low used for calculation */
  prevLow: number;
  /** Previous period close used for calculation */
  prevClose: number;
  /** Current price position relative to levels */
  priceZone: string;
  /** Nearest level to current price */
  nearestLevel: CamarillaLevel | null;
  /** Active signal based on price position */
  signal: "long_reversal" | "short_reversal" | "long_breakout" | "short_breakout" | "neutral";
  /** Interpretation string */
  interpretation: string;
}

const CAMARILLA_FACTOR = 1.1;

/**
 * Calculate Camarilla Pivot Points from candle data.
 *
 * @param candles - OHLCV candle array (needs at least 2 candles — uses previous for pivots)
 * @param lookbackPeriod - Number of candles for the "previous period" (default 24 for hourly→daily)
 * @param currentPrice - Optional current price override
 * @returns CamarillaPivotResult
 */
export function calculateCamarillaPivots(
  candles: Candle[],
  lookbackPeriod: number = 24,
  currentPrice?: number,
): CamarillaPivotResult {
  if (candles.length < lookbackPeriod + 1) {
    return {
      levels: [],
      prevHigh: 0,
      prevLow: 0,
      prevClose: 0,
      priceZone: "unknown",
      nearestLevel: null,
      signal: "neutral",
      interpretation: "Insufficient data for Camarilla pivot calculation",
    };
  }

  // Previous period = lookbackPeriod candles before the last one
  const prevPeriodEnd = candles.length - 1;
  const prevPeriodStart = prevPeriodEnd - lookbackPeriod;

  let prevHigh = -Infinity;
  let prevLow = Infinity;
  for (let i = prevPeriodStart; i < prevPeriodEnd; i++) {
    if (candles[i]!.high > prevHigh) prevHigh = candles[i]!.high;
    if (candles[i]!.low < prevLow) prevLow = candles[i]!.low;
  }
  const prevClose = candles[prevPeriodEnd - 1]!.close;

  const range = prevHigh - prevLow;
  if (range <= 0) {
    return {
      levels: [],
      prevHigh,
      prevLow,
      prevClose,
      priceZone: "unknown",
      nearestLevel: null,
      signal: "neutral",
      interpretation: "No price range in previous period — cannot compute Camarilla levels",
    };
  }

  // Calculate all 8 levels
  const r4 = prevClose + (range * CAMARILLA_FACTOR) / 2;
  const r3 = prevClose + (range * CAMARILLA_FACTOR) / 4;
  const r2 = prevClose + (range * CAMARILLA_FACTOR) / 6;
  const r1 = prevClose + (range * CAMARILLA_FACTOR) / 12;
  const s1 = prevClose - (range * CAMARILLA_FACTOR) / 12;
  const s2 = prevClose - (range * CAMARILLA_FACTOR) / 6;
  const s3 = prevClose - (range * CAMARILLA_FACTOR) / 4;
  const s4 = prevClose - (range * CAMARILLA_FACTOR) / 2;

  const levels: CamarillaLevel[] = [
    { label: "R4", price: r4, type: "resistance", role: "breakout" },
    { label: "R3", price: r3, type: "resistance", role: "reversal" },
    { label: "R2", price: r2, type: "resistance", role: "intermediate" },
    { label: "R1", price: r1, type: "resistance", role: "intermediate" },
    { label: "S1", price: s1, type: "support", role: "intermediate" },
    { label: "S2", price: s2, type: "support", role: "intermediate" },
    { label: "S3", price: s3, type: "support", role: "reversal" },
    { label: "S4", price: s4, type: "support", role: "breakout" },
  ];

  const price = currentPrice ?? candles[candles.length - 1]!.close;

  // Find nearest level
  let nearestLevel: CamarillaLevel | null = null;
  let minDist = Infinity;
  for (const level of levels) {
    const dist = Math.abs(price - level.price);
    if (dist < minDist) {
      minDist = dist;
      nearestLevel = level;
    }
  }

  // Determine price zone
  const priceZone = getPriceZone(price, r4, r3, r2, r1, s1, s2, s3, s4);

  // Determine signal
  const signal = getSignal(price, r4, r3, s3, s4, candles);

  const interpretation = buildCamarillaInterpretation(
    price,
    levels,
    priceZone,
    signal,
    nearestLevel,
    range,
  );

  return {
    levels,
    prevHigh,
    prevLow,
    prevClose,
    priceZone,
    nearestLevel,
    signal,
    interpretation,
  };
}

function getPriceZone(
  price: number,
  r4: number,
  r3: number,
  r2: number,
  r1: number,
  s1: number,
  s2: number,
  s3: number,
  s4: number,
): string {
  if (price > r4) return "above_R4";
  if (price > r3) return "R3_R4";
  if (price > r2) return "R2_R3";
  if (price > r1) return "R1_R2";
  if (price > s1) return "S1_R1";
  if (price > s2) return "S1_S2";
  if (price > s3) return "S2_S3";
  if (price > s4) return "S3_S4";
  return "below_S4";
}

function getSignal(
  price: number,
  r4: number,
  r3: number,
  s3: number,
  s4: number,
  candles: Candle[],
): "long_reversal" | "short_reversal" | "long_breakout" | "short_breakout" | "neutral" {
  const lastCandle = candles[candles.length - 1]!;

  // S3 bounce → long reversal
  if (lastCandle.low <= s3 && price > s3) return "long_reversal";

  // R3 bounce → short reversal
  if (lastCandle.high >= r3 && price < r3) return "short_reversal";

  // R4 breakout → long breakout
  if (price > r4) return "long_breakout";

  // S4 breakdown → short breakout
  if (price < s4) return "short_breakout";

  return "neutral";
}

function buildCamarillaInterpretation(
  price: number,
  _levels: CamarillaLevel[],
  zone: string,
  signal: string,
  nearest: CamarillaLevel | null,
  range: number,
): string {
  if (!nearest) return "Unable to determine Camarilla levels";

  const distPct = ((Math.abs(price - nearest.price) / range) * 100).toFixed(1);

  let msg =
    `Price in ${zone} zone, nearest level: ${nearest.label} at ${nearest.price.toFixed(2)} ` +
    `(${distPct}% of range away). `;

  switch (signal) {
    case "long_reversal":
      msg += `S3 bounce detected — potential long reversal. Target: R1/R2 levels. Stop below S4.`;
      break;
    case "short_reversal":
      msg += `R3 bounce detected — potential short reversal. Target: S1/S2 levels. Stop above R4.`;
      break;
    case "long_breakout":
      msg += `R4 breakout — strong bullish momentum. Trail stops using previous resistance levels.`;
      break;
    case "short_breakout":
      msg += `S4 breakdown — strong bearish momentum. Trail stops using previous support levels.`;
      break;
    default:
      msg += `No active Camarilla signal. Watch for price to reach S3/R3 (reversal) or S4/R4 (breakout).`;
  }

  return msg;
}
