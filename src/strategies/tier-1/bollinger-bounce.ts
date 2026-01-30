/**
 * Bollinger Bounce Strategy
 *
 * A mean-reversion strategy that buys when price touches or breaks
 * below the lower Bollinger Band with oversold RSI confirmation.
 *
 * Entry Conditions:
 * - Price at or below the lower Bollinger Band
 * - RSI < 35 (oversold or approaching)
 * - Not in a strong downtrend (EMA alignment check)
 *
 * Confidence Boosters:
 * - RSI < 30 (deeply oversold) (+10%)
 * - Price closed below lower band (wick) (+10%)
 * - Bollinger squeeze releasing (+10%)
 * - Volume spike on touch (+10%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
} from "../types.ts";

// ============================================================================
// Constants
// ============================================================================

/** RSI threshold for valid setup */
const RSI_THRESHOLD = 35;

/** RSI deeply oversold level */
const RSI_DEEPLY_OVERSOLD = 30;

/** Bollinger band position threshold (price within band width) */
const BAND_TOUCH_THRESHOLD = 0.02; // 2% from lower band

// ============================================================================
// Bollinger Bounce Strategy
// ============================================================================

export class BollingerBounceStrategy extends BaseStrategy {
  readonly id: StrategyId = "bollinger_bounce";
  readonly name = "Bollinger Bounce";
  readonly tier = 1 as const;
  readonly description =
    "Buy when price touches the lower Bollinger Band with RSI oversold. " +
    "A mean-reversion strategy that profits from price returning to the middle band.";
  readonly indicators = ["Bollinger Bands", "RSI", "Volume"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "low" as const;

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

    // Calculate Bollinger Bands
    const bb = this.calculateBollingerBands(candles);
    if (!bb.current.lower || !bb.current.middle || !bb.current.upper) {
      return this.notDetected("Could not calculate Bollinger Bands");
    }

    // Check price position relative to lower band
    const distanceToLower = (currentPrice - bb.current.lower) / bb.current.lower;

    if (distanceToLower > BAND_TOUCH_THRESHOLD) {
      return this.notDetected(
        `Price too far from lower band (${(distanceToLower * 100).toFixed(1)}% above)`
      );
    }

    // Calculate RSI
    const rsi = this.calculateRSI(candles);
    if (rsi.current === null) {
      return this.notDetected("Could not calculate RSI");
    }

    if (rsi.current > RSI_THRESHOLD) {
      return this.notDetected(
        `RSI not oversold (${rsi.current.toFixed(1)} > ${RSI_THRESHOLD})`
      );
    }

    // Check for strong downtrend (disqualifier)
    const ema50 = this.calculateEMA(candles, 50);
    const ema200 = this.calculateEMA(candles, 200);
    if (
      ema50.current &&
      ema200.current &&
      ema50.current < ema200.current * 0.95
    ) {
      // EMA50 more than 5% below EMA200 = strong downtrend
      return this.notDetected("Strong downtrend detected (avoid catching knives)");
    }

    // Calculate confidence
    let confidence = 0.5;

    // Price position bonus (below band = higher confidence)
    if (currentPrice <= bb.current.lower) {
      confidence += 0.1; // Actually touched/broke the band
    }

    // RSI depth bonus
    if (rsi.current < RSI_DEEPLY_OVERSOLD) {
      confidence += 0.1;
    }

    // Squeeze bonus (narrow bands releasing)
    if (bb.squeeze) {
      confidence += 0.05;
    }

    // Volume spike bonus
    const volumeTrend = this.analyzeVolumeTrend(candles);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // Last candle wick below band (hammer pattern)
    const lastCandle = candles[candles.length - 1];
    if (lastCandle && lastCandle.low < bb.current.lower && lastCandle.close > bb.current.lower) {
      confidence += 0.1; // Bounce wick pattern
    }

    const signals = {
      lowerBand: bb.current.lower,
      middleBand: bb.current.middle,
      upperBand: bb.current.upper,
      bandwidth: bb.current.bandwidth,
      pricePosition: bb.position,
      squeeze: bb.squeeze,
      rsi: rsi.current,
      rsiSignal: rsi.signal,
      volumeTrend,
    };

    const reasons: string[] = [];
    reasons.push(`Price at lower Bollinger Band ($${bb.current.lower.toFixed(2)})`);
    reasons.push(`RSI: ${rsi.current.toFixed(1)} (${rsi.signal})`);
    reasons.push(`Band width: ${((bb.current.bandwidth ?? 0) * 100).toFixed(1)}%`);
    if (bb.squeeze) reasons.push("Bollinger squeeze detected");

    return this.detected(confidence, signals, reasons.join(". "));
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const bb = this.calculateBollingerBands(candles);
    const atr = this.calculateATR(candles);

    // Entry at current price
    const entryPrice = currentPrice;

    // Stop-loss below the lower band or 1.5 ATR
    const atrStop = atr.current ? entryPrice - atr.current * 1.5 : entryPrice * 0.97;
    const bandStop = bb.current.lower ? bb.current.lower * 0.99 : entryPrice * 0.97;
    const stopLoss = Math.min(atrStop, bandStop);

    // Take-profits: middle band, upper band, and beyond
    const takeProfits = [
      { price: bb.current.middle ?? entryPrice * 1.03, percentToSell: 0.5 },
      { price: bb.current.upper ?? entryPrice * 1.06, percentToSell: 0.3 },
      { price: (bb.current.upper ?? entryPrice * 1.06) * 1.02, percentToSell: 0.2 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes: `Bollinger Bounce setup. Target middle band at $${(bb.current.middle ?? 0).toFixed(2)}. ` +
        `R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Bollinger Bounce Strategy Rules

When creating a plan using the Bollinger Bounce strategy:

### Entry Rules
- Enter when price touches or breaks below the lower Bollinger Band
- RSI must be below 35 (preferably below 30)
- Avoid if price is in a strong downtrend (don't catch falling knives)

### Stop-Loss Rules
- Place stop-loss 1-2% below the lower Bollinger Band
- Or use 1.5x ATR below entry (whichever is tighter)
- Exit if price closes below stop on higher timeframe

### Take-Profit Rules
- TP1: Middle Bollinger Band (sell 50%)
- TP2: Upper Bollinger Band (sell 30%)
- TP3: 2% above upper band (sell remaining 20%)

### Risk Management
- Best in range-bound or slightly bullish markets
- Avoid during high volatility news events
- Maximum position size: 5% of portfolio

### Best Conditions
- Sideways markets with established ranges
- After sharp pullbacks that don't break structure
- When Bollinger Bands are squeezing (low volatility)
`;
  }
}

export const bollingerBounceStrategy = new BollingerBounceStrategy();
