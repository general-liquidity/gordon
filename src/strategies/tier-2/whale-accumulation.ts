/**
 * Whale Accumulation Strategy
 *
 * Detects institutional/whale accumulation patterns: unusually high volume
 * within a tight price range (absorption), with buying pressure dominant.
 *
 * Entry Conditions:
 * - Volume in top 5% (massive volume)
 * - Tight price range (< 1.5x ATR for the candle body)
 * - FlowScope shows buying pressure > 60%
 * - ADX low (< 25) or flat — accumulation happens in ranges
 *
 * Confidence Boosters:
 * - Delta Ladder confirms net buying (+10%)
 * - Multiple consecutive absorption candles (+15%)
 * - Price near support level (+10%)
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
import {
  calculateFlowScope,
  calculateDeltaLadder,
} from "../../core/indicators/index.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

const VOLUME_PERCENTILE = 0.95;
const BUY_PRESSURE_MIN = 0.6;
const ADX_MAX = 25;
const CANDLE_LIMIT = 100;

// ============================================================================
// Whale Accumulation Strategy
// ============================================================================

export class WhaleAccumulationStrategy extends BaseStrategy {
  readonly id: StrategyId = "whale_accumulation";
  readonly name = "Whale Accumulation";
  readonly tier = 2 as const;
  readonly description =
    "Detects institutional accumulation patterns: massive volume within " +
    "tight ranges with dominant buying pressure. Precedes major breakouts.";
  readonly indicators = ["FlowScope", "Delta Ladder", "ADX", "ATR", "Volume"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < 30) {
      return this.notDetected("Insufficient data (need 30+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Check volume percentile
    const volumes = candles.map((c) => c.volume);
    const sortedVolumes = [...volumes].sort((a, b) => a - b);
    const percentileIdx = Math.floor(sortedVolumes.length * VOLUME_PERCENTILE);
    const volumeThreshold = sortedVolumes[percentileIdx]!;

    // Check recent candles for absorption
    const recentCandles = candles.slice(-5);
    const absorptionCandles = recentCandles.filter((c) => c.volume >= volumeThreshold);

    if (absorptionCandles.length === 0) {
      return this.notDetected(
        `No recent candles with volume in top 5% (threshold: ${volumeThreshold.toFixed(0)})`
      );
    }

    // Check price range tightness
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.02;
    const lastCandle = candles[candles.length - 1]!;
    const bodyRange = Math.abs(lastCandle.close - lastCandle.open);
    const isTight = bodyRange < atrVal * 1.5;

    if (!isTight && absorptionCandles.length < 2) {
      return this.notDetected(
        `Price range not tight enough (body: ${bodyRange.toFixed(2)}, threshold: ${(atrVal * 1.5).toFixed(2)})`
      );
    }

    // FlowScope for buying pressure
    const flowScope = calculateFlowScope(candles);
    const buyingPressure = flowScope.overallBuyRatio;

    if (buyingPressure < BUY_PRESSURE_MIN) {
      return this.notDetected(
        `Buying pressure too low: ${(buyingPressure * 100).toFixed(1)}% (need > ${BUY_PRESSURE_MIN * 100}%)`
      );
    }

    // ADX check — accumulation happens in low-ADX environments
    const adxResult = this.calculateADXSimple(candles);

    // Build confidence
    let confidence = 0.5;

    // Volume absorption
    confidence += absorptionCandles.length * 0.05;

    // Strong buying pressure
    if (buyingPressure > 0.7) confidence += 0.1;

    // Tight range with volume = classic absorption
    if (isTight) confidence += 0.1;

    // Low ADX (ranging market = accumulation zone)
    if (adxResult.adx !== null && adxResult.adx < ADX_MAX) {
      confidence += 0.1;
    }

    // Delta Ladder confirmation
    const deltaLadder = calculateDeltaLadder(candles);
    if (deltaLadder.trend === "buying_pressure") {
      confidence += 0.1;
    }

    // Support proximity
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);
    const nearSupport = supports.length > 0 &&
      Math.abs(supports[0]!.price - currentPrice) / currentPrice < 0.02;
    if (nearSupport) confidence += 0.1;

    const signals = {
      absorptionCandles: absorptionCandles.length,
      volumeThreshold,
      lastCandleVolume: lastCandle.volume,
      bodyRange,
      atr: atrVal,
      isTightRange: isTight,
      buyingPressure: buyingPressure * 100,
      flowBias: flowScope.imbalanceDirection,
      adx: adxResult.adx,
      deltaLadderTrend: deltaLadder.trend,
      deltaLadderSignal: deltaLadder.signal,
      nearSupport,
    };

    const reasons: string[] = [];
    reasons.push(`${absorptionCandles.length} absorption candle(s) — volume in top 5%`);
    reasons.push(`Buying pressure: ${(buyingPressure * 100).toFixed(1)}% (${flowScope.imbalanceDirection})`);
    if (isTight) reasons.push("Tight price range = volume absorption");
    if (adxResult.adx !== null) reasons.push(`ADX: ${adxResult.adx.toFixed(1)} (${adxResult.adx < ADX_MAX ? "low — ranging" : "trending"})`);
    if (deltaLadder.trend === "buying_pressure") reasons.push("Delta Ladder confirms net buying");
    if (nearSupport) reasons.push("Price near support level");

    return this.detected(confidence, signals, reasons.join(". "));
  }

  private calculateADXSimple(candles: Candle[]): {
    adx: number | null;
    adxTrend: "rising" | "falling" | "flat";
  } {
    if (candles.length < 28) return { adx: null, adxTrend: "flat" };

    const period = 14;
    const trueRanges: number[] = [];
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];

    for (let i = 1; i < candles.length; i++) {
      const current = candles[i]!;
      const previous = candles[i - 1]!;

      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      trueRanges.push(tr);

      const upMove = current.high - previous.high;
      const downMove = previous.low - current.low;
      plusDMs.push(upMove > downMove && upMove > 0 ? upMove : 0);
      minusDMs.push(downMove > upMove && downMove > 0 ? downMove : 0);
    }

    const smoothTR = this.wilderSmooth(trueRanges, period);
    const smoothPlusDM = this.wilderSmooth(plusDMs, period);
    const smoothMinusDM = this.wilderSmooth(minusDMs, period);

    if (smoothTR.length === 0) return { adx: null, adxTrend: "flat" };

    const dxValues: number[] = [];
    for (let i = 0; i < smoothTR.length; i++) {
      const pdi = (smoothPlusDM[i]! / smoothTR[i]!) * 100;
      const mdi = (smoothMinusDM[i]! / smoothTR[i]!) * 100;
      const dx = Math.abs(pdi - mdi) / (pdi + mdi) * 100;
      if (!isNaN(dx)) dxValues.push(dx);
    }

    const adxValues = this.wilderSmooth(dxValues, period);
    const adx = adxValues[adxValues.length - 1] ?? null;

    let adxTrend: "rising" | "falling" | "flat" = "flat";
    if (adxValues.length >= 3) {
      const recent = adxValues.slice(-3);
      if (recent[2]! > recent[0]! * 1.05) adxTrend = "rising";
      else if (recent[2]! < recent[0]! * 0.95) adxTrend = "falling";
    }

    return { adx, adxTrend };
  }

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

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;
    const atrVal = atr.current ?? currentPrice * 0.02;

    // Stop below accumulation range
    const recentLows = candles.slice(-10).map((c) => c.low);
    const rangeLow = Math.min(...recentLows);
    const stopLoss = Math.min(rangeLow * 0.99, entryPrice - atrVal * 2);

    // Accumulation precedes breakouts — target generously
    const risk = entryPrice - stopLoss;
    const takeProfits: TakeProfitLevel[] = [
      { price: entryPrice + risk * 2, percentToSell: 0.25 },
      { price: entryPrice + risk * 4, percentToSell: 0.35 },
      { price: entryPrice + risk * 7, percentToSell: 0.4 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Whale accumulation trade. Institutional volume absorbed in tight range. ` +
        `Stop below range at $${stopLoss.toFixed(2)}. Breakout target generous — whales accumulate before big moves. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Whale Accumulation Strategy Rules

When creating a plan using the Whale Accumulation strategy:

### Entry Rules
- Volume must be in the top 5% (unusual institutional activity)
- Price range should be tight (body < 1.5x ATR)
- Buying pressure > 60% from FlowScope
- ADX < 25 preferred (accumulation happens in ranges)
- Best when Delta Ladder confirms net buying

### Stop-Loss Rules
- Place stop below the accumulation range low
- Alternative: 2x ATR below entry
- Accumulation ranges should hold — if broken, thesis is wrong

### Take-Profit Rules
- TP1: 2:1 R:R (sell 25%) — initial confirmation
- TP2: 4:1 R:R (sell 35%) — breakout target
- TP3: 7:1 R:R or trail (sell 40%) — full whale move
- Accumulation precedes large moves — let winners run

### Risk Management
- Maximum position size: 4% of portfolio
- Accumulation can take time — be patient
- Exit if buying pressure drops below 50% on FlowScope
- Exit if volume dries up (no follow-through)
- Watch for distribution signals (high volume + price dropping)
`;
  }

  override getRequiredIndicators(): string[] {
    return ["sma20", "rsi14", "atr14", "volumeAvg20", "volumeRatio"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    if (index < 20) return null;

    const volumeRatio = indicators.volumeRatio;
    const atr = indicators.atr14;

    if (volumeRatio == null || atr == null) return null;

    // High volume + tight range
    const bodyRange = Math.abs(bar.close - bar.open);
    if (volumeRatio > 2.0 && bodyRange < atr * 1.5 && bar.close > bar.open) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: `Whale accumulation: volume ${volumeRatio.toFixed(1)}x avg, tight body ${bodyRange.toFixed(2)} < ${(atr * 1.5).toFixed(2)} ATR, bullish close`,
      };
    }

    return null;
  }
}

export const whaleAccumulationStrategy = new WhaleAccumulationStrategy();
