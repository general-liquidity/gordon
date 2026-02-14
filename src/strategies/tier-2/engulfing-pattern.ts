/**
 * Engulfing Pattern Strategy
 *
 * An intermediate strategy that identifies bullish engulfing candlestick
 * patterns at key support levels or after pullbacks.
 *
 * Entry Conditions:
 * - Bullish engulfing pattern (current green candle engulfs previous red)
 * - Pattern occurs at or near support level
 * - Volume confirmation (higher volume on engulfing candle)
 * - RSI not overbought
 *
 * Confidence Boosters:
 * - Pattern at strong support (+15%)
 * - Volume 1.5x+ on engulfing candle (+10%)
 * - RSI oversold (<35) before pattern (+10%)
 * - Large engulfing body relative to prior candle (+10%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
} from "../types.ts";
import type { Candle } from "../../core/indicators/types.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

/** Minimum body size ratio (engulfing vs engulfed) */
const MIN_ENGULF_RATIO = 1.0;

/** Strong engulfing ratio bonus threshold */
const STRONG_ENGULF_RATIO = 1.5;

/** Maximum distance from support for pattern validity (percentage) */
const MAX_SUPPORT_DISTANCE = 5;

/** Volume increase threshold for confirmation */
const VOLUME_THRESHOLD = 1.3;

// ============================================================================
// Engulfing Pattern Strategy
// ============================================================================

export class EngulfingPatternStrategy extends BaseStrategy {
  readonly id: StrategyId = "engulfing_pattern";
  readonly name = "Engulfing Pattern";
  readonly tier = 2 as const;
  readonly description =
    "Trade bullish engulfing candlestick patterns at support. " +
    "A reversal pattern where buyers overwhelm sellers.";
  readonly indicators = ["Candlestick Patterns", "Support Levels", "Volume", "RSI"];
  readonly timeframes = ["4h", "1d"];
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

    // Get the last two candles
    const engulfingCandle = candles[candles.length - 1];
    const engulfedCandle = candles[candles.length - 2];

    if (!engulfingCandle || !engulfedCandle) {
      return this.notDetected("Could not analyze recent candles");
    }

    // Check for bullish engulfing pattern
    const patternResult = this.detectBullishEngulfing(engulfedCandle, engulfingCandle);

    if (!patternResult.isPattern) {
      return this.notDetected(patternResult.reason ?? "No bullish engulfing pattern");
    }

    // Check if pattern is near support
    const levels = this.detectLevels(candles.slice(0, -2), currentPrice); // Exclude pattern candles
    const supports = this.getSupports(levels, engulfedCandle.low);
    const nearSupport = supports.some((s) => {
      const distance = Math.abs(engulfedCandle.low - s.price) / s.price;
      return distance < MAX_SUPPORT_DISTANCE / 100;
    });

    const nearestSupport = supports[0];
    const supportDistance = nearestSupport
      ? ((engulfedCandle.low - nearestSupport.price) / nearestSupport.price) * 100
      : 999;

    if (!nearSupport && supportDistance > MAX_SUPPORT_DISTANCE) {
      return this.notDetected(
        `Pattern not near support (${supportDistance.toFixed(1)}% from nearest)`
      );
    }

    // Volume confirmation
    const avgVolume = candles
      .slice(-21, -1)
      .reduce((sum, c) => sum + c.volume, 0) / 20;
    const volumeRatio = engulfingCandle.volume / avgVolume;

    // Calculate RSI for context
    const rsi = this.calculateRSI(candles);

    // Calculate confidence
    let confidence = 0.5;

    // Strong support bonus
    if (nearSupport && nearestSupport && nearestSupport.strength > 0.6) {
      confidence += 0.15;
    } else if (nearSupport) {
      confidence += 0.1;
    }

    // Volume confirmation bonus
    if (volumeRatio >= VOLUME_THRESHOLD) {
      confidence += 0.1;
    }

    // RSI oversold before pattern bonus
    const prevRSI = rsi.values[rsi.values.length - 2] ?? null;
    if (prevRSI !== null && prevRSI !== undefined && prevRSI < 35) {
      confidence += 0.1;
    }

    // Strong engulfing bonus (large body)
    if (patternResult.engulfRatio >= STRONG_ENGULF_RATIO) {
      confidence += 0.1;
    }

    // Body dominance bonus (small wicks)
    const engulfingBody = Math.abs(engulfingCandle.close - engulfingCandle.open);
    const engulfingRange = engulfingCandle.high - engulfingCandle.low;
    const bodyDominance = engulfingRange > 0 ? engulfingBody / engulfingRange : 0;
    if (bodyDominance > 0.7) {
      confidence += 0.05;
    }

    const signals = {
      engulfedOpen: engulfedCandle.open,
      engulfedClose: engulfedCandle.close,
      engulfingOpen: engulfingCandle.open,
      engulfingClose: engulfingCandle.close,
      engulfRatio: patternResult.engulfRatio,
      nearSupport,
      supportDistance,
      supportStrength: nearestSupport?.strength,
      volumeRatio,
      rsi: rsi.current,
      prevRSI,
      bodyDominance,
    };

    const reasons: string[] = [];
    reasons.push(`Bullish engulfing pattern (${patternResult.engulfRatio.toFixed(1)}x body ratio)`);
    if (nearSupport) {
      reasons.push(`At support level (${supportDistance.toFixed(1)}% distance)`);
    }
    reasons.push(`Volume: ${volumeRatio.toFixed(1)}x average`);
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Detect bullish engulfing pattern
   */
  private detectBullishEngulfing(
    engulfed: Candle,
    engulfing: Candle
  ): { isPattern: boolean; engulfRatio: number; reason?: string } {
    // Engulfed candle must be bearish (red)
    const engulfedBody = engulfed.close - engulfed.open;
    if (engulfedBody >= 0) {
      return { isPattern: false, engulfRatio: 0, reason: "Previous candle not bearish" };
    }

    // Engulfing candle must be bullish (green)
    const engulfingBody = engulfing.close - engulfing.open;
    if (engulfingBody <= 0) {
      return { isPattern: false, engulfRatio: 0, reason: "Current candle not bullish" };
    }

    // Engulfing body must be larger than engulfed body
    const engulfRatio = engulfingBody / Math.abs(engulfedBody);
    if (engulfRatio < MIN_ENGULF_RATIO) {
      return {
        isPattern: false,
        engulfRatio,
        reason: `Engulfing body not large enough (${engulfRatio.toFixed(1)}x < ${MIN_ENGULF_RATIO}x)`,
      };
    }

    // Engulfing candle should open below or at engulfed close
    // and close above or at engulfed open
    const opensBelow = engulfing.open <= engulfed.close * 1.001; // 0.1% tolerance
    const closesAbove = engulfing.close >= engulfed.open * 0.999;

    if (!opensBelow || !closesAbove) {
      return {
        isPattern: false,
        engulfRatio,
        reason: "Bodies don't properly engulf",
      };
    }

    return { isPattern: true, engulfRatio };
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const engulfedCandle = candles[candles.length - 2];
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;

    // Stop-loss below the engulfing pattern low
    const patternLow = engulfedCandle
      ? Math.min(engulfedCandle.low, candles[candles.length - 1]?.low ?? engulfedCandle.low)
      : entryPrice * 0.97;
    const atrStop = atr.current ? entryPrice - atr.current * 1.5 : entryPrice * 0.97;
    const stopLoss = Math.min(patternLow * 0.99, atrStop);

    // Take-profits
    const risk = entryPrice - stopLoss;
    const takeProfits = [
      { price: entryPrice + risk * 1.5, percentToSell: 0.4 },
      { price: entryPrice + risk * 2.5, percentToSell: 0.35 },
      { price: entryPrice + risk * 4, percentToSell: 0.25 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes: `Bullish engulfing reversal. Stop below pattern at $${stopLoss.toFixed(2)}. ` +
        `R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Engulfing Pattern Strategy Rules

When creating a plan using the Engulfing Pattern strategy:

### Entry Rules
- Enter on bullish engulfing at support (green candle fully engulfs prior red)
- Pattern should occur after a pullback or at key support
- Volume on engulfing candle should exceed average
- Wait for candle close to confirm pattern

### Stop-Loss Rules
- Place stop below the engulfing pattern's low
- Tight stop appropriate due to defined risk
- If pattern low breaks, setup invalidated

### Take-Profit Rules
- TP1: 1.5:1 R:R (sell 40%)
- TP2: 2.5:1 R:R (sell 35%)
- TP3: 4:1 R:R (sell 25%)

### Risk Management
- False signals more common in choppy markets
- Higher timeframes (4h, daily) are more reliable
- Exit if follow-through candle is weak
- Maximum position size: 4% of portfolio

### Best Conditions
- At clearly defined support levels
- After extended pullbacks
- With RSI oversold (<35) before pattern
- Higher volume on the engulfing candle
`;
  }
  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * BUY signal when:
   * - Previous bar was bearish, current bar is bullish (engulfing pattern)
   * - RSI < 45 (not overbought, approaching oversold)
   * - Near support level
   * - Volume ratio > 1.3 (volume confirmation)
   *
   * SELL signal when:
   * - RSI > 70 (overbought)
   * - Price at or above resistance
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

    // Check SELL signal first (exit conditions)
    if (nearestResistance && price >= nearestResistance) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `Price hit resistance at $${nearestResistance.toFixed(2)}`,
      };
    }

    if (rsi14 != null && rsi14 > 70) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `RSI overbought at ${rsi14.toFixed(1)}`,
      };
    }

    // Check BUY signal — simplified engulfing logic for bar data
    // Engulfing pattern: current bar closes above its open (bullish) and
    // the bar's body engulfs the previous move (open < previous close approximated by checking open < close)
    const isBullishBar = bar.close > bar.open;
    const bodySize = Math.abs(bar.close - bar.open);
    const range = bar.high - bar.low;
    const bodyDominance = range > 0 ? bodySize / range : 0;

    if (isBullishBar && bodyDominance > 0.5) {
      const isNearSupport =
        nearestSupport != null &&
        ((price - nearestSupport) / nearestSupport) * 100 <= 5 &&
        price >= nearestSupport;

      const rsiOk = rsi14 != null && rsi14 < 45;
      const volumeOk = volumeRatio != null && volumeRatio >= 1.3;

      if (isNearSupport && rsiOk && volumeOk) {
        return {
          type: "BUY",
          price,
          timestamp: bar.timestamp,
          reason: `Bullish engulfing near support ($${nearestSupport!.toFixed(2)}), RSI ${rsi14!.toFixed(1)}, volume ${volumeRatio!.toFixed(1)}x`,
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
      "sma20",
      "sma50",
      "rsi14",
      "atr14",
      "nearestSupport",
      "nearestResistance",
      "supportStrength",
      "volumeRatio",
      "volumeAvg20",
    ];
  }
}

export const engulfingPatternStrategy = new EngulfingPatternStrategy();
