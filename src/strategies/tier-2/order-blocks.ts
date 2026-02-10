/**
 * Order Blocks Strategy (ICT)
 *
 * An advanced ICT strategy that identifies institutional supply/demand zones.
 * An order block is the last opposing candle before an impulsive move,
 * representing where institutions placed large orders.
 *
 * Entry Conditions:
 * - Identify impulsive move (3+ candles, combined body > 2x ATR)
 * - Mark the last opposing candle before the move as the order block
 * - Enter when price returns to the order block zone
 *
 * Confidence Boosters:
 * - Volume confirms the impulse (+15%)
 * - Multiple OBs align at same zone (+10%)
 * - Trend direction aligns with OB type (+10%)
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

interface OrderBlock {
  type: "bullish" | "bearish";
  high: number;
  low: number;
  open: number;
  close: number;
  volume: number;
  index: number;
  impulseStrength: number;
}

// ============================================================================
// Constants
// ============================================================================

const MIN_IMPULSE_CANDLES = 3;
const IMPULSE_ATR_MULTIPLIER = 2;
const PROXIMITY_ATR_MULTIPLIER = 1;
const VOLUME_CONFIRM_RATIO = 1.5;

// ============================================================================
// Order Blocks Strategy
// ============================================================================

export class OrderBlocksStrategy extends BaseStrategy {
  readonly id: StrategyId = "order_blocks";
  readonly name = "Order Blocks (ICT)";
  readonly tier = 2 as const;
  readonly description =
    "Identify institutional supply/demand zones using ICT order block concepts. " +
    "Trade bounces when price revisits zones where institutions previously entered.";
  readonly indicators = ["ATR", "Volume", "Price Action", "Structure"];
  readonly timeframes = ["1h", "4h", "1d"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < 30) {
      return this.notDetected("Insufficient data (need 30+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    const atr = this.calculateATR(candles);
    if (atr.current === null) {
      return this.notDetected("Could not calculate ATR");
    }

    // Find order blocks
    const orderBlocks = this.findOrderBlocks(candles, atr.current);
    if (orderBlocks.length === 0) {
      return this.notDetected("No order blocks detected in recent price action");
    }

    // Find OBs near current price
    const proximityThreshold = atr.current * PROXIMITY_ATR_MULTIPLIER;
    const nearbyOBs = orderBlocks.filter((ob) => {
      const obMid = (ob.high + ob.low) / 2;
      return Math.abs(currentPrice - obMid) <= proximityThreshold;
    });

    if (nearbyOBs.length === 0) {
      return this.notDetected(
        `Found ${orderBlocks.length} order blocks but none near current price (within ${proximityThreshold.toFixed(2)})`
      );
    }

    // Pick the strongest nearby OB
    const bestOB = nearbyOBs.sort((a, b) => b.impulseStrength - a.impulseStrength)[0]!;

    // Check if price is approaching from the right direction
    const isBullishSetup = bestOB.type === "bullish" && currentPrice >= bestOB.low && currentPrice <= bestOB.high * 1.01;
    const isBearishSetup = bestOB.type === "bearish" && currentPrice <= bestOB.high && currentPrice >= bestOB.low * 0.99;

    if (!isBullishSetup && !isBearishSetup) {
      return this.notDetected("Price not approaching order block from correct direction");
    }

    // Calculate confidence
    let confidence = 0.5;

    // Volume confirmation
    const avgVolume = this.getAverageVolume(candles, 20);
    if (bestOB.volume > avgVolume * VOLUME_CONFIRM_RATIO) {
      confidence += 0.15;
    }

    // Multiple OBs aligning
    if (nearbyOBs.length >= 2) {
      confidence += 0.1;
    }

    // Trend alignment
    const ema50 = this.calculateEMA(candles, 50);
    if (ema50.current !== null) {
      const trendAligns =
        (bestOB.type === "bullish" && currentPrice > ema50.current) ||
        (bestOB.type === "bearish" && currentPrice < ema50.current);
      if (trendAligns) {
        confidence += 0.1;
      }
    }

    // RSI not extreme
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null) {
      const rsiOk =
        (bestOB.type === "bullish" && rsi.current < 70) ||
        (bestOB.type === "bearish" && rsi.current > 30);
      if (rsiOk) {
        confidence += 0.05;
      }
    }

    const signals = {
      orderBlockType: bestOB.type,
      obHigh: bestOB.high,
      obLow: bestOB.low,
      impulseStrength: bestOB.impulseStrength,
      nearbyOrderBlocks: nearbyOBs.length,
      distanceToOB: Math.abs(currentPrice - (bestOB.high + bestOB.low) / 2),
      rsi: rsi.current,
    };

    const reasons: string[] = [];
    reasons.push(`${bestOB.type} order block at ${bestOB.low.toFixed(2)}-${bestOB.high.toFixed(2)}`);
    reasons.push(`Price in OB zone (impulse strength: ${bestOB.impulseStrength.toFixed(1)}x ATR)`);
    if (nearbyOBs.length >= 2) {
      reasons.push(`${nearbyOBs.length} order blocks clustering at this level`);
    }
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Find order blocks in candle data
   */
  private findOrderBlocks(candles: Candle[], atrValue: number): OrderBlock[] {
    const orderBlocks: OrderBlock[] = [];
    const minImpulseBody = atrValue * IMPULSE_ATR_MULTIPLIER;

    for (let i = MIN_IMPULSE_CANDLES; i < candles.length - 1; i++) {
      // Check for bullish impulse (consecutive bullish candles with large bodies)
      let bullishBody = 0;
      let bullishCount = 0;
      for (let j = i; j < Math.min(i + 5, candles.length); j++) {
        const c = candles[j]!;
        if (c.close > c.open) {
          bullishBody += c.close - c.open;
          bullishCount++;
        } else {
          break;
        }
      }

      if (bullishCount >= MIN_IMPULSE_CANDLES && bullishBody > minImpulseBody) {
        // The candle before the impulse is the order block
        const obCandle = candles[i - 1]!;
        // Must be a bearish candle (last opposing candle)
        if (obCandle.close < obCandle.open) {
          orderBlocks.push({
            type: "bullish",
            high: obCandle.high,
            low: obCandle.low,
            open: obCandle.open,
            close: obCandle.close,
            volume: obCandle.volume,
            index: i - 1,
            impulseStrength: bullishBody / atrValue,
          });
        }
      }

      // Check for bearish impulse
      let bearishBody = 0;
      let bearishCount = 0;
      for (let j = i; j < Math.min(i + 5, candles.length); j++) {
        const c = candles[j]!;
        if (c.close < c.open) {
          bearishBody += c.open - c.close;
          bearishCount++;
        } else {
          break;
        }
      }

      if (bearishCount >= MIN_IMPULSE_CANDLES && bearishBody > minImpulseBody) {
        const obCandle = candles[i - 1]!;
        if (obCandle.close > obCandle.open) {
          orderBlocks.push({
            type: "bearish",
            high: obCandle.high,
            low: obCandle.low,
            open: obCandle.open,
            close: obCandle.close,
            volume: obCandle.volume,
            index: i - 1,
            impulseStrength: bearishBody / atrValue,
          });
        }
      }
    }

    return orderBlocks;
  }

  /**
   * Calculate average volume over a period
   */
  private getAverageVolume(candles: Candle[], period: number): number {
    const slice = candles.slice(-period);
    return slice.reduce((sum, c) => sum + c.volume, 0) / slice.length;
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.02;

    const orderBlocks = this.findOrderBlocks(candles, atrVal);
    const nearbyOB = orderBlocks
      .filter((ob) => Math.abs(currentPrice - (ob.high + ob.low) / 2) <= atrVal * 2)
      .sort((a, b) => b.impulseStrength - a.impulseStrength)[0];

    const entryPrice = nearbyOB ? (nearbyOB.high + nearbyOB.low) / 2 : currentPrice;
    const stopLoss = nearbyOB
      ? (nearbyOB.type === "bullish" ? nearbyOB.low - atrVal * 1.5 : nearbyOB.high + atrVal * 1.5)
      : (currentPrice - atrVal * 2);

    const risk = Math.abs(entryPrice - stopLoss);
    const takeProfits = [
      { price: entryPrice + risk * 1.5, percentToSell: 0.3 },
      { price: entryPrice + risk * 2.5, percentToSell: 0.4 },
      { price: entryPrice + risk * 4, percentToSell: 0.3 },
    ];

    const avgTp = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTp);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Order block trade. Entry at OB zone $${entryPrice.toFixed(2)}. ` +
        `Stop 1.5 ATR beyond OB at $${stopLoss.toFixed(2)}. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Order Blocks (ICT) Strategy Rules

When creating a plan using the Order Blocks strategy:

### Entry Rules
- Enter when price revisits a confirmed order block zone
- Bullish OB: last bearish candle before a strong bullish impulse
- Bearish OB: last bullish candle before a strong bearish impulse
- Impulse must be 3+ candles with combined body > 2x ATR

### Stop-Loss Rules
- Place stop 1.5x ATR beyond the order block boundary
- Bullish OB: stop below the OB low
- Bearish OB: stop above the OB high

### Take-Profit Rules
- TP1: 1.5:1 R:R (sell 30%)
- TP2: 2.5:1 R:R (sell 40%)
- TP3: 4:1 R:R (sell 30%)

### Risk Management
- Volume should confirm the impulse move
- Stronger impulses = more reliable OBs
- Multiple OBs at same level increase probability
- Don't trade against the higher-timeframe trend
`;
  }
}

export const orderBlocksStrategy = new OrderBlocksStrategy();
