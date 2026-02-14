/**
 * Volume Surge Strategy
 *
 * A momentum strategy that identifies breakouts accompanied by
 * significant volume increases, indicating institutional interest.
 *
 * Entry Conditions:
 * - Volume 2x+ above 20-period average
 * - Price making new local high (breakout)
 * - Green candle (close > open)
 * - Not overbought (RSI < 75)
 *
 * Confidence Boosters:
 * - Volume 3x+ average (+15%)
 * - Breaking resistance level (+10%)
 * - Multiple consecutive high-volume candles (+10%)
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

/** Minimum volume ratio for valid signal */
const MIN_VOLUME_RATIO = 2.0;

/** High volume ratio for bonus confidence */
const HIGH_VOLUME_RATIO = 3.0;

/** RSI threshold (avoid overbought) */
const RSI_MAX = 75;

/** Lookback for local high detection */
const LOCAL_HIGH_LOOKBACK = 10;

// ============================================================================
// Volume Surge Strategy
// ============================================================================

export class VolumeSurgeStrategy extends BaseStrategy {
  readonly id: StrategyId = "volume_surge";
  readonly name = "Volume Surge";
  readonly tier = 1 as const;
  readonly description =
    "Buy breakouts with unusually high volume (2x+ average). " +
    "High volume confirms institutional interest and validates the move.";
  readonly indicators = ["Volume", "Volume MA", "RSI", "Price Action"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 50);
    if (candles.length < 25) {
      return this.notDetected("Insufficient data (need 25+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    const lastCandle = candles[candles.length - 1];
    if (!lastCandle || currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate volume metrics
    const volumeMA = this.calculateVolumeMA(candles, 20);
    const currentVolume = lastCandle.volume;
    const volumeRatio = volumeMA > 0 ? currentVolume / volumeMA : 0;

    if (volumeRatio < MIN_VOLUME_RATIO) {
      return this.notDetected(
        `Volume not surging (${volumeRatio.toFixed(1)}x < ${MIN_VOLUME_RATIO}x average)`
      );
    }

    // Check for bullish candle
    const isBullishCandle = lastCandle.close > lastCandle.open;
    if (!isBullishCandle) {
      return this.notDetected("Last candle is bearish (need bullish confirmation)");
    }

    // Check for local high (breakout)
    const isLocalHigh = this.isLocalHigh(candles, LOCAL_HIGH_LOOKBACK);
    if (!isLocalHigh) {
      return this.notDetected("Not making local high (no breakout)");
    }

    // Check RSI not overbought
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null && rsi.current > RSI_MAX) {
      return this.notDetected(
        `RSI overbought (${rsi.current.toFixed(1)} > ${RSI_MAX})`
      );
    }

    // Calculate confidence
    let confidence = 0.5;

    // Volume strength bonus
    if (volumeRatio >= HIGH_VOLUME_RATIO) {
      confidence += 0.15;
    } else {
      confidence += (volumeRatio - MIN_VOLUME_RATIO) * 0.1;
    }

    // Breaking resistance bonus
    const levels = this.detectLevels(candles, currentPrice);
    const resistances = this.getResistances(levels, currentPrice);
    const breakingResistance = resistances.some(
      (r) => lastCandle.open < r.price && lastCandle.close > r.price
    );
    if (breakingResistance) {
      confidence += 0.1;
    }

    // Consecutive high volume bonus
    const consecutiveHighVol = this.countConsecutiveHighVolume(
      candles,
      volumeMA,
      1.5
    );
    if (consecutiveHighVol >= 2) {
      confidence += 0.1;
    }

    // Candle body size bonus (strong conviction)
    const bodySize = Math.abs(lastCandle.close - lastCandle.open);
    const candleRange = lastCandle.high - lastCandle.low;
    const bodyRatio = candleRange > 0 ? bodySize / candleRange : 0;
    if (bodyRatio > 0.7) {
      confidence += 0.05; // Strong bullish body
    }

    const signals = {
      currentVolume,
      volumeMA,
      volumeRatio,
      isLocalHigh,
      breakingResistance,
      consecutiveHighVolume: consecutiveHighVol,
      candleBodyRatio: bodyRatio,
      rsi: rsi.current,
    };

    const reasons: string[] = [];
    reasons.push(`Volume surge: ${volumeRatio.toFixed(1)}x average`);
    reasons.push("Making local high (breakout)");
    if (breakingResistance) {
      reasons.push("Breaking resistance level");
    }
    if (consecutiveHighVol >= 2) {
      reasons.push(`${consecutiveHighVol} consecutive high-volume candles`);
    }
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Calculate volume moving average
   */
  private calculateVolumeMA(candles: { volume: number }[], period: number): number {
    if (candles.length < period) {
      return candles.reduce((sum, c) => sum + c.volume, 0) / candles.length;
    }
    const relevantCandles = candles.slice(-period - 1, -1); // Exclude current candle
    return relevantCandles.reduce((sum, c) => sum + c.volume, 0) / period;
  }

  /**
   * Check if current price is a local high
   */
  private isLocalHigh(
    candles: { high: number; close: number }[],
    lookback: number
  ): boolean {
    const lastCandle = candles[candles.length - 1];
    if (!lastCandle) return false;

    const currentHigh = lastCandle.high;
    const lookbackCandles = candles.slice(-lookback - 1, -1);

    return lookbackCandles.every((c) => c.high < currentHigh);
  }

  /**
   * Count consecutive high-volume candles
   */
  private countConsecutiveHighVolume(
    candles: { volume: number }[],
    volumeMA: number,
    threshold: number
  ): number {
    let count = 0;
    for (let i = candles.length - 1; i >= 0; i--) {
      const candle = candles[i];
      if (candle && candle.volume >= volumeMA * threshold) {
        count++;
      } else {
        break;
      }
    }
    return count;
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 50);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const lastCandle = candles[candles.length - 1];

    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;

    // Stop-loss below the surge candle's low or 1.5 ATR
    const candleLow = lastCandle?.low ?? entryPrice * 0.97;
    const atrStop = atr.current ? entryPrice - atr.current * 1.5 : entryPrice * 0.97;
    const stopLoss = Math.max(candleLow * 0.99, atrStop);

    // Take-profits: momentum-based, wider targets
    const risk = entryPrice - stopLoss;
    const takeProfits = [
      { price: entryPrice + risk * 1.5, percentToSell: 0.3 },
      { price: entryPrice + risk * 3, percentToSell: 0.4 },
      { price: entryPrice + risk * 5, percentToSell: 0.3 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes: `Volume breakout trade. Stop below surge candle at $${stopLoss.toFixed(2)}. ` +
        `High momentum expected. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Volume Surge Strategy Rules

When creating a plan using the Volume Surge strategy:

### Entry Rules
- Enter when volume is 2x+ the 20-period average
- Must be making a local high (breakout)
- Candle must be bullish (green)
- RSI should be below 75

### Stop-Loss Rules
- Place stop below the surge candle's low
- Alternative: 1.5x ATR below entry
- Tight stops work well due to momentum

### Take-Profit Rules
- TP1: 1.5:1 R:R (sell 30%) - quick profits
- TP2: 3:1 R:R (sell 40%) - let momentum play
- TP3: 5:1 R:R or trail (sell 30%)

### Risk Management
- Volume surges can be volatile - size conservatively
- If volume dies quickly, exit early
- Maximum position size: 3-5% of portfolio

### Best Conditions
- Major news or catalyst days
- Breakouts from consolidation
- Early trend continuation after pullbacks
- Avoid during low-liquidity hours
`;
  }

  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * BUY signal when:
   * - Volume ratio >= 2x average
   * - Bullish candle (close > open)
   * - RSI < 75 (not overbought)
   * - Price breaking above resistance or SMA
   *
   * SELL signal when:
   * - RSI > 75 (overbought)
   * - Price drops below SMA20
   */
  override generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    const price = bar.close;
    const { rsi14, volumeRatio, sma20, nearestResistance } = indicators;

    // SELL signals (exit conditions)
    if (rsi14 != null && rsi14 > RSI_MAX) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `RSI overbought at ${rsi14.toFixed(1)} (>${RSI_MAX})`,
      };
    }

    if (sma20 != null && price < sma20) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: "Price dropped below SMA20 — momentum lost",
      };
    }

    // BUY signals (entry conditions)
    const isBullishCandle = bar.close > bar.open;
    const hasVolumeSurge = volumeRatio != null && volumeRatio >= MIN_VOLUME_RATIO;
    const rsiOk = rsi14 == null || rsi14 < RSI_MAX;

    if (isBullishCandle && hasVolumeSurge && rsiOk) {
      // Extra confirmation: breaking resistance or above SMA20
      const breakingResistance = nearestResistance != null && price >= nearestResistance;
      const aboveSMA = sma20 != null && price > sma20;

      if (breakingResistance || aboveSMA) {
        const reasons: string[] = [];
        reasons.push(`Volume surge ${volumeRatio!.toFixed(1)}x average`);
        if (breakingResistance) reasons.push("breaking resistance");
        if (rsi14 != null) reasons.push(`RSI ${rsi14.toFixed(1)}`);
        return {
          type: "BUY",
          price,
          timestamp: bar.timestamp,
          reason: reasons.join(", "),
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
      "rsi14",
      "atr14",
      "volumeRatio",
      "volumeAvg20",
      "nearestResistance",
    ];
  }
}

export const volumeSurgeStrategy = new VolumeSurgeStrategy();
