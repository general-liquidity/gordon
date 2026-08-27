/**
 * ADX Trend Strength Strategy
 *
 * An intermediate strategy that only trades when ADX confirms a
 * strong trend, using +DI/-DI for direction.
 *
 * Entry Conditions:
 * - ADX > 25 (strong trend)
 * - +DI > -DI (bullish trend)
 * - Price above EMA 20
 * - Pullback to EMA 20 for entry
 *
 * Confidence Boosters:
 * - ADX > 40 (very strong trend) (+15%)
 * - Rising ADX (+10%)
 * - RSI 40-60 (healthy pullback) (+10%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
  TakeProfitLevel,
} from "../types.ts";
import type { Candle } from "../../core/indicators/types.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

/** Minimum ADX for trend confirmation */
const ADX_THRESHOLD = 25;

/** Strong trend threshold */
const ADX_STRONG = 40;

/** EMA period for trend direction */
const TREND_EMA = 20;

/** Pullback threshold to EMA (percentage) */
const PULLBACK_THRESHOLD = 0.02;

// ============================================================================
// ADX Trend Strategy
// ============================================================================

export class ADXTrendStrategy extends BaseStrategy {
  readonly id: StrategyId = "adx_trend";
  readonly name = "ADX Trend Strength";
  readonly tier = 2 as const;
  readonly description =
    "Trade only when ADX confirms a strong trend (>25). " +
    "Uses +DI/-DI for direction and waits for pullbacks to EMA.";
  readonly indicators = ["ADX", "+DI/-DI", "EMA 20", "RSI"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < 30) {
      return this.notDetected("Insufficient data (need 30+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate ADX and directional indicators
    const adxResult = this.calculateADX(candles);
    if (!adxResult.adx || !adxResult.plusDI || !adxResult.minusDI) {
      return this.notDetected("Could not calculate ADX");
    }

    const { adx, plusDI, minusDI, adxTrend } = adxResult;

    // Check ADX strength
    if (adx < ADX_THRESHOLD) {
      return this.notDetected(
        `ADX too low (${adx.toFixed(1)} < ${ADX_THRESHOLD}) - no strong trend`,
      );
    }

    // Check trend direction (+DI > -DI for bullish)
    if (plusDI <= minusDI) {
      return this.notDetected(
        `Bearish trend (+DI ${plusDI.toFixed(1)} <= -DI ${minusDI.toFixed(1)})`,
      );
    }

    // Check EMA for trend and pullback
    const ema20 = this.calculateEMA(candles, TREND_EMA);
    if (!ema20.current) {
      return this.notDetected("Could not calculate EMA");
    }

    // Price should be at or pulling back to EMA
    const distanceToEMA = (currentPrice - ema20.current) / ema20.current;

    if (distanceToEMA < -PULLBACK_THRESHOLD) {
      return this.notDetected(`Price too far below EMA20 (${(distanceToEMA * 100).toFixed(1)}%)`);
    }

    // Ideal entry is pullback to EMA (not too far above either)
    const isPullbackEntry =
      distanceToEMA >= -PULLBACK_THRESHOLD && distanceToEMA <= PULLBACK_THRESHOLD;

    if (distanceToEMA > PULLBACK_THRESHOLD * 3) {
      return this.notDetected(
        `Price extended above EMA20 (${(distanceToEMA * 100).toFixed(1)}%) - wait for pullback`,
      );
    }

    // Calculate confidence
    let confidence = 0.5;

    // ADX strength bonus
    if (adx >= ADX_STRONG) {
      confidence += 0.15;
    } else {
      confidence += ((adx - ADX_THRESHOLD) / (ADX_STRONG - ADX_THRESHOLD)) * 0.1;
    }

    // Rising ADX bonus
    if (adxTrend === "rising") {
      confidence += 0.1;
    }

    // Pullback entry bonus
    if (isPullbackEntry) {
      confidence += 0.1;
    }

    // RSI healthy range bonus
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null && rsi.current >= 40 && rsi.current <= 60) {
      confidence += 0.1;
    }

    // DI spread bonus (strong directional movement)
    const diSpread = plusDI - minusDI;
    if (diSpread > 15) {
      confidence += 0.05;
    }

    const signals = {
      adx,
      plusDI,
      minusDI,
      diSpread,
      adxTrend,
      ema20: ema20.current,
      distanceToEMA: distanceToEMA * 100,
      isPullbackEntry,
      rsi: rsi.current,
    };

    const reasons: string[] = [];
    reasons.push(`ADX: ${adx.toFixed(1)} (${adx >= ADX_STRONG ? "very strong" : "strong"} trend)`);
    reasons.push(`+DI: ${plusDI.toFixed(1)} > -DI: ${minusDI.toFixed(1)} (bullish)`);
    if (isPullbackEntry) {
      reasons.push("Pullback to EMA20 (ideal entry)");
    }
    reasons.push(`ADX ${adxTrend}`);
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Calculate ADX with +DI and -DI
   * Simplified implementation using ATR as base
   */
  private calculateADX(candles: Candle[]): {
    adx: number | null;
    plusDI: number | null;
    minusDI: number | null;
    adxTrend: "rising" | "falling" | "flat";
  } {
    if (candles.length < 28) {
      return { adx: null, plusDI: null, minusDI: null, adxTrend: "flat" };
    }

    const period = 14;
    const smoothingPeriod = 14;

    // Calculate True Range and Directional Movement
    const trueRanges: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i]!;
      const previous = candles[i - 1]!;

      // True Range
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close),
      );
      trueRanges.push(tr);

      // Directional Movement
      const upMove = current.high - previous.high;
      const downMove = previous.low - current.low;

      const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
      const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

      plusDMs.push(plusDM);
      minusDMs.push(minusDM);
    }

    // Smooth the values using Wilder's smoothing
    const smoothTR = this.wilderSmooth(trueRanges, period);
    const smoothPlusDM = this.wilderSmooth(plusDMs, period);
    const smoothMinusDM = this.wilderSmooth(minusDMs, period);

    if (smoothTR.length === 0) {
      return { adx: null, plusDI: null, minusDI: null, adxTrend: "flat" };
    }

    // Calculate DI values
    const plusDI = (smoothPlusDM[smoothPlusDM.length - 1]! / smoothTR[smoothTR.length - 1]!) * 100;
    const minusDI =
      (smoothMinusDM[smoothMinusDM.length - 1]! / smoothTR[smoothTR.length - 1]!) * 100;

    // Calculate DX values
    const dxValues: number[] = [];
    for (let i = 0; i < smoothTR.length; i++) {
      const pdi = (smoothPlusDM[i]! / smoothTR[i]!) * 100;
      const mdi = (smoothMinusDM[i]! / smoothTR[i]!) * 100;
      const dx = (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
      if (!Number.isNaN(dx)) dxValues.push(dx);
    }

    // Smooth DX to get ADX
    const adxValues = this.wilderSmooth(dxValues, smoothingPeriod);
    const adx = adxValues[adxValues.length - 1] ?? null;

    // Determine ADX trend
    let adxTrend: "rising" | "falling" | "flat" = "flat";
    if (adxValues.length >= 3) {
      const recent = adxValues.slice(-3);
      if (recent[2]! > recent[0]! * 1.05) {
        adxTrend = "rising";
      } else if (recent[2]! < recent[0]! * 0.95) {
        adxTrend = "falling";
      }
    }

    return { adx, plusDI, minusDI, adxTrend };
  }

  /**
   * Wilder's smoothing method
   */
  private wilderSmooth(values: number[], period: number): number[] {
    if (values.length < period) return [];

    const result: number[] = [];
    let smooth = values.slice(0, period).reduce((a, b) => a + b, 0);
    result.push(smooth);

    for (let i = period; i < values.length; i++) {
      smooth = smooth - smooth / period + values[i]!;
      result.push(smooth);
    }

    return result;
  }

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const ema20 = this.calculateEMA(candles, 20);
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;

    // Stop-loss below EMA or 1.5 ATR
    const emaStop = ema20.current ? ema20.current * 0.97 : entryPrice * 0.95;
    const atrStop = atr.current ? entryPrice - atr.current * 1.5 : entryPrice * 0.95;
    const stopLoss = Math.max(emaStop, atrStop);

    // Take-profits: trend-following style
    const risk = entryPrice - stopLoss;
    const takeProfits: TakeProfitLevel[] = [
      { price: entryPrice + risk * 2, percentToSell: 0.25 },
      { price: entryPrice + risk * 4, percentToSell: 0.35 },
      { price: entryPrice + risk * 6, percentToSell: 0.4 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `ADX trend trade. Strong trend confirmed. ` +
        `Stop below EMA20 at $${stopLoss.toFixed(2)}. Trail stops as trend develops. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## ADX Trend Strength Strategy Rules

When creating a plan using the ADX Trend Strength strategy:

### Entry Rules
- Only enter when ADX > 25 (strong trend confirmed)
- +DI must be above -DI (bullish direction)
- Ideal entry: pullback to EMA 20 with ADX still strong
- Avoid if ADX is falling (trend weakening)

### Stop-Loss Rules
- Place stop below EMA 20 or recent swing low
- Alternative: 1.5x ATR below entry
- Trail stop along EMA 20 as trend progresses

### Take-Profit Rules
- TP1: 2:1 R:R (sell 25%)
- TP2: 4:1 R:R (sell 35%)
- TP3: 6:1 R:R or trail (sell 40%)
- Let winners run - this is a trend strategy

### Risk Management
- Best in clearly trending markets
- Exit if ADX drops below 20 (trend dying)
- Exit if -DI crosses above +DI
- Maximum position size: 4% of portfolio

### Best Conditions
- Sustained trends after breakouts
- Higher timeframes for reliability
- When ADX is rising (trend strengthening)
`;
  }

  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * Uses sma20 as proxy for EMA20 (available in IndicatorState),
   * and custom adx/plusDI/minusDI indicators via index signature.
   *
   * BUY signal when:
   * - ADX > 25 (strong trend)
   * - +DI > -DI (bullish direction)
   * - Price near SMA20 (pullback entry)
   * - RSI in healthy range (40-60)
   *
   * SELL signal when:
   * - Price drops below SMA20 (trend break)
   * - RSI > 70 (overbought, take profits)
   * - ADX drops below 20 (trend dying)
   */
  override generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    const price = bar.close;
    const { rsi14, sma20, sma50 } = indicators;
    const adx = indicators.adx as number | null | undefined;
    const plusDI = indicators.plusDI as number | null | undefined;
    const minusDI = indicators.minusDI as number | null | undefined;

    // SELL signals (exit conditions)
    if (sma20 != null && price < sma20) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: "Price broke below SMA20 — trend break",
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

    if (adx != null && adx < 20) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `ADX dropped to ${adx.toFixed(1)} — trend dying`,
      };
    }

    // BUY signals (entry conditions)
    // If ADX indicators are available, use full ADX logic
    if (adx != null && plusDI != null && minusDI != null) {
      const strongTrend = adx >= ADX_THRESHOLD;
      const bullishDirection = plusDI > minusDI;
      const rsiHealthy = rsi14 == null || (rsi14 >= 40 && rsi14 <= 60);

      // Pullback to SMA20 — price within 2% of SMA20
      const nearSMA20 =
        sma20 != null ? Math.abs(price - sma20) / sma20 <= PULLBACK_THRESHOLD : false;

      if (strongTrend && bullishDirection && nearSMA20 && rsiHealthy) {
        return {
          type: "BUY",
          price,
          timestamp: bar.timestamp,
          reason: `ADX trend: ADX ${adx.toFixed(1)}, +DI ${plusDI.toFixed(1)} > -DI ${minusDI.toFixed(1)}, pullback to SMA20`,
        };
      }
    } else {
      // Fallback: use SMA crossover + RSI as trend proxy
      const trendUp = sma20 != null && sma50 != null && sma20 > sma50;
      const nearSMA20 =
        sma20 != null ? Math.abs(price - sma20) / sma20 <= PULLBACK_THRESHOLD : false;
      const rsiHealthy = rsi14 != null && rsi14 >= 40 && rsi14 <= 60;

      if (trendUp && nearSMA20 && rsiHealthy) {
        return {
          type: "BUY",
          price,
          timestamp: bar.timestamp,
          reason: `Trend pullback: SMA20 > SMA50, price near SMA20, RSI ${rsi14!.toFixed(1)}`,
        };
      }
    }

    return null;
  }

  /**
   * Get required indicators for backtesting.
   */
  override getRequiredIndicators(): string[] {
    return ["sma20", "sma50", "rsi14", "atr14", "adx", "plusDI", "minusDI"];
  }
}

export const adxTrendStrategy = new ADXTrendStrategy();
