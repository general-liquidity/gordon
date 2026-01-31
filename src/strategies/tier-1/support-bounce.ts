/**
 * Support Bounce Strategy
 *
 * A beginner-friendly strategy that identifies buying opportunities
 * when price approaches a support level with reversal signals.
 *
 * Entry Conditions:
 * - Price within 5% of a support level
 * - Support has strength >= 0.3 (multiple touches)
 * - RSI showing oversold or neutral (not overbought)
 * - MACD not strongly bearish
 *
 * Confidence Boosters:
 * - Oversold RSI (+10%)
 * - Rising volume (+10%)
 * - Strong support (strength > 0.7) (+10%)
 * - Multiple touches (3+) (+10%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
} from "../types.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

/** Maximum distance from support for valid setup (percentage) */
const MAX_DISTANCE_PERCENT = 5;

/** Minimum support strength required */
const MIN_SUPPORT_STRENGTH = 0.3;

/** Strong support threshold */
const STRONG_SUPPORT_THRESHOLD = 0.7;

/** Buffer below support for stop-loss (percentage) */
const STOP_LOSS_BUFFER_PERCENT = 1;

/** RSI oversold threshold */
const RSI_OVERSOLD = 30;

/** RSI overbought threshold (disqualifier) */
const RSI_OVERBOUGHT = 70;

// ============================================================================
// Support Bounce Strategy
// ============================================================================

export class SupportBounceStrategy extends BaseStrategy {
  // Strategy metadata
  readonly id: StrategyId = "support_bounce";
  readonly name = "Support Bounce";
  readonly tier = 1 as const;
  readonly description =
    "Buy near support levels when price shows reversal signals. " +
    "Best for range-bound markets and pullbacks in uptrends.";
  readonly indicators = ["RSI", "MACD", "Support/Resistance", "Volume"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "low" as const;

  /**
   * Detect Support Bounce setup
   */
  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    // Fetch candles
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < 50) {
      return this.notDetected("Insufficient data (need 50+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Detect support/resistance levels
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);

    if (supports.length === 0) {
      return this.notDetected("No support levels detected");
    }

    // Get nearest support
    const nearestSupport = supports[0];
    if (!nearestSupport) {
      return this.notDetected("No valid support level found");
    }

    // Check distance to support
    const distancePercent = this.calculateDistancePercent(
      currentPrice,
      nearestSupport.price
    );

    // Price must be above support (positive distance) and within threshold
    if (distancePercent < 0) {
      return this.notDetected(
        `Price is below support ($${nearestSupport.price.toFixed(2)})`
      );
    }

    if (distancePercent > MAX_DISTANCE_PERCENT) {
      return this.notDetected(
        `Too far from support (${distancePercent.toFixed(1)}% > ${MAX_DISTANCE_PERCENT}%)`
      );
    }

    // Check support strength
    if (nearestSupport.strength < MIN_SUPPORT_STRENGTH) {
      return this.notDetected(
        `Support too weak (strength ${(nearestSupport.strength * 100).toFixed(0)}% < ${MIN_SUPPORT_STRENGTH * 100}%)`
      );
    }

    // Calculate indicators
    const rsi = this.calculateRSI(candles);
    const macd = this.calculateMACD(candles);
    const volumeTrend = this.analyzeVolumeTrend(candles);

    // Disqualifiers
    if (rsi.current !== null && rsi.current > RSI_OVERBOUGHT) {
      return this.notDetected(
        `RSI overbought (${rsi.current.toFixed(1)} > ${RSI_OVERBOUGHT})`
      );
    }

    if (macd.trend === "bearish" && macd.crossover === "bearish_cross") {
      return this.notDetected("Strong bearish MACD signal");
    }

    // Calculate confidence
    let confidence = 0.5; // Base confidence

    // Distance bonus (closer = better)
    const proximityBonus =
      (MAX_DISTANCE_PERCENT - distancePercent) / MAX_DISTANCE_PERCENT;
    confidence += proximityBonus * 0.15;

    // Support strength bonus
    if (nearestSupport.strength >= STRONG_SUPPORT_THRESHOLD) {
      confidence += 0.1;
    } else {
      confidence += nearestSupport.strength * 0.1;
    }

    // RSI bonus
    if (rsi.current !== null && rsi.current < RSI_OVERSOLD) {
      confidence += 0.1;
    }

    // Volume bonus
    if (volumeTrend === "rising") {
      confidence += 0.1;
    } else if (volumeTrend === "falling") {
      confidence -= 0.05;
    }

    // Multiple touches bonus
    if (nearestSupport.touches >= 3) {
      confidence += 0.1;
    }

    // MACD alignment bonus
    if (macd.trend === "bullish" || macd.crossover === "bullish_cross") {
      confidence += 0.05;
    }

    // Build signals object
    const signals = {
      supportPrice: nearestSupport.price,
      supportStrength: nearestSupport.strength,
      supportTouches: nearestSupport.touches,
      distanceToSupport: distancePercent,
      rsi: rsi.current,
      rsiSignal: rsi.signal,
      macdTrend: macd.trend,
      macdCrossover: macd.crossover,
      volumeTrend,
    };

    // Build reasoning
    const reasons: string[] = [];
    reasons.push(
      `Price ${distancePercent.toFixed(1)}% above support at $${nearestSupport.price.toFixed(2)}`
    );
    reasons.push(
      `Support strength: ${(nearestSupport.strength * 100).toFixed(0)}% (${nearestSupport.touches} touches)`
    );
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)} (${rsi.signal})`);
    }
    reasons.push(`Volume: ${volumeTrend}`);
    reasons.push(`MACD: ${macd.trend}`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Calculate plan parameters for Support Bounce
   */
  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    // Get support levels
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);
    const resistances = this.getResistances(levels, currentPrice);

    // Entry at current price (or slightly below for limit order)
    const entryPrice = currentPrice;

    // Stop-loss below nearest support
    const nearestSupport = supports[0];
    const stopLoss = nearestSupport
      ? nearestSupport.price * (1 - STOP_LOSS_BUFFER_PERCENT / 100)
      : entryPrice * 0.95; // Fallback: 5% below entry

    // Take-profit at resistances or R:R targets
    const takeProfits = this.calculateTakeProfits(
      entryPrice,
      stopLoss,
      resistances
    );

    // Calculate average R:R
    const avgTpPrice =
      takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(
      entryPrice,
      stopLoss,
      avgTpPrice
    );

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes: `Support Bounce setup. Entry near $${entryPrice.toFixed(2)}, ` +
        `stop below support at $${stopLoss.toFixed(2)}. ` +
        `R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  /**
   * Calculate take-profit levels using resistances or R:R targets
   */
  private calculateTakeProfits(
    entryPrice: number,
    stopLoss: number,
    resistances: { price: number; strength: number }[]
  ): { price: number; percentToSell: number }[] {
    const risk = entryPrice - stopLoss;

    // If we have resistance levels, use them
    if (resistances.length >= 2) {
      const [r1, r2] = resistances;
      const r3Price = entryPrice + risk * 4; // TP3 at 4:1 R:R

      return [
        { price: r1?.price ?? entryPrice + risk * 1.5, percentToSell: 0.4 },
        { price: r2?.price ?? entryPrice + risk * 2.5, percentToSell: 0.4 },
        { price: r3Price, percentToSell: 0.2 },
      ];
    }

    // Fallback to R:R-based targets
    return this.createTakeProfitLevels(entryPrice, stopLoss, [1.5, 2.5, 4.0]);
  }

  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * BUY signal when:
   * - Price near support (within 2%)
   * - RSI < 40 (approaching oversold)
   * - Volume surge (volume ratio > 1.5)
   *
   * SELL signal when:
   * - Price hits resistance
   * - RSI > 70 (overbought)
   */
  override generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    const price = bar.close;
    const {
      rsi14,
      nearestSupport,
      nearestResistance,
      volumeRatio,
    } = indicators;

    // Check for SELL signal first (exit conditions)
    if (nearestResistance && price >= nearestResistance) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `Price hit resistance at $${nearestResistance.toFixed(2)}`,
      };
    }

    if (rsi14 !== null && rsi14 !== undefined && rsi14 > 70) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `RSI overbought at ${rsi14.toFixed(1)}`,
      };
    }

    // Check for BUY signal
    if (nearestSupport) {
      const distanceToSupport = ((price - nearestSupport) / nearestSupport) * 100;
      const isNearSupport = distanceToSupport >= 0 && distanceToSupport <= 2;
      const isOversoldApproaching = rsi14 !== null && rsi14 !== undefined && rsi14 < 40;
      const hasVolumeSurge = volumeRatio !== null && volumeRatio !== undefined && volumeRatio > 1.5;

      if (isNearSupport && isOversoldApproaching && hasVolumeSurge) {
        return {
          type: "BUY",
          price,
          timestamp: bar.timestamp,
          reason: `Support bounce: price ${distanceToSupport.toFixed(1)}% above support ($${nearestSupport.toFixed(2)}), RSI ${rsi14?.toFixed(1)}, volume surge ${volumeRatio?.toFixed(1)}x`,
        };
      }
    }

    return null;
  }

  /**
   * Get required indicators for backtesting.
   */
  override getRequiredIndicators(): string[] {
    return [
      "rsi14",
      "atr14",
      "nearestSupport",
      "nearestResistance",
      "supportStrength",
      "volumeRatio",
      "volumeAvg20",
    ];
  }

  /**
   * Get planner prompt fragment for Support Bounce
   */
  getPromptFragment(): string {
    return `
## Support Bounce Strategy Rules

When creating a plan using the Support Bounce strategy:

### Entry Rules
- Entry should be at or near current price (within 1-2% for limit orders)
- Price must be within 5% of the nearest support level
- Support should have been tested at least 2 times

### Stop-Loss Rules
- Place stop-loss 1% below the support level
- Never move stop-loss further from entry
- If support breaks, exit immediately

### Take-Profit Rules
- TP1: First resistance level OR 1.5:1 R:R (sell 40%)
- TP2: Second resistance level OR 2.5:1 R:R (sell 40%)
- TP3: Major resistance OR 4:1 R:R (sell remaining 20%)

### Risk Management
- Maximum position size: 5% of portfolio per trade
- Minimum R:R ratio: 1.5:1
- Do not enter if RSI > 70 (overbought)

### Best Conditions
- Range-bound markets where price respects levels
- Pullbacks in established uptrends
- High-volume bounces off support
`;
  }
}

// ============================================================================
// Export Singleton Instance
// ============================================================================

export const supportBounceStrategy = new SupportBounceStrategy();
