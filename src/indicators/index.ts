/**
 * Technical Indicators Module
 *
 * Re-exports all indicator calculations and provides a combined
 * function for calculating all indicators at once.
 */

import type { Candle, Indicators, Level } from "../types/index.ts";

// RSI exports
export { calculateRSI, calculateSMA, calculateEMA } from "./rsi.ts";

// MACD exports
export { calculateMACD } from "./macd.ts";
export type { MACDResult } from "./macd.ts";

// Volume exports
export {
  calculateVolumeMA,
  calculateVolumeRatio,
  calculateOBV,
  calculateVWAP,
} from "./volume.ts";

// Levels exports
export { detectLevels, findNearestLevels } from "./levels.ts";

// Import for internal use
import { calculateRSI } from "./rsi.ts";
import { calculateMACD } from "./macd.ts";
import { calculateVolumeMA, calculateVolumeRatio } from "./volume.ts";
import { detectLevels } from "./levels.ts";

/**
 * Calculate all technical indicators for a set of candles
 *
 * This is the main entry point for indicator calculation.
 * Returns a single Indicators object containing RSI, MACD, and volume metrics.
 *
 * @param candles - Array of candle data (oldest first)
 * @returns Indicators object with all calculated values
 */
export function calculateIndicators(candles: Candle[]): Indicators {
  // Calculate RSI with default period of 14
  const rsi = calculateRSI(candles, 14);

  // Calculate MACD with default periods (12, 26, 9)
  const macd = calculateMACD(candles, 12, 26, 9);

  // Calculate volume MA with default period of 20
  const volumeMA = calculateVolumeMA(candles, 20);

  // Calculate volume ratio with default period of 20
  const volumeRatio = calculateVolumeRatio(candles, 20);

  return {
    rsi,
    macd,
    volumeMA,
    volumeRatio,
  };
}

/**
 * Full analysis including indicators and levels
 */
export interface FullAnalysis {
  indicators: Indicators;
  levels: Level[];
}

/**
 * Calculate all indicators and detect support/resistance levels
 *
 * @param candles - Array of candle data (oldest first)
 * @param levelSensitivity - Sensitivity for level detection (default: 3)
 * @returns Full analysis with indicators and levels
 */
export function analyzeCandles(
  candles: Candle[],
  levelSensitivity: number = 3
): FullAnalysis {
  return {
    indicators: calculateIndicators(candles),
    levels: detectLevels(candles, levelSensitivity),
  };
}
