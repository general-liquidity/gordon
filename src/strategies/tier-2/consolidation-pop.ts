/**
 * Consolidation Pop Strategy
 *
 * An intermediate strategy that identifies breakouts from tight
 * consolidation ranges (Bollinger squeeze or low ATR periods).
 *
 * Entry Conditions:
 * - Bollinger Band width at 6-month low (squeeze)
 * - Price breaks above the consolidation range
 * - Volume confirmation on breakout
 * - Direction bias from EMA alignment
 *
 * Confidence Boosters:
 * - Volume 2x+ average on breakout (+15%)
 * - Breaking resistance level (+10%)
 * - Multiple squeeze periods (+10%)
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

/** Bandwidth percentile for squeeze detection */
const SQUEEZE_PERCENTILE = 20; // Lowest 20% of bandwidth

/** Minimum consolidation periods */
const _MIN_CONSOLIDATION_CANDLES = 5;

/** Volume ratio for breakout confirmation */
const BREAKOUT_VOLUME_RATIO = 1.5;

// ============================================================================
// Consolidation Pop Strategy
// ============================================================================

export class ConsolidationPopStrategy extends BaseStrategy {
  readonly id: StrategyId = "consolidation_pop";
  readonly name = "Consolidation Pop";
  readonly tier = 2 as const;
  readonly description =
    "Trade breakouts from tight consolidation ranges (Bollinger squeeze). " +
    "Low volatility periods often precede explosive moves.";
  readonly indicators = ["Bollinger Bands", "ATR", "Volume", "EMA"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < 50) {
      return this.notDetected("Insufficient data (need 50+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate Bollinger Bands and check for squeeze
    const bb = this.calculateBollingerBands(candles);
    if (!bb.current.bandwidth) {
      return this.notDetected("Could not calculate Bollinger Bands");
    }

    // Check if bandwidth is in squeeze (historically low)
    const bandwidthHistory = bb.bandwidth.filter((b): b is number => b !== null);
    const isSqueezing = this.isInSqueeze(bb.current.bandwidth, bandwidthHistory);

    if (!isSqueezing && !bb.squeeze) {
      return this.notDetected("Not in squeeze (volatility not compressed)");
    }

    // Check for breakout above upper band or recent high
    const lastCandle = candles[candles.length - 1];
    const recentHigh = Math.max(...candles.slice(-20).map((c) => c.high));

    const isBreakingOut =
      lastCandle &&
      lastCandle.close > lastCandle.open && // Bullish
      (currentPrice > recentHigh * 0.99 || // Near/above recent high
        (bb.current.upper && currentPrice > bb.current.upper)); // Breaking upper band

    if (!isBreakingOut) {
      return this.notDetected("No breakout detected (still consolidating)");
    }

    // Volume confirmation
    const volumeRatio = this.getVolumeRatio(candles);
    if (volumeRatio < BREAKOUT_VOLUME_RATIO) {
      return this.notDetected(
        `Insufficient volume on breakout (${volumeRatio.toFixed(1)}x < ${BREAKOUT_VOLUME_RATIO}x)`,
      );
    }

    // Calculate confidence
    let confidence = 0.5;

    // Strong volume bonus
    if (volumeRatio >= 2.0) {
      confidence += 0.15;
    } else {
      confidence += (volumeRatio - BREAKOUT_VOLUME_RATIO) * 0.1;
    }

    // Squeeze depth bonus (tighter squeeze = bigger potential move)
    const squeezeRank = this.getSqueezeRank(bb.current.bandwidth, bandwidthHistory);
    if (squeezeRank <= 10) {
      confidence += 0.1; // Very tight squeeze
    }

    // EMA alignment bonus
    const ema20 = this.calculateEMA(candles, 20);
    const ema50 = this.calculateEMA(candles, 50);
    if (ema20.current && ema50.current && ema20.current > ema50.current) {
      confidence += 0.1; // Bullish EMA alignment
    }

    // Breaking resistance bonus
    const levels = this.detectLevels(candles, currentPrice);
    const resistances = this.getResistances(levels, currentPrice);
    const breakingResistance = resistances.some(
      (r) => Math.abs(currentPrice - r.price) / r.price < 0.01,
    );
    if (breakingResistance) {
      confidence += 0.1;
    }

    const signals = {
      bandwidth: bb.current.bandwidth,
      squeezeRank,
      isSqueezing,
      volumeRatio,
      recentHigh,
      breakingResistance,
      emaAligned: ema20.current && ema50.current ? ema20.current > ema50.current : false,
    };

    const reasons: string[] = [];
    reasons.push(`Bollinger squeeze (rank ${squeezeRank}% tightest)`);
    reasons.push(`Breakout with ${volumeRatio.toFixed(1)}x volume`);
    if (breakingResistance) {
      reasons.push("Breaking resistance level");
    }
    reasons.push(`Bandwidth: ${(bb.current.bandwidth * 100).toFixed(2)}%`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Check if current bandwidth is in squeeze (historically low)
   */
  private isInSqueeze(current: number, history: number[]): boolean {
    if (history.length < 20) return false;
    const sorted = [...history].sort((a, b) => a - b);
    const percentileIndex = Math.floor(history.length * (SQUEEZE_PERCENTILE / 100));
    const threshold = sorted[percentileIndex] ?? 0;
    return current <= threshold;
  }

  /**
   * Get percentile rank of current squeeze (0 = tightest ever)
   */
  private getSqueezeRank(current: number, history: number[]): number {
    if (history.length === 0) return 50;
    const below = history.filter((b) => b < current).length;
    return Math.round((below / history.length) * 100);
  }

  /**
   * Get volume ratio (current vs average)
   */
  private getVolumeRatio(candles: { volume: number }[]): number {
    const lastVolume = candles[candles.length - 1]?.volume ?? 0;
    const avgVolume = candles.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / 20;
    return avgVolume > 0 ? lastVolume / avgVolume : 0;
  }

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const bb = this.calculateBollingerBands(candles);
    const _atr = this.calculateATR(candles);

    const entryPrice = currentPrice;

    // Stop-loss below consolidation low or middle band
    const consolidationLow = Math.min(...candles.slice(-10).map((c) => c.low));
    const middleBandStop = bb.current.middle ? bb.current.middle * 0.99 : entryPrice * 0.95;
    const stopLoss = Math.max(consolidationLow * 0.99, middleBandStop);

    // Take-profits: volatility expansion targets
    const risk = entryPrice - stopLoss;
    const takeProfits = [
      { price: entryPrice + risk * 2, percentToSell: 0.3 },
      { price: entryPrice + risk * 4, percentToSell: 0.4 },
      { price: entryPrice + risk * 6, percentToSell: 0.3 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Consolidation breakout. Stop below range at $${stopLoss.toFixed(2)}. ` +
        `Volatility expansion expected. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Consolidation Pop Strategy Rules

When creating a plan using the Consolidation Pop strategy:

### Entry Rules
- Enter when price breaks out of a tight consolidation (Bollinger squeeze)
- Breakout candle should have 1.5x+ average volume
- Prefer bullish EMA alignment (EMA20 > EMA50)
- Wait for candle close to confirm breakout

### Stop-Loss Rules
- Place stop below the consolidation range low
- Alternative: below middle Bollinger Band
- Tight stops are appropriate due to defined range

### Take-Profit Rules
- TP1: 2:1 R:R (sell 30%)
- TP2: 4:1 R:R (sell 40%)
- TP3: 6:1 R:R or trail (sell 30%)
- Volatility expansion can produce large moves

### Risk Management
- False breakouts are common - wait for volume confirmation
- If price re-enters the range, exit immediately
- Maximum position size: 4% of portfolio

### Best Conditions
- After extended periods of low volatility
- When market has been ranging for days/weeks
- With clear support/resistance defining the range
`;
  }

  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * BUY signal when:
   * - Bollinger Band width is narrow (squeeze: bbWidth < 0.04)
   * - Price breaks above upper BB
   * - Bullish candle (close > open)
   * - Volume ratio >= 1.5x average
   * - EMA alignment: sma20 > sma50 (bullish structure)
   *
   * SELL signal when:
   * - Price drops back below middle BB (breakout failed)
   * - RSI > 75 (overbought after pop)
   */
  override generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    const price = bar.close;
    const { rsi14, bbUpper, bbMiddle, bbWidth, sma20, sma50, volumeRatio } = indicators;

    // SELL signals (exit conditions)
    if (bbMiddle != null && price < bbMiddle) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: "Price dropped below middle BB — breakout failed",
      };
    }

    if (rsi14 != null && rsi14 > 75) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `RSI overbought at ${rsi14.toFixed(1)} after pop`,
      };
    }

    // BUY signals (entry conditions)
    const isBullish = bar.close > bar.open;
    const isSqueeze = bbWidth != null && bbWidth < 0.04; // Tight squeeze
    const breakingUpperBB = bbUpper != null && price > bbUpper;
    const hasVolume = volumeRatio != null && volumeRatio >= BREAKOUT_VOLUME_RATIO;
    const emaAligned = sma20 != null && sma50 != null ? sma20 > sma50 : true; // default ok if missing

    if (isBullish && isSqueeze && breakingUpperBB && hasVolume && emaAligned) {
      const reasons: string[] = [];
      reasons.push(`BB squeeze (width ${(bbWidth! * 100).toFixed(2)}%)`);
      reasons.push(`breakout above upper BB ($${bbUpper!.toFixed(2)})`);
      reasons.push(`volume ${volumeRatio!.toFixed(1)}x avg`);
      return {
        type: "BUY",
        price,
        timestamp: bar.timestamp,
        reason: reasons.join(", "),
      };
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
      "bbUpper",
      "bbMiddle",
      "bbLower",
      "bbWidth",
      "volumeRatio",
      "volumeAvg20",
    ];
  }
}

export const consolidationPopStrategy = new ConsolidationPopStrategy();
