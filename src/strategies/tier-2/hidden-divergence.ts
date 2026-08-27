/**
 * Hidden Divergence Strategy
 *
 * Detects hidden divergences — continuation signals where price makes a
 * higher low but an oscillator makes a lower low (bullish hidden div),
 * indicating the underlying trend is still intact.
 *
 * Entry Conditions:
 * - Hidden bullish divergence: price higher low + RSI lower low
 * - Confirmed by VPT trend direction
 * - Price above major EMA (trend filter)
 *
 * Confidence Boosters:
 * - VPT confirms bullish trend (+10%)
 * - Volume supporting the move (+10%)
 * - Multiple oscillator hidden divergence (+15%)
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
import { calculateVPT, calculateDivergence } from "../../core/indicators/index.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

const TREND_EMA_PERIOD = 50;
const SWING_LOOKBACK = 10;
const CANDLE_LIMIT = 150;

// ============================================================================
// Hidden Divergence Strategy
// ============================================================================

export class HiddenDivergenceStrategy extends BaseStrategy {
  readonly id: StrategyId = "hidden_divergence";
  readonly name = "Hidden Divergence";
  readonly tier = 2 as const;
  readonly description =
    "Trades trend continuation signals from hidden divergences — " +
    "price makes higher low while RSI makes lower low, confirming the trend.";
  readonly indicators = ["RSI", "Divergence", "VPT", "EMA 50"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < 50) {
      return this.notDetected("Insufficient data (need 50+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Trend filter: price must be above EMA 50
    const ema50 = this.calculateEMA(candles, TREND_EMA_PERIOD);
    if (!ema50.current || currentPrice < ema50.current) {
      return this.notDetected(
        `Price $${currentPrice.toFixed(2)} below EMA50 $${ema50.current?.toFixed(2) ?? "N/A"} — need uptrend for bullish hidden divergence`,
      );
    }

    // Detect hidden divergence via swing analysis
    const hiddenDiv = this.detectHiddenBullishDivergence(candles);

    if (!hiddenDiv.detected) {
      return this.notDetected(hiddenDiv.reason);
    }

    // Check standard divergence detector for additional confirmation
    const divergence = calculateDivergence(candles);
    const hasConfirmingDiv = divergence.divergences.some(
      (d: { type: string }) => d.type === "bullish",
    );

    // VPT confirmation
    const vpt = calculateVPT(candles);
    const vptBullish = vpt.trend === "bullish";

    // Build confidence
    let confidence = 0.5;

    // Hidden divergence found
    confidence += 0.1;

    // Confirmed by divergence detector
    if (hasConfirmingDiv) {
      confidence += 0.1;
    }

    // VPT bullish
    if (vptBullish) {
      confidence += 0.1;
    }

    // Volume trend
    const volumeTrend = this.analyzeVolumeTrend(candles, 5, 20);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // Distance above EMA (not too extended)
    const distToEMA = (currentPrice - ema50.current) / ema50.current;
    if (distToEMA < 0.05) {
      confidence += 0.05; // Close to EMA = better entry
    }

    const signals = {
      hiddenDivergence: hiddenDiv,
      detectorConfirms: hasConfirmingDiv,
      vptTrend: vpt.trend,
      vptSlope: vpt.slope,
      vptDivergence: vpt.divergence,
      ema50: ema50.current,
      distanceToEMA: distToEMA * 100,
      volumeTrend,
      rsi: hiddenDiv.currentRSI,
    };

    const reasons: string[] = [];
    reasons.push("Hidden bullish divergence detected");
    reasons.push(
      `Price higher low: $${hiddenDiv.priceHigherLow?.toFixed(2)} > $${hiddenDiv.pricePrevLow?.toFixed(2)}`,
    );
    reasons.push(
      `RSI lower low: ${hiddenDiv.rsiLowerLow?.toFixed(1)} < ${hiddenDiv.rsiPrevLow?.toFixed(1)}`,
    );
    if (vptBullish) reasons.push("VPT confirms bullish trend");
    if (hasConfirmingDiv) reasons.push("Divergence detector confirms");
    reasons.push(
      `EMA50: $${ema50.current.toFixed(2)} (price ${distToEMA > 0 ? "above" : "below"})`,
    );

    return this.detected(confidence, signals, reasons.join(". "));
  }

  private detectHiddenBullishDivergence(candles: Candle[]): {
    detected: boolean;
    reason: string;
    priceHigherLow?: number;
    pricePrevLow?: number;
    rsiLowerLow?: number;
    rsiPrevLow?: number;
    currentRSI?: number;
  } {
    const _prices = candles.map((c) => c.close);
    const rsi = this.calculateRSI(candles);

    if (rsi.current === null || rsi.values.length < candles.length) {
      return { detected: false, reason: "Could not calculate RSI" };
    }

    // Find recent swing lows in price
    const priceLows = this.findSwingLows(
      candles.map((c) => c.low),
      SWING_LOOKBACK,
    );
    if (priceLows.length < 2) {
      return { detected: false, reason: "Need at least 2 price swing lows" };
    }

    // Get last two swing lows
    const recentPriceLow = priceLows[priceLows.length - 1]!;
    const prevPriceLow = priceLows[priceLows.length - 2]!;

    // Hidden bullish: price higher low
    if (recentPriceLow.value <= prevPriceLow.value) {
      return {
        detected: false,
        reason: `Price lower low ($${recentPriceLow.value.toFixed(2)} <= $${prevPriceLow.value.toFixed(2)}) — not hidden divergence`,
      };
    }

    // Check RSI at those swing points — should be lower low
    const rsiValues = rsi.values;
    const recentRSI = rsiValues[recentPriceLow.index];
    const prevRSI = rsiValues[prevPriceLow.index];

    if (recentRSI == null || prevRSI == null) {
      return { detected: false, reason: "RSI values not available at swing points" };
    }

    if (recentRSI >= prevRSI) {
      return {
        detected: false,
        reason: `RSI higher at recent low (${recentRSI.toFixed(1)} >= ${prevRSI.toFixed(1)}) — not hidden divergence`,
      };
    }

    return {
      detected: true,
      reason: "Hidden bullish divergence confirmed",
      priceHigherLow: recentPriceLow.value,
      pricePrevLow: prevPriceLow.value,
      rsiLowerLow: recentRSI,
      rsiPrevLow: prevRSI,
      currentRSI: rsi.current,
    };
  }

  private findSwingLows(values: number[], lookback: number): { index: number; value: number }[] {
    const lows: { index: number; value: number }[] = [];

    for (let i = lookback; i < values.length - lookback; i++) {
      let isLow = true;
      for (let j = 1; j <= lookback; j++) {
        if (values[i]! > values[i - j]! || values[i]! > values[i + j]!) {
          isLow = false;
          break;
        }
      }
      if (isLow) {
        lows.push({ index: i, value: values[i]! });
      }
    }

    return lows;
  }

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const ema50 = this.calculateEMA(candles, TREND_EMA_PERIOD);

    const entryPrice = currentPrice;

    // Stop below the higher low or EMA50
    const atrVal = atr.current ?? currentPrice * 0.02;
    const emaStop = ema50.current ? ema50.current * 0.98 : entryPrice * 0.95;
    const atrStop = entryPrice - atrVal * 1.5;
    const stopLoss = Math.max(emaStop, atrStop);

    // Trend continuation targets
    const risk = entryPrice - stopLoss;
    const takeProfits: TakeProfitLevel[] = [
      { price: entryPrice + risk * 2, percentToSell: 0.3 },
      { price: entryPrice + risk * 3.5, percentToSell: 0.4 },
      { price: entryPrice + risk * 5, percentToSell: 0.3 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Hidden divergence continuation trade. Trend intact — pullback offers entry. ` +
        `Stop below EMA50 at $${stopLoss.toFixed(2)}. Trail with trend. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Hidden Divergence Strategy Rules

When creating a plan using the Hidden Divergence strategy:

### Entry Rules
- Price must be above EMA 50 (uptrend confirmed)
- Hidden bullish divergence: price makes higher low, RSI makes lower low
- This is a CONTINUATION signal (trend is intact, pullback offers entry)
- VPT bullish trend preferred for volume confirmation

### Stop-Loss Rules
- Place stop below EMA 50 or 1.5x ATR below entry
- The higher low pivot should not be violated
- If EMA 50 breaks, trend may be reversing — exit

### Take-Profit Rules
- TP1: 2:1 R:R (sell 30%) — secure first profit
- TP2: 3.5:1 R:R (sell 40%) — core profit
- TP3: 5:1 R:R or trail (sell 30%) — trend continuation
- Trail stop along EMA 50 for remaining position

### Risk Management
- Maximum position size: 4% of portfolio
- Only trade in confirmed uptrends
- Exit if price closes below EMA 50 on daily
- Avoid during choppy, range-bound markets
`;
  }

  override getRequiredIndicators(): string[] {
    return ["sma50", "ema50", "rsi14", "rsi14Prev", "atr14"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    if (index < 50) return null;

    const rsi = indicators.rsi14;
    const prevRsi = indicators.rsi14Prev;
    const ema50 = indicators.ema50;

    // Simple proxy: price above EMA50, RSI pulling back but not oversold
    if (
      ema50 != null &&
      bar.close > ema50 &&
      rsi != null &&
      prevRsi != null &&
      rsi < prevRsi &&
      rsi > 35 &&
      rsi < 50
    ) {
      // Check price making higher low
      if (
        index >= 2 &&
        data[index - 1]!.low < data[index - 2]!.low &&
        bar.low > data[index - 1]!.low
      ) {
        return {
          type: "BUY",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `Hidden divergence: price higher low above EMA50, RSI ${rsi.toFixed(1)} pulling back`,
        };
      }
    }

    return null;
  }
}

export const hiddenDivergenceStrategy = new HiddenDivergenceStrategy();
