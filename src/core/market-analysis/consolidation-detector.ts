/**
 * Consolidation Detection
 *
 * Detects when a market is in a consolidation phase (low volatility,
 * range-bound) using True Range percentage analysis.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import type { Candle } from "../../types/index.ts";

const logger = createModuleLogger("consolidation-detector");

// ============================================================================
// Types
// ============================================================================

export interface ConsolidationResult {
  isConsolidating: boolean;
  consolidationLow: number;
  consolidationHigh: number;
  rangeSize: number;
  rangePercent: number; // Range as percentage of price
  trueRangePercent: number; // Current TR as percentage of price
  barsInConsolidation: number;
}

export interface ConsolidationRange {
  low: number;
  high: number;
  rangeSize: number;
  midpoint: number;
}

// ============================================================================
// Consolidation Detector
// ============================================================================

export class ConsolidationDetector {
  private consolidationThresholdPercent: number;

  /**
   * @param consolidationThresholdPercent - TR% below this is considered consolidation (default 0.7%)
   */
  constructor(consolidationThresholdPercent: number = 0.7) {
    this.consolidationThresholdPercent = consolidationThresholdPercent;
  }

  /**
   * Calculate True Range for a candle
   */
  private calculateTrueRange(candle: Candle, prevClose: number | null): number {
    const highLow = candle.high - candle.low;

    if (prevClose === null) {
      return highLow;
    }

    const highClose = Math.abs(candle.high - prevClose);
    const lowClose = Math.abs(candle.low - prevClose);

    return Math.max(highLow, highClose, lowClose);
  }

  /**
   * Check if market is currently in consolidation
   */
  isConsolidating(candles: Candle[]): boolean {
    try {
      if (candles.length < 2) {
        return false;
      }

      const currentCandle = candles[candles.length - 1]!;
      const prevCandle = candles[candles.length - 2]!;

      const tr = this.calculateTrueRange(currentCandle, prevCandle.close);
      const currentPrice = currentCandle.close;

      if (currentPrice <= 0) {
        return false;
      }

      const trPercent = (tr / currentPrice) * 100;
      return trPercent < this.consolidationThresholdPercent;
    } catch (error) {
      logger.error("Error detecting consolidation", error as Error);
      return false;
    }
  }

  /**
   * Full consolidation analysis
   */
  detectConsolidation(candles: Candle[]): ConsolidationResult {
    try {
      if (candles.length < 2) {
        return {
          isConsolidating: false,
          consolidationLow: 0,
          consolidationHigh: 0,
          rangeSize: 0,
          rangePercent: 0,
          trueRangePercent: 0,
          barsInConsolidation: 0,
        };
      }

      const currentCandle = candles[candles.length - 1]!;
      const prevCandle = candles[candles.length - 2]!;

      const tr = this.calculateTrueRange(currentCandle, prevCandle.close);
      const currentPrice = currentCandle.close;
      const trPercent = currentPrice > 0 ? (tr / currentPrice) * 100 : 0;

      const isConsolidating = trPercent < this.consolidationThresholdPercent;

      // Find consolidation range
      const { low, high, barsInConsolidation } = this.getConsolidationRange(candles);

      const rangeSize = high - low;
      const rangePercent = currentPrice > 0 ? (rangeSize / currentPrice) * 100 : 0;

      return {
        isConsolidating,
        consolidationLow: low,
        consolidationHigh: high,
        rangeSize,
        rangePercent,
        trueRangePercent: trPercent,
        barsInConsolidation,
      };
    } catch (error) {
      logger.error("Error in consolidation detection", error as Error);
      return {
        isConsolidating: false,
        consolidationLow: 0,
        consolidationHigh: 0,
        rangeSize: 0,
        rangePercent: 0,
        trueRangePercent: 0,
        barsInConsolidation: 0,
      };
    }
  }

  /**
   * Get the consolidation range (low and high) for the current consolidation period
   *
   * Walks backwards from the current bar until it finds a bar where
   * TR% exceeds the threshold (end of consolidation).
   */
  getConsolidationRange(candles: Candle[]): ConsolidationRange & { barsInConsolidation: number } {
    try {
      if (candles.length < 2) {
        const candle = candles[0];
        if (candle) {
          return {
            low: candle.low,
            high: candle.high,
            rangeSize: candle.high - candle.low,
            midpoint: (candle.high + candle.low) / 2,
            barsInConsolidation: 1,
          };
        }
        return { low: 0, high: 0, rangeSize: 0, midpoint: 0, barsInConsolidation: 0 };
      }

      // Walk backwards to find where consolidation started
      let consolidationStartIdx = 0;

      for (let i = candles.length - 1; i > 0; i--) {
        const candle = candles[i]!;
        const prevCandle = candles[i - 1]!;

        const tr = this.calculateTrueRange(candle, prevCandle.close);
        const trPercent = candle.close > 0 ? (tr / candle.close) * 100 : 0;

        // If TR% exceeds threshold, consolidation started at the next bar
        if (trPercent > this.consolidationThresholdPercent) {
          consolidationStartIdx = i + 1;
          break;
        }
      }

      // Get candles in consolidation period
      const consolidationCandles = candles.slice(consolidationStartIdx);

      if (consolidationCandles.length === 0) {
        // Use last 10 bars as fallback
        const fallbackCandles = candles.slice(-10);
        let low = Infinity;
        let high = -Infinity;

        for (const candle of fallbackCandles) {
          if (candle.low < low) low = candle.low;
          if (candle.high > high) high = candle.high;
        }

        return {
          low: low === Infinity ? 0 : low,
          high: high === -Infinity ? 0 : high,
          rangeSize: high - low,
          midpoint: (high + low) / 2,
          barsInConsolidation: fallbackCandles.length,
        };
      }

      // Find low and high of consolidation period
      let low = Infinity;
      let high = -Infinity;

      for (const candle of consolidationCandles) {
        if (candle.low < low) low = candle.low;
        if (candle.high > high) high = candle.high;
      }

      const rangeSize = high - low;
      const midpoint = (high + low) / 2;

      return {
        low: low === Infinity ? 0 : low,
        high: high === -Infinity ? 0 : high,
        rangeSize,
        midpoint,
        barsInConsolidation: consolidationCandles.length,
      };
    } catch (error) {
      logger.error("Error getting consolidation range", error as Error);
      return { low: 0, high: 0, rangeSize: 0, midpoint: 0, barsInConsolidation: 0 };
    }
  }

  /**
   * Check if price is near consolidation boundaries (potential breakout zone)
   */
  isNearBoundary(
    currentPrice: number,
    consolidationRange: ConsolidationRange,
    thresholdPercent: number = 1.0,
  ): { nearLow: boolean; nearHigh: boolean; position: "near_low" | "near_high" | "middle" } {
    const { low, high } = consolidationRange;

    if (low === 0 || high === 0) {
      return { nearLow: false, nearHigh: false, position: "middle" };
    }

    const distanceToLow = ((currentPrice - low) / low) * 100;
    const distanceToHigh = ((high - currentPrice) / high) * 100;

    const nearLow = distanceToLow <= thresholdPercent;
    const nearHigh = distanceToHigh <= thresholdPercent;

    let position: "near_low" | "near_high" | "middle" = "middle";
    if (nearLow) position = "near_low";
    if (nearHigh) position = "near_high";

    return { nearLow, nearHigh, position };
  }
}

// Default instance
export const consolidationDetector = new ConsolidationDetector();
