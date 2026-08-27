/**
 * Statistical Arbitrage (Velocity-Filtered) Strategy
 *
 * A mean-reversion strategy that uses Z-score extremes to identify
 * price deviations from the rolling mean, filtered by price velocity
 * to avoid catching falling knives.
 *
 * Core Concept:
 * Calculate Z-score of price relative to its rolling mean. When Z-score
 * hits extremes, enter mean-reversion trade. But ONLY if price velocity
 * (rate of change) confirms the reversal is starting (velocity declining
 * into the extreme, or already reversing).
 *
 * Entry Conditions:
 * - LONG: Z-score < -2.0 AND velocity turning positive (acceleration > 0)
 * - SHORT: Z-score > 2.0 AND velocity turning negative (acceleration < 0)
 *
 * The velocity filter is the key innovation: without it, you catch falling
 * knives. With it, you wait for the reversal to begin before entering.
 *
 * Confidence Boosters:
 * - |Z-score| > 2.5: +10%
 * - |Z-score| > 3.0: +15% (instead of +10%)
 * - Velocity clearly reversing (|acceleration| > 0.5%): +10%
 * - Volume increasing on reversal candle: +10%
 * - Bollinger Band width expanding: +5%
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

/** Rolling mean period (SMA) */
const SMA_PERIOD = 20;

/** Standard deviation lookback (same as SMA) */
const STD_DEV_PERIOD = 20;

/** Velocity lookback (rate of change bars) */
const VELOCITY_BARS = 5;

/** Acceleration lookback (velocity change bars) */
const ACCELERATION_BARS = 3;

/** Z-score threshold for entry */
const ZSCORE_ENTRY = 2.0;

/** Z-score threshold for higher confidence */
const ZSCORE_HIGH = 2.5;

/** Z-score threshold for extreme confidence */
const ZSCORE_EXTREME = 3.0;

/** Acceleration threshold for velocity reversal confirmation (percentage) */
const ACCELERATION_THRESHOLD = 0.5;

/** Minimum candles required */
const MIN_CANDLES = 30;

// ============================================================================
// Statistical Arbitrage Strategy
// ============================================================================

export class StatArbStrategy extends BaseStrategy {
  readonly id: StrategyId = "stat_arb";
  readonly name = "Statistical Arbitrage";
  readonly tier = 2 as const;
  readonly description =
    "Velocity-filtered Z-score mean reversion. Enters when price deviates " +
    "significantly from its rolling mean, but only after velocity confirms " +
    "the reversal is starting. Prevents catching falling knives.";
  readonly indicators = ["SMA 20", "Bollinger Bands", "ATR"];
  readonly timeframes = ["15m", "1h"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    // 1. Fetch candles
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < MIN_CANDLES) {
      return this.notDetected(
        `Insufficient data (need ${MIN_CANDLES}+ candles, got ${candles.length})`,
      );
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // 2. Calculate SMA(20) and stdDev(20)
    const prices = this.extractPrices(candles);
    const smaResult = this.calculateSMA(candles, SMA_PERIOD);

    if (smaResult.current === null) {
      return this.notDetected("Could not calculate SMA");
    }

    const sma = smaResult.current;

    // Calculate rolling standard deviation over the last STD_DEV_PERIOD bars
    const recentPrices = prices.slice(-STD_DEV_PERIOD);
    const stdDev = this.computeStdDev(recentPrices, sma);

    if (stdDev === 0) {
      return this.notDetected("Standard deviation is zero (no price variance)");
    }

    // 3. Calculate Z-score
    const zScore = (currentPrice - sma) / stdDev;

    // 4. Calculate velocity (5-bar rate of change as percentage)
    if (candles.length < VELOCITY_BARS + ACCELERATION_BARS + 1) {
      return this.notDetected("Insufficient data for velocity calculation");
    }

    const closeNow = currentPrice;
    const closePrev = candles[candles.length - 1 - VELOCITY_BARS]?.close ?? 0;
    if (closePrev === 0) {
      return this.notDetected("Could not calculate velocity (zero reference price)");
    }
    const velocity = ((closeNow - closePrev) / closePrev) * 100;

    // Calculate velocity at ACCELERATION_BARS bars ago for acceleration
    const closeAccelRef = candles[candles.length - 1 - ACCELERATION_BARS]?.close ?? 0;
    const closeAccelPrev =
      candles[candles.length - 1 - ACCELERATION_BARS - VELOCITY_BARS]?.close ?? 0;
    let velocityPrev = 0;
    if (closeAccelPrev !== 0) {
      velocityPrev = ((closeAccelRef - closeAccelPrev) / closeAccelPrev) * 100;
    }

    // Acceleration = change in velocity
    const acceleration = velocity - velocityPrev;

    // 5. Determine direction
    let direction: "long" | "short" | null = null;

    if (zScore < -ZSCORE_ENTRY && acceleration > 0) {
      // LONG: price at extreme low, velocity turning positive
      direction = "long";
    } else if (zScore > ZSCORE_ENTRY && acceleration < 0) {
      // SHORT: price at extreme high, velocity turning negative
      direction = "short";
    }

    if (direction === null) {
      const absZ = Math.abs(zScore);
      if (absZ < ZSCORE_ENTRY) {
        return this.notDetected(
          `Z-score not extreme enough (${zScore.toFixed(2)}, need |Z| > ${ZSCORE_ENTRY})`,
        );
      }
      // Z-score is extreme but velocity not confirming
      return this.notDetected(
        `Z-score extreme (${zScore.toFixed(2)}) but velocity not confirming reversal ` +
          `(acceleration: ${acceleration.toFixed(3)}%, need ${direction === null && zScore < 0 ? "> 0" : "< 0"})`,
      );
    }

    // 6. Calculate Bollinger Bands for width
    const bb = this.calculateBollingerBands(candles, SMA_PERIOD, 2);
    const bbWidth = bb.current.bandwidth;

    // 7. Volume analysis
    const _volumeTrend = this.analyzeVolumeTrend(candles, 5, 20);
    const lastCandle = candles[candles.length - 1];
    const prevCandle = candles[candles.length - 2];
    const volumeIncreasing =
      lastCandle && prevCandle ? lastCandle.volume > prevCandle.volume : false;

    // 8. Confidence scoring
    let confidence = 0.5;
    const absZ = Math.abs(zScore);

    // Z-score magnitude bonuses
    if (absZ > ZSCORE_EXTREME) {
      confidence += 0.15;
    } else if (absZ > ZSCORE_HIGH) {
      confidence += 0.1;
    }

    // Velocity clearly reversing
    if (Math.abs(acceleration) > ACCELERATION_THRESHOLD) {
      confidence += 0.1;
    }

    // Volume increasing on reversal candle
    if (volumeIncreasing) {
      confidence += 0.1;
    }

    // Bollinger Band width expanding (confirms extreme move)
    if (bbWidth !== null && bbWidth > 0.04) {
      confidence += 0.05;
    }

    const signals = {
      zScore: parseFloat(zScore.toFixed(3)),
      velocity: parseFloat(velocity.toFixed(3)),
      acceleration: parseFloat(acceleration.toFixed(3)),
      direction,
      sma: parseFloat(sma.toFixed(2)),
      stdDev: parseFloat(stdDev.toFixed(4)),
      bbWidth: bbWidth !== null ? parseFloat(bbWidth.toFixed(4)) : null,
    };

    const reasons: string[] = [];
    reasons.push(
      `${direction.toUpperCase()} signal: Z-score ${zScore.toFixed(2)} (extreme ${direction === "long" ? "low" : "high"})`,
    );
    reasons.push(
      `Velocity: ${velocity.toFixed(2)}%, Acceleration: ${acceleration.toFixed(3)}% (confirming reversal)`,
    );
    if (absZ > ZSCORE_EXTREME) {
      reasons.push(`Extreme Z-score > ${ZSCORE_EXTREME} (+15% confidence)`);
    } else if (absZ > ZSCORE_HIGH) {
      reasons.push(`High Z-score > ${ZSCORE_HIGH} (+10% confidence)`);
    }
    if (volumeIncreasing) {
      reasons.push("Volume increasing on reversal candle (+10%)");
    }
    reasons.push(`SMA(20): $${sma.toFixed(2)}, StdDev: ${stdDev.toFixed(4)}`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "1h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const prices = this.extractPrices(candles);

    // Calculate SMA and stdDev
    const smaResult = this.calculateSMA(candles, SMA_PERIOD);
    const sma = smaResult.current ?? currentPrice;
    const recentPrices = prices.slice(-STD_DEV_PERIOD);
    const stdDev = this.computeStdDev(recentPrices, sma);

    // Determine direction from Z-score
    const zScore = stdDev !== 0 ? (currentPrice - sma) / stdDev : 0;
    const isLong = zScore < 0;

    const entryPrice = currentPrice;

    // Stop: 0.5 Z-score units beyond the extreme
    // For longs: stop = entry - 0.5 * stdDev
    // For shorts: stop = entry + 0.5 * stdDev
    const stopLoss = isLong ? entryPrice - 0.5 * stdDev : entryPrice + 0.5 * stdDev;

    // Take-profit targets based on Z-score levels
    // For longs: TP1 = Z=-1 level, TP2 = Z=0 (mean), TP3 = Z=+0.5 (overshoot)
    // For shorts: TP1 = Z=+1 level, TP2 = Z=0 (mean), TP3 = Z=-0.5 (overshoot)
    let takeProfits: Array<{ price: number; percentToSell: number }>;
    if (isLong) {
      takeProfits = [
        { price: sma - 1 * stdDev, percentToSell: 0.4 }, // TP1: Z = -1.0
        { price: sma, percentToSell: 0.35 }, // TP2: Z = 0 (mean)
        { price: sma + 0.5 * stdDev, percentToSell: 0.25 }, // TP3: Z = +0.5
      ];
    } else {
      takeProfits = [
        { price: sma + 1 * stdDev, percentToSell: 0.4 }, // TP1: Z = +1.0
        { price: sma, percentToSell: 0.35 }, // TP2: Z = 0 (mean)
        { price: sma - 0.5 * stdDev, percentToSell: 0.25 }, // TP3: Z = -0.5
      ];
    }

    // Weighted average TP for R:R calculation
    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Stat Arb ${isLong ? "LONG" : "SHORT"}: Z-score ${zScore.toFixed(2)}, ` +
        `mean reversion to SMA $${sma.toFixed(2)}. ` +
        `Stop at 0.5 stdDev beyond extreme ($${stopLoss.toFixed(2)}). ` +
        `R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Statistical Arbitrage (Velocity-Filtered) Strategy Rules

When creating a plan using the Statistical Arbitrage strategy:

### Core Concept
Statistical arbitrage exploits Z-score extremes indicating price far from its
rolling mean. Mean reversion is expected when price deviates > 2 standard
deviations. The velocity filter prevents catching falling knives by requiring
the reversal to START before entering.

### Entry Rules
- LONG: Z-score < -2.0 AND price velocity acceleration > 0 (reversal starting)
- SHORT: Z-score > 2.0 AND price velocity acceleration < 0 (reversal starting)
- The velocity filter is critical: never enter just because Z-score is extreme
- Wait for acceleration to confirm the turn

### Stop-Loss Rules
- Stop at 0.5 standard deviations beyond the entry extreme
- For longs: stop = entry - 0.5 * stdDev
- For shorts: stop = entry + 0.5 * stdDev
- Tight stop because mean reversion should begin quickly once velocity confirms

### Take-Profit Rules
- TP1 (40%): Z-score = -1.0 / +1.0 level (partial mean reversion)
- TP2 (35%): Z-score = 0 level (full mean reversion to SMA)
- TP3 (25%): Z-score = +0.5 / -0.5 (overshoot beyond mean)

### Risk Management
- Short hold time (hours, not days) — mean reversion is fast
- High frequency, low profit-per-trade but consistent edge
- Maximum position size: 3% of portfolio
- Exit immediately if velocity reverses against the position
- Works best on liquid pairs with mean-reverting behavior

### Best Conditions
- Range-bound or choppy markets (NOT strong trends)
- Liquid pairs with tight spreads
- When Bollinger Band width is expanding (confirms extreme move)
- Avoid during news events or strong directional momentum
`;
  }

  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  override getRequiredIndicators(): string[] {
    return ["sma20", "bb20"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    // Need enough history for velocity and acceleration
    if (index < SMA_PERIOD + VELOCITY_BARS + ACCELERATION_BARS) {
      return null;
    }

    const close = bar.close;
    const sma = indicators.sma20 ?? indicators.bbMiddle;
    if (sma === null || sma === undefined) {
      return null;
    }

    // Calculate stdDev from Bollinger Bands
    // BB upper = SMA + 2*stdDev, so stdDev = (upper - middle) / 2
    const bbUpper = indicators.bbUpper;
    const bbMiddle = indicators.bbMiddle;
    if (bbUpper === null || bbUpper === undefined || bbMiddle === null || bbMiddle === undefined) {
      return null;
    }
    const stdDev = (bbUpper - bbMiddle) / 2;
    if (stdDev === 0) {
      return null;
    }

    // Z-score
    const zScore = (close - sma) / stdDev;

    // Velocity: 5-bar rate of change
    const closePrev = data[index - VELOCITY_BARS]?.close;
    if (!closePrev || closePrev === 0) {
      return null;
    }
    const velocity = ((close - closePrev) / closePrev) * 100;

    // Velocity at ACCELERATION_BARS bars ago
    const closeAccelRef = data[index - ACCELERATION_BARS]?.close;
    const closeAccelPrev = data[index - ACCELERATION_BARS - VELOCITY_BARS]?.close;
    let velocityPrev = 0;
    if (closeAccelRef && closeAccelPrev && closeAccelPrev !== 0) {
      velocityPrev = ((closeAccelRef - closeAccelPrev) / closeAccelPrev) * 100;
    }

    const acceleration = velocity - velocityPrev;

    // BUY: Z-score extreme low + velocity turning positive
    if (zScore < -ZSCORE_ENTRY && acceleration > 0) {
      return {
        type: "BUY",
        price: close,
        timestamp: bar.timestamp,
        reason: `Stat Arb LONG: Z=${zScore.toFixed(2)}, velocity turning positive (accel=${acceleration.toFixed(3)}%)`,
      };
    }

    // SELL: Z-score extreme high + velocity turning negative
    if (zScore > ZSCORE_ENTRY && acceleration < 0) {
      return {
        type: "SELL",
        price: close,
        timestamp: bar.timestamp,
        reason: `Stat Arb SHORT: Z=${zScore.toFixed(2)}, velocity turning negative (accel=${acceleration.toFixed(3)}%)`,
      };
    }

    return null;
  }

  // ============================================================================
  // Private Helpers
  // ============================================================================

  /**
   * Compute standard deviation of a price array around a given mean.
   */
  private computeStdDev(prices: number[], mean: number): number {
    if (prices.length === 0) return 0;
    const squaredDiffs = prices.map((p) => (p - mean) ** 2);
    const avgSquaredDiff = squaredDiffs.reduce((a, b) => a + b, 0) / prices.length;
    return Math.sqrt(avgSquaredDiff);
  }
}

export const statArbStrategy = new StatArbStrategy();
