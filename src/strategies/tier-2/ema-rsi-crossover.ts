/**
 * EMA+RSI Crossover Strategy
 *
 * An intermediate strategy combining EMA crossovers with RSI
 * momentum filter for higher-quality signals.
 *
 * Entry Conditions:
 * - EMA 9 crosses above EMA 21 (short-term bullish)
 * - RSI > 50 and rising (momentum confirmation)
 * - Price above EMA 50 (medium-term trend)
 *
 * Confidence Boosters:
 * - RSI 50-65 (strong but not overbought) (+10%)
 * - Volume increasing on crossover (+10%)
 * - All EMAs aligned (9 > 21 > 50) (+15%)
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

/** Fast EMA period */
const FAST_EMA = 9;

/** Medium EMA period */
const MEDIUM_EMA = 21;

/** Slow EMA period */
const SLOW_EMA = 50;

/** Minimum RSI for momentum confirmation */
const RSI_THRESHOLD = 50;

/** RSI overbought level */
const RSI_OVERBOUGHT = 70;

/** Max candles since crossover */
const CROSSOVER_LOOKBACK = 3;

// ============================================================================
// EMA+RSI Crossover Strategy
// ============================================================================

export class EMARSICrossoverStrategy extends BaseStrategy {
  readonly id: StrategyId = "ema_rsi_crossover";
  readonly name = "EMA+RSI Crossover";
  readonly tier = 2 as const;
  readonly description =
    "Combine EMA 9/21 crossover with RSI momentum filter. " +
    "Filters false signals by requiring RSI > 50 and rising.";
  readonly indicators = ["EMA 9", "EMA 21", "EMA 50", "RSI", "Volume"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < 60) {
      return this.notDetected("Insufficient data (need 60+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate EMAs
    const ema9 = this.calculateEMA(candles, FAST_EMA);
    const ema21 = this.calculateEMA(candles, MEDIUM_EMA);
    const ema50 = this.calculateEMA(candles, SLOW_EMA);

    if (!ema9.current || !ema21.current || !ema50.current) {
      return this.notDetected("Could not calculate EMAs");
    }

    // Check for bullish crossover (EMA9 > EMA21)
    if (ema9.current <= ema21.current) {
      return this.notDetected(
        `No bullish crossover (EMA9: $${ema9.current.toFixed(2)} <= EMA21: $${ema21.current.toFixed(2)})`
      );
    }

    // Check how recent the crossover is
    const crossoverAge = this.findCrossoverAge(ema9.values, ema21.values);
    if (crossoverAge > CROSSOVER_LOOKBACK) {
      return this.notDetected(
        `Crossover too old (${crossoverAge} candles ago > ${CROSSOVER_LOOKBACK})`
      );
    }

    // Check price above EMA50 (medium-term trend)
    if (currentPrice < ema50.current) {
      return this.notDetected(
        `Price below EMA50 ($${currentPrice.toFixed(2)} < $${ema50.current.toFixed(2)})`
      );
    }

    // RSI momentum filter
    const rsi = this.calculateRSI(candles);
    if (rsi.current === null) {
      return this.notDetected("Could not calculate RSI");
    }

    if (rsi.current < RSI_THRESHOLD) {
      return this.notDetected(
        `RSI below threshold (${rsi.current.toFixed(1)} < ${RSI_THRESHOLD})`
      );
    }

    if (rsi.current > RSI_OVERBOUGHT) {
      return this.notDetected(
        `RSI overbought (${rsi.current.toFixed(1)} > ${RSI_OVERBOUGHT})`
      );
    }

    // Check RSI is rising
    const rsiRising = this.isRSIRising(rsi.values);
    if (!rsiRising) {
      return this.notDetected("RSI is falling (momentum weakening)");
    }

    // Calculate confidence
    let confidence = 0.55;

    // RSI sweet spot bonus (50-65)
    if (rsi.current >= 50 && rsi.current <= 65) {
      confidence += 0.1;
    }

    // Full EMA alignment bonus (9 > 21 > 50)
    if (ema9.current > ema21.current && ema21.current > ema50.current) {
      confidence += 0.15;
    }

    // Volume bonus
    const volumeTrend = this.analyzeVolumeTrend(candles);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // Recent crossover bonus (fresher = better)
    if (crossoverAge <= 1) {
      confidence += 0.1;
    }

    const signals = {
      ema9: ema9.current,
      ema21: ema21.current,
      ema50: ema50.current,
      crossoverAge,
      emaAligned: ema9.current > ema21.current && ema21.current > ema50.current,
      rsi: rsi.current,
      rsiRising,
      volumeTrend,
    };

    const reasons: string[] = [];
    reasons.push(`EMA 9/21 bullish crossover (${crossoverAge} candles ago)`);
    reasons.push(`RSI: ${rsi.current.toFixed(1)} (rising)`);
    if (signals.emaAligned) {
      reasons.push("Full EMA alignment (9 > 21 > 50)");
    }
    reasons.push(`Volume: ${volumeTrend}`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Find how many candles ago the crossover occurred
   */
  private findCrossoverAge(
    fastValues: (number | null)[],
    slowValues: (number | null)[]
  ): number {
    for (let i = fastValues.length - 1; i >= 1; i--) {
      const currentFast = fastValues[i];
      const currentSlow = slowValues[i];
      const prevFast = fastValues[i - 1];
      const prevSlow = slowValues[i - 1];

      if (
        currentFast !== null &&
        currentSlow !== null &&
        prevFast !== null &&
        prevSlow !== null &&
        currentFast !== undefined &&
        currentSlow !== undefined &&
        prevFast !== undefined &&
        prevSlow !== undefined
      ) {
        if (currentFast > currentSlow && prevFast <= prevSlow) {
          return fastValues.length - 1 - i;
        }
      }
    }
    return 999;
  }

  /**
   * Check if RSI is rising over last few periods
   */
  private isRSIRising(values: (number | null)[]): boolean {
    const valid = values.filter((v): v is number => v !== null);
    if (valid.length < 3) return false;

    const recent = valid.slice(-3);
    return recent[2]! > recent[0]!;
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const ema21 = this.calculateEMA(candles, MEDIUM_EMA);
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;

    // Stop-loss below EMA21 or recent swing low
    const recentLow = Math.min(...candles.slice(-5).map((c) => c.low));
    const emaStop = ema21.current ? ema21.current * 0.98 : entryPrice * 0.95;
    const stopLoss = Math.max(recentLow * 0.99, emaStop);

    // Take-profits
    const risk = entryPrice - stopLoss;
    const takeProfits = [
      { price: entryPrice + risk * 1.5, percentToSell: 0.35 },
      { price: entryPrice + risk * 3, percentToSell: 0.35 },
      { price: entryPrice + risk * 5, percentToSell: 0.3 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes: `EMA crossover with RSI confirmation. Stop below EMA21 at $${stopLoss.toFixed(2)}. ` +
        `R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## EMA+RSI Crossover Strategy Rules

When creating a plan using the EMA+RSI Crossover strategy:

### Entry Rules
- Enter when EMA 9 crosses above EMA 21
- RSI must be > 50 and rising (momentum confirmation)
- Price should be above EMA 50 (trend filter)
- Best: crossover within last 3 candles

### Stop-Loss Rules
- Place stop below EMA 21 or recent swing low
- Keep stop tight due to short-term nature
- Exit if EMA 9 crosses back below EMA 21

### Take-Profit Rules
- TP1: 1.5:1 R:R (sell 35%)
- TP2: 3:1 R:R (sell 35%)
- TP3: 5:1 R:R or trail (sell 30%)

### Risk Management
- This is a medium-term momentum strategy
- Exit if RSI drops below 50
- Exit if EMA alignment breaks
- Maximum position size: 4% of portfolio

### Best Conditions
- Trending markets with pullbacks
- When all 3 EMAs are aligned (9 > 21 > 50)
- After oversold RSI bounces above 50
`;
  }
}

export const emaRsiCrossoverStrategy = new EMARSICrossoverStrategy();
