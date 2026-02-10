/**
 * MFI Divergence Confluence Strategy
 *
 * A confluence-based strategy requiring multiple oversold/divergence signals
 * to align before entry. Uses a 3-out-of-5 rule for confirmation.
 *
 * Entry Conditions (need 3 of 5):
 * 1. MFI < 20 (oversold)
 * 2. RSI < 30 (oversold)
 * 3. RSI bullish divergence detected
 * 4. Price at or below lower Bollinger Band
 * 5. Volume increasing (buying interest)
 *
 * Confidence Boosters:
 * - 4/5 conditions met (+15%)
 * - 5/5 conditions met (+25%)
 * - Price at strong support level (+10%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
  TakeProfitLevel,
} from "../types.ts";
import { calculateMFI, calculateDivergence } from "../../core/indicators/index.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

const MFI_OVERSOLD = 20;
const RSI_OVERSOLD = 30;
const MIN_CONDITIONS = 3;
const CANDLE_LIMIT = 100;

// ============================================================================
// MFI Divergence Confluence Strategy
// ============================================================================

export class MFIDivergenceConfluenceStrategy extends BaseStrategy {
  readonly id: StrategyId = "mfi_divergence_confluence";
  readonly name = "MFI Divergence Confluence";
  readonly tier = 2 as const;
  readonly description =
    "Multi-signal confluence strategy requiring 3-of-5 oversold/divergence " +
    "conditions for high-probability reversal entries.";
  readonly indicators = ["MFI", "RSI", "Divergence", "Bollinger Bands"];
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

    // Check each of the 5 conditions
    const conditions: { name: string; met: boolean; detail: string }[] = [];

    // 1. MFI oversold
    const mfi = calculateMFI(candles);
    const mfiOversold = mfi.current !== null && mfi.current < MFI_OVERSOLD;
    conditions.push({
      name: "MFI Oversold",
      met: mfiOversold,
      detail: `MFI: ${mfi.current?.toFixed(1) ?? "N/A"} ${mfiOversold ? "< " + MFI_OVERSOLD : ">= " + MFI_OVERSOLD}`,
    });

    // 2. RSI oversold
    const rsi = this.calculateRSI(candles);
    const rsiOversold = rsi.current !== null && rsi.current < RSI_OVERSOLD;
    conditions.push({
      name: "RSI Oversold",
      met: rsiOversold,
      detail: `RSI: ${rsi.current?.toFixed(1) ?? "N/A"} ${rsiOversold ? "< " + RSI_OVERSOLD : ">= " + RSI_OVERSOLD}`,
    });

    // 3. RSI bullish divergence
    const divergence = calculateDivergence(candles);
    const hasBullishDiv = divergence.divergences.some(
      (d: { type: string }) => d.type === "bullish"
    );
    conditions.push({
      name: "RSI Bullish Divergence",
      met: hasBullishDiv,
      detail: hasBullishDiv
        ? "Bullish divergence detected (price lower low, RSI higher low)"
        : "No bullish divergence",
    });

    // 4. Price at/below lower Bollinger Band
    const bb = this.calculateBollingerBands(candles);
    const atLowerBB =
      bb.current.lower !== null && currentPrice <= bb.current.lower * 1.005;
    conditions.push({
      name: "At Lower BB",
      met: atLowerBB,
      detail: atLowerBB
        ? `Price $${currentPrice.toFixed(2)} at/below lower BB $${bb.current.lower?.toFixed(2)}`
        : `Price $${currentPrice.toFixed(2)} above lower BB $${bb.current.lower?.toFixed(2) ?? "N/A"}`,
    });

    // 5. Rising volume
    const volumeTrend = this.analyzeVolumeTrend(candles, 5, 20);
    const risingVolume = volumeTrend === "rising";
    conditions.push({
      name: "Rising Volume",
      met: risingVolume,
      detail: `Volume trend: ${volumeTrend}`,
    });

    // Count conditions met
    const conditionsMet = conditions.filter((c) => c.met).length;

    if (conditionsMet < MIN_CONDITIONS) {
      const unmet = conditions
        .filter((c) => !c.met)
        .map((c) => c.name)
        .join(", ");
      return this.notDetected(
        `Only ${conditionsMet}/5 conditions met (need ${MIN_CONDITIONS}). Missing: ${unmet}`
      );
    }

    // Build confidence
    let confidence = 0.45;
    confidence += conditionsMet * 0.1; // 0.1 per condition

    if (conditionsMet >= 4) confidence += 0.05;
    if (conditionsMet === 5) confidence += 0.1;

    const signals: Record<string, unknown> = {
      conditionsMet,
      totalConditions: 5,
      mfi: mfi.current,
      rsi: rsi.current,
      hasBullishDivergence: hasBullishDiv,
      atLowerBB,
      volumeTrend,
      conditions: conditions.map((c) => ({ name: c.name, met: c.met })),
    };

    const reasons = conditions.map(
      (c) => `${c.met ? "[YES]" : "[NO]"} ${c.detail}`
    );
    reasons.unshift(`${conditionsMet}/5 confluence conditions met`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const bb = this.calculateBollingerBands(candles);

    const entryPrice = currentPrice;

    // Stop-loss below lower BB or 1.5x ATR
    const atrVal = atr.current ?? currentPrice * 0.02;
    const bbStop = bb.current.lower ? bb.current.lower * 0.98 : entryPrice * 0.95;
    const atrStop = entryPrice - atrVal * 1.5;
    const stopLoss = Math.min(bbStop, atrStop);

    // Take-profits: mean reversion targets
    const risk = entryPrice - stopLoss;
    const midBB = bb.current.middle ?? entryPrice * 1.02;
    const upperBB = bb.current.upper ?? entryPrice * 1.04;

    const takeProfits: TakeProfitLevel[] = [
      { price: midBB, percentToSell: 0.4 },
      { price: upperBB, percentToSell: 0.35 },
      { price: entryPrice + risk * 4, percentToSell: 0.25 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `MFI Divergence Confluence reversal. Multiple oversold signals aligned. ` +
        `TP1 at mid-BB $${midBB.toFixed(2)}, TP2 at upper-BB. Stop at $${stopLoss.toFixed(2)}. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## MFI Divergence Confluence Strategy Rules

When creating a plan using the MFI Divergence Confluence strategy:

### Entry Rules (3-of-5 required)
1. MFI < 20 (oversold money flow)
2. RSI < 30 (oversold momentum)
3. RSI bullish divergence (price lower low, RSI higher low)
4. Price at or below lower Bollinger Band
5. Volume increasing (buying interest building)

### Stop-Loss Rules
- Place stop below lower Bollinger Band or 1.5x ATR below entry
- Use whichever is tighter for better risk management
- If MFI drops to single digits, consider wider stop

### Take-Profit Rules
- TP1: Middle Bollinger Band (sell 40%) — mean reversion target
- TP2: Upper Bollinger Band (sell 35%) — full reversion
- TP3: 4:1 R:R (sell 25%) — momentum continuation

### Risk Management
- Maximum position size: 4% of portfolio
- More conditions met = higher confidence = can size slightly larger
- Exit if MFI crosses above 80 (overbought reversal)
- Exit if price closes below stop on daily candle
- Best as counter-trend entry during pullbacks in uptrends
`;
  }

  override getRequiredIndicators(): string[] {
    return ["sma20", "rsi14", "atr14", "bbUpper", "bbLower", "bbMiddle", "volumeAvg20"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    _data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    if (index < 20) return null;

    const rsi = indicators.rsi14;
    const bbLower = indicators.bbLower;
    const volumeRatio = indicators.volumeRatio;

    // Simple proxy: RSI oversold + at lower BB + volume spike
    if (
      rsi != null && rsi < RSI_OVERSOLD &&
      bbLower != null && bar.close <= bbLower * 1.005 &&
      volumeRatio != null && volumeRatio > 1.5
    ) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: `MFI confluence: RSI ${rsi.toFixed(1)} oversold, at lower BB, volume ${volumeRatio.toFixed(1)}x avg`,
      };
    }

    return null;
  }
}

export const mfiDivergenceConfluenceStrategy = new MFIDivergenceConfluenceStrategy();
