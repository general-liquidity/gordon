/**
 * Fair Value Gaps Strategy (ICT)
 *
 * Detects price imbalances where candle 1's wick and candle 3's wick
 * don't overlap, creating a "gap" that price tends to fill.
 *
 * Entry Conditions:
 * - Bullish FVG: candle_1.high < candle_3.low (gap up)
 * - Bearish FVG: candle_1.low > candle_3.high (gap down)
 * - Price approaching an unfilled gap
 *
 * Confidence Boosters:
 * - Gap is large (> 1 ATR) (+15%)
 * - Volume increases toward gap (+10%)
 * - Gap aligns with trend (+10%)
 * - Multiple gaps cluster (+10%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
} from "../types.ts";
import type { Candle } from "../../core/indicators/types.ts";

// ============================================================================
// Types
// ============================================================================

interface FairValueGap {
  type: "bullish" | "bearish";
  gapHigh: number;
  gapLow: number;
  gapSize: number;
  index: number;
  filled: boolean;
}

// ============================================================================
// Constants
// ============================================================================

const FVG_SCAN_LOOKBACK = 50;
const PROXIMITY_ATR_MULTIPLIER = 1.5;

// ============================================================================
// Fair Value Gaps Strategy
// ============================================================================

export class FairValueGapsStrategy extends BaseStrategy {
  readonly id: StrategyId = "fair_value_gaps";
  readonly name = "Fair Value Gaps (ICT)";
  readonly tier = 2 as const;
  readonly description =
    "Detect price imbalances (3-candle gaps) that act as magnets for price. " +
    "Trade when price returns to fill the gap, using it as a support/resistance zone.";
  readonly indicators = ["ATR", "Volume", "Price Action"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < 20) {
      return this.notDetected("Insufficient data (need 20+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    const atr = this.calculateATR(candles);
    if (atr.current === null) {
      return this.notDetected("Could not calculate ATR");
    }

    // Find all FVGs
    const allGaps = this.findFairValueGaps(candles);
    if (allGaps.length === 0) {
      return this.notDetected("No fair value gaps detected");
    }

    // Mark filled gaps
    this.markFilledGaps(allGaps, candles);

    // Filter to unfilled gaps only
    const unfilledGaps = allGaps.filter((g) => !g.filled);
    if (unfilledGaps.length === 0) {
      return this.notDetected("All fair value gaps have been filled");
    }

    // Find gaps near current price
    const proximityThreshold = atr.current * PROXIMITY_ATR_MULTIPLIER;
    const nearbyGaps = unfilledGaps.filter((gap) => {
      const gapMid = (gap.gapHigh + gap.gapLow) / 2;
      return Math.abs(currentPrice - gapMid) <= proximityThreshold;
    });

    if (nearbyGaps.length === 0) {
      return this.notDetected(
        `Found ${unfilledGaps.length} unfilled gaps but none near current price`
      );
    }

    // Pick the largest nearby gap
    const bestGap = nearbyGaps.sort((a, b) => b.gapSize - a.gapSize)[0]!;

    // Check approach direction
    const isBullishSetup = bestGap.type === "bullish" && currentPrice >= bestGap.gapLow && currentPrice <= bestGap.gapHigh;
    const isBearishSetup = bestGap.type === "bearish" && currentPrice <= bestGap.gapHigh && currentPrice >= bestGap.gapLow;
    const isApproaching =
      (bestGap.type === "bullish" && currentPrice > bestGap.gapLow - proximityThreshold && currentPrice <= bestGap.gapHigh) ||
      (bestGap.type === "bearish" && currentPrice < bestGap.gapHigh + proximityThreshold && currentPrice >= bestGap.gapLow);

    if (!isBullishSetup && !isBearishSetup && !isApproaching) {
      return this.notDetected("Price not approaching any unfilled gap");
    }

    // Calculate confidence
    let confidence = 0.45;

    // Gap size bonus
    if (bestGap.gapSize > atr.current) {
      confidence += 0.15;
    } else if (bestGap.gapSize > atr.current * 0.5) {
      confidence += 0.08;
    }

    // Volume trend toward gap
    const volumeTrend = this.analyzeVolumeTrend(candles, 10);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // Trend alignment
    const ema50 = this.calculateEMA(candles, 50);
    if (ema50.current !== null) {
      const trendAligns =
        (bestGap.type === "bullish" && currentPrice > ema50.current) ||
        (bestGap.type === "bearish" && currentPrice < ema50.current);
      if (trendAligns) {
        confidence += 0.1;
      }
    }

    // Multiple gaps clustering
    if (nearbyGaps.length >= 2) {
      confidence += 0.1;
    }

    const signals = {
      gapType: bestGap.type,
      gapHigh: bestGap.gapHigh,
      gapLow: bestGap.gapLow,
      gapSize: bestGap.gapSize,
      gapSizeATR: bestGap.gapSize / atr.current,
      unfilledGapsNearby: nearbyGaps.length,
      totalUnfilledGaps: unfilledGaps.length,
      volumeTrend,
    };

    const reasons: string[] = [];
    reasons.push(
      `${bestGap.type} FVG at ${bestGap.gapLow.toFixed(2)}-${bestGap.gapHigh.toFixed(2)} ` +
      `(${(bestGap.gapSize / atr.current).toFixed(1)}x ATR)`
    );
    if (isBullishSetup || isBearishSetup) {
      reasons.push("Price inside the gap zone");
    } else {
      reasons.push("Price approaching the gap");
    }
    if (nearbyGaps.length >= 2) {
      reasons.push(`${nearbyGaps.length} unfilled gaps clustering at this level`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Find all fair value gaps in candle data
   */
  private findFairValueGaps(candles: Candle[]): FairValueGap[] {
    const gaps: FairValueGap[] = [];
    const scanEnd = Math.max(candles.length - FVG_SCAN_LOOKBACK, 2);

    for (let i = candles.length - 1; i >= scanEnd; i--) {
      if (i < 2) break;

      const candle1 = candles[i - 2]!;
      const candle3 = candles[i]!;

      // Bullish FVG: candle 1 high < candle 3 low (gap up)
      if (candle1.high < candle3.low) {
        gaps.push({
          type: "bullish",
          gapHigh: candle3.low,
          gapLow: candle1.high,
          gapSize: candle3.low - candle1.high,
          index: i - 1, // middle candle index
          filled: false,
        });
      }

      // Bearish FVG: candle 1 low > candle 3 high (gap down)
      if (candle1.low > candle3.high) {
        gaps.push({
          type: "bearish",
          gapHigh: candle1.low,
          gapLow: candle3.high,
          gapSize: candle1.low - candle3.high,
          index: i - 1,
          filled: false,
        });
      }
    }

    return gaps;
  }

  /**
   * Mark gaps that have been filled by subsequent price action
   */
  private markFilledGaps(gaps: FairValueGap[], candles: Candle[]): void {
    for (const gap of gaps) {
      // Check if any candle after the gap traded through it
      for (let i = gap.index + 2; i < candles.length; i++) {
        const c = candles[i]!;
        if (gap.type === "bullish" && c.low <= gap.gapLow) {
          gap.filled = true;
          break;
        }
        if (gap.type === "bearish" && c.high >= gap.gapHigh) {
          gap.filled = true;
          break;
        }
      }
    }
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.02;

    const allGaps = this.findFairValueGaps(candles);
    this.markFilledGaps(allGaps, candles);
    const nearbyGap = allGaps
      .filter((g) => !g.filled && Math.abs(currentPrice - (g.gapHigh + g.gapLow) / 2) <= atrVal * 2)
      .sort((a, b) => b.gapSize - a.gapSize)[0];

    const entryPrice = nearbyGap ? (nearbyGap.gapHigh + nearbyGap.gapLow) / 2 : currentPrice;
    const stopLoss = nearbyGap
      ? (nearbyGap.type === "bullish" ? nearbyGap.gapLow - atrVal : nearbyGap.gapHigh + atrVal)
      : (currentPrice - atrVal * 1.5);

    const risk = Math.abs(entryPrice - stopLoss);
    const takeProfits = [
      { price: entryPrice + risk * 1.5, percentToSell: 0.3 },
      { price: entryPrice + risk * 2.5, percentToSell: 0.4 },
      { price: entryPrice + risk * 3.5, percentToSell: 0.3 },
    ];

    const avgTp = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTp);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `FVG trade. Entry at gap midpoint $${entryPrice.toFixed(2)}. ` +
        `Stop 1 ATR beyond gap at $${stopLoss.toFixed(2)}. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Fair Value Gaps (ICT) Strategy Rules

When creating a plan using the Fair Value Gaps strategy:

### Entry Rules
- Enter when price returns to an unfilled FVG zone
- Bullish FVG: 3-candle gap where candle 1 high < candle 3 low
- Bearish FVG: 3-candle gap where candle 1 low > candle 3 high
- Enter at the gap midpoint for best fill

### Stop-Loss Rules
- Place stop 1x ATR beyond the gap boundary
- Bullish FVG: stop below the gap low
- Bearish FVG: stop above the gap high

### Take-Profit Rules
- TP1: 1.5:1 R:R (sell 30%)
- TP2: 2.5:1 R:R (sell 40%)
- TP3: 3.5:1 R:R (sell 30%)

### Risk Management
- Larger gaps are more significant (> 1 ATR ideal)
- Gaps in trending markets are more reliable
- Gaps that have been tested but not filled are stronger
- Multiple gaps at same level = high probability zone
`;
  }
}

export const fairValueGapsStrategy = new FairValueGapsStrategy();
