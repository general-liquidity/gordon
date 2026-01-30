/**
 * Breakout Detection
 *
 * Detects breakouts above resistance and breakdowns below support.
 * Calculates support/resistance levels from price history.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import type { Candle } from "../../types/index.ts";

const logger = createModuleLogger("breakout-detector");

// ============================================================================
// Types
// ============================================================================

export interface SupportResistanceLevels {
  support: number;
  resistance: number;
  lookbackPeriod: number;
}

export interface BreakoutResult {
  symbol: string;
  breakout: boolean; // Price above resistance
  breakdown: boolean; // Price below support
  support: number;
  resistance: number;
  currentPrice: number;
  breakoutPrice: number | null; // Entry price for breakout trade
  breakdownPrice: number | null; // Entry price for breakdown trade
  distanceToResistance: number; // Percentage
  distanceToSupport: number; // Percentage
}

export interface BreakoutRetestResult {
  buyBreakout: boolean;
  sellBreakdown: boolean;
  breakoutPrice: number | null;
  breakdownPrice: number | null;
  breakoutDetected: boolean;
  support: number;
  resistance: number;
  currentPrice: number;
  retestZone: { low: number; high: number } | null;
}

// ============================================================================
// Breakout Detector
// ============================================================================

export class BreakoutDetector {
  private lookbackBars: number;
  private retestBufferPercent: number;

  constructor(lookbackBars: number = 289, retestBufferPercent: number = 0.001) {
    this.lookbackBars = lookbackBars;
    this.retestBufferPercent = retestBufferPercent;
  }

  /**
   * Calculate support and resistance levels from candle data
   */
  calculateSupportResistance(candles: Candle[]): SupportResistanceLevels {
    try {
      const lookback = Math.min(this.lookbackBars, candles.length);

      if (lookback < 2) {
        return {
          support: 0,
          resistance: 0,
          lookbackPeriod: 0,
        };
      }

      const recentCandles = candles.slice(-lookback);

      let support = Infinity;
      let resistance = -Infinity;

      for (const candle of recentCandles) {
        if (candle.low < support) support = candle.low;
        if (candle.high > resistance) resistance = candle.high;
      }

      return {
        support: support === Infinity ? 0 : support,
        resistance: resistance === -Infinity ? 0 : resistance,
        lookbackPeriod: lookback,
      };
    } catch (error) {
      logger.error("Error calculating support/resistance", error as Error);
      return { support: 0, resistance: 0, lookbackPeriod: 0 };
    }
  }

  /**
   * Scan a symbol for breakout/breakdown
   */
  scanBreakout(
    symbol: string,
    candles: Candle[],
    currentBid: number,
    currentAsk: number
  ): BreakoutResult {
    try {
      if (candles.length < this.lookbackBars) {
        return {
          symbol,
          breakout: false,
          breakdown: false,
          support: 0,
          resistance: 0,
          currentPrice: (currentBid + currentAsk) / 2,
          breakoutPrice: null,
          breakdownPrice: null,
          distanceToResistance: 0,
          distanceToSupport: 0,
        };
      }

      const { support, resistance } = this.calculateSupportResistance(candles);
      const currentPrice = (currentBid + currentAsk) / 2;

      // Breakout: bid > resistance (we can sell above resistance)
      const breakout = currentBid > resistance;

      // Breakdown: ask < support (we can buy below support)
      const breakdown = currentAsk < support;

      // Calculate entry prices with buffer
      const breakoutPrice = breakout
        ? resistance * (1 + this.retestBufferPercent)
        : null;
      const breakdownPrice = breakdown
        ? support * (1 - this.retestBufferPercent)
        : null;

      // Calculate distances
      const distanceToResistance =
        resistance > 0 ? ((resistance - currentPrice) / currentPrice) * 100 : 0;
      const distanceToSupport =
        support > 0 ? ((currentPrice - support) / currentPrice) * 100 : 0;

      return {
        symbol,
        breakout,
        breakdown,
        support,
        resistance,
        currentPrice,
        breakoutPrice,
        breakdownPrice,
        distanceToResistance,
        distanceToSupport,
      };
    } catch (error) {
      logger.error("Error scanning breakout", error as Error, { symbol });
      return {
        symbol,
        breakout: false,
        breakdown: false,
        support: 0,
        resistance: 0,
        currentPrice: (currentBid + currentAsk) / 2,
        breakoutPrice: null,
        breakdownPrice: null,
        distanceToResistance: 0,
        distanceToSupport: 0,
      };
    }
  }

  /**
   * Detect breakout with retest pattern
   *
   * A retest occurs when:
   * 1. Price breaks above resistance
   * 2. Price pulls back to test the old resistance as new support
   * 3. Entry is placed at the retest level
   */
  detectBreakoutRetest(
    candles: Candle[],
    currentPrice: number
  ): BreakoutRetestResult {
    try {
      const { support, resistance } = this.calculateSupportResistance(candles);

      let buyBreakout = false;
      let sellBreakdown = false;
      let breakoutPrice: number | null = null;
      let breakdownPrice: number | null = null;
      let retestZone: { low: number; high: number } | null = null;

      // Check for upward breakout
      if (currentPrice > resistance) {
        buyBreakout = true;
        // Entry price is at the old resistance level (now support) with small buffer
        breakoutPrice = resistance * (1 + this.retestBufferPercent);
        retestZone = {
          low: resistance * (1 - this.retestBufferPercent),
          high: resistance * (1 + this.retestBufferPercent * 2),
        };
      }

      // Check for downward breakdown
      if (currentPrice < support) {
        sellBreakdown = true;
        // Entry price is at the old support level (now resistance) with small buffer
        breakdownPrice = support * (1 - this.retestBufferPercent);
        retestZone = {
          low: support * (1 - this.retestBufferPercent * 2),
          high: support * (1 + this.retestBufferPercent),
        };
      }

      const breakoutDetected = buyBreakout || sellBreakdown;

      return {
        buyBreakout,
        sellBreakdown,
        breakoutPrice,
        breakdownPrice,
        breakoutDetected,
        support,
        resistance,
        currentPrice,
        retestZone,
      };
    } catch (error) {
      logger.error("Error detecting breakout retest", error as Error);
      return {
        buyBreakout: false,
        sellBreakdown: false,
        breakoutPrice: null,
        breakdownPrice: null,
        breakoutDetected: false,
        support: 0,
        resistance: 0,
        currentPrice,
        retestZone: null,
      };
    }
  }

  /**
   * Scan multiple symbols for breakouts
   */
  async scanMultiple(
    symbols: Array<{
      symbol: string;
      candles: Candle[];
      bid: number;
      ask: number;
    }>
  ): Promise<BreakoutResult[]> {
    const results: BreakoutResult[] = [];

    for (const { symbol, candles, bid, ask } of symbols) {
      const result = this.scanBreakout(symbol, candles, bid, ask);
      results.push(result);
    }

    // Sort by breakout/breakdown status, then by distance to level
    return results.sort((a, b) => {
      // Prioritize actual breakouts/breakdowns
      if (a.breakout || a.breakdown) {
        if (!(b.breakout || b.breakdown)) return -1;
      } else if (b.breakout || b.breakdown) {
        return 1;
      }

      // Then sort by proximity to levels (closer = more interesting)
      const aMinDistance = Math.min(
        Math.abs(a.distanceToResistance),
        Math.abs(a.distanceToSupport)
      );
      const bMinDistance = Math.min(
        Math.abs(b.distanceToResistance),
        Math.abs(b.distanceToSupport)
      );

      return aMinDistance - bMinDistance;
    });
  }
}

// Default instance
export const breakoutDetector = new BreakoutDetector();
