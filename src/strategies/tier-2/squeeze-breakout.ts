/**
 * Squeeze Breakout Strategy
 *
 * Detects Bollinger Band squeeze (BB inside Keltner Channel) and trades
 * the breakout when momentum fires in a confirmed direction.
 *
 * Entry Conditions:
 * - Squeeze just fired (BB was inside KC, now expanding)
 * - Momentum is positive and accelerating (lime color)
 * - ADX > 20 confirms directional movement starting
 *
 * Confidence Boosters:
 * - ADX rising (+10%)
 * - Volume above average (+10%)
 * - Momentum slope steep (+10%)
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
import { calculateSqueezeMomentum } from "../../core/indicators/index.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

const ADX_MIN = 20;
const CANDLE_LIMIT = 100;

// ============================================================================
// Squeeze Breakout Strategy
// ============================================================================

export class SqueezeBreakoutStrategy extends BaseStrategy {
  readonly id: StrategyId = "squeeze_breakout";
  readonly name = "Squeeze Breakout";
  readonly tier = 2 as const;
  readonly description =
    "Trades volatility breakouts when Bollinger Bands squeeze inside " +
    "Keltner Channels fires with strong momentum confirmation.";
  readonly indicators = ["Squeeze Momentum", "ADX", "ATR"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "high" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < 30) {
      return this.notDetected("Insufficient data (need 30+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate Squeeze Momentum
    const squeeze = calculateSqueezeMomentum(candles);

    if (!squeeze.squeezeFired && !squeeze.squeezeOn) {
      return this.notDetected("No squeeze detected — normal volatility");
    }

    if (squeeze.squeezeOn && !squeeze.squeezeFired) {
      return this.notDetected(
        "Squeeze is ON (compressing) but hasn't fired yet — wait for breakout",
      );
    }

    // Squeeze just fired — check momentum direction
    if (squeeze.momentum === null || squeeze.momentum <= 0) {
      return this.notDetected(
        `Squeeze fired but momentum is ${squeeze.momentum?.toFixed(4) ?? "N/A"} (bearish/flat) — only trade bullish breakouts`,
      );
    }

    if (squeeze.momentumColor !== "lime") {
      return this.notDetected(
        `Squeeze fired with positive momentum but decelerating (${squeeze.momentumColor}) — want accelerating (lime)`,
      );
    }

    // ADX check for directional strength
    const adxResult = this.calculateADXSimple(candles);

    // Build confidence
    let confidence = 0.55; // Squeeze fired + momentum lime is already a solid setup

    // ADX confirmation
    if (adxResult.adx !== null && adxResult.adx >= ADX_MIN) {
      confidence += 0.1;
      if (adxResult.adxTrend === "rising") {
        confidence += 0.1;
      }
    }

    // Volume above average
    const volumeTrend = this.analyzeVolumeTrend(candles, 5, 20);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // Strong momentum slope
    if (squeeze.momentum > 0.01) {
      confidence += 0.1;
    }

    const signals = {
      squeezeFired: true,
      momentum: squeeze.momentum,
      momentumColor: squeeze.momentumColor,
      signal: squeeze.signal,
      adx: adxResult.adx,
      adxTrend: adxResult.adxTrend,
      volumeTrend,
    };

    const reasons: string[] = [];
    reasons.push("SQUEEZE FIRED — volatility breakout");
    reasons.push(
      `Momentum: +${squeeze.momentum.toFixed(4)} (${squeeze.momentumColor}, accelerating)`,
    );
    if (adxResult.adx !== null) {
      reasons.push(`ADX: ${adxResult.adx.toFixed(1)} (${adxResult.adxTrend})`);
    }
    reasons.push(`Volume: ${volumeTrend}`);
    reasons.push(`Squeeze signal: ${squeeze.signal}`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  private calculateADXSimple(candles: Candle[]): {
    adx: number | null;
    adxTrend: "rising" | "falling" | "flat";
  } {
    if (candles.length < 28) {
      return { adx: null, adxTrend: "flat" };
    }

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
        Math.abs(current.low - previous.close),
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
      const dx = (Math.abs(pdi - mdi) / (pdi + mdi)) * 100;
      if (!Number.isNaN(dx)) dxValues.push(dx);
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

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;

    // Stop-loss: 2x ATR below entry (breakout needs room)
    const atrVal = atr.current ?? currentPrice * 0.03;
    const stopLoss = entryPrice - atrVal * 2;

    // Take-profits: breakout style (let it run)
    const risk = entryPrice - stopLoss;
    const takeProfits: TakeProfitLevel[] = [
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
      notes:
        `Squeeze breakout trade. Volatility expanding after compression. ` +
        `Stop at $${stopLoss.toFixed(2)} (2x ATR). Trail stop after TP1. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Squeeze Breakout Strategy Rules

When creating a plan using the Squeeze Breakout strategy:

### Entry Rules
- Only enter when squeeze has just FIRED (BB was inside KC, now expanding)
- Momentum must be positive and accelerating (lime color)
- ADX > 20 preferred for directional confirmation
- Enter on the candle after squeeze fires

### Stop-Loss Rules
- Place stop 2x ATR below entry (breakouts need room)
- Never move stop against the trade
- Trail stop after first take-profit hit

### Take-Profit Rules
- TP1: 1.5:1 R:R (sell 30%) — lock in profit
- TP2: 3:1 R:R (sell 40%) — core profit
- TP3: 5:1 R:R or trail (sell 30%) — let it run

### Risk Management
- Maximum position size: 3% of portfolio (high volatility play)
- Exit if momentum color turns from lime to green (decelerating)
- Exit if squeeze turns back ON (false breakout)
- Best on higher timeframes (4h, daily)
`;
  }

  override getRequiredIndicators(): string[] {
    return ["sma20", "rsi14", "atr14", "bbUpper", "bbLower", "bbMiddle"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    if (index < 25) return null;

    const bbWidth = indicators.bbWidth;
    const prevBbWidth =
      index > 0 ? (data[index - 1] as OHLC & { bbWidth?: number })?.bbWidth : undefined;

    // Simple proxy: BB width expanding after contraction
    if (bbWidth != null && prevBbWidth != null && bbWidth > prevBbWidth * 1.2) {
      const momentum = (bar.close - bar.open) / bar.open;
      if (momentum > 0.005) {
        return {
          type: "BUY",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `Squeeze breakout: BB expanding, bullish momentum`,
        };
      }
    }

    return null;
  }
}

export const squeezeBreakoutStrategy = new SqueezeBreakoutStrategy();
