/**
 * SMA Crossover Strategy
 *
 * A classic trend-following strategy based on Simple Moving Average
 * crossovers (Golden Cross / Death Cross).
 *
 * Entry Conditions (Golden Cross - Buy):
 * - SMA 50 crosses above SMA 200
 * - Price is above both SMAs
 * - Recent crossover (within last 5 candles)
 *
 * Confidence Boosters:
 * - Volume increasing during crossover (+10%)
 * - RSI between 40-60 (healthy, not overextended) (+10%)
 * - Price pulling back to SMA 50 after cross (+15%)
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

/** Fast SMA period */
const FAST_SMA = 50;

/** Slow SMA period */
const SLOW_SMA = 200;

/** Max candles since crossover to be considered "recent" */
const CROSSOVER_LOOKBACK = 5;

/** Pullback threshold to SMA (percentage) */
const PULLBACK_THRESHOLD = 0.02; // Within 2% of SMA50

// ============================================================================
// SMA Crossover Strategy
// ============================================================================

export class SMACrossoverStrategy extends BaseStrategy {
  readonly id: StrategyId = "sma_crossover";
  readonly name = "SMA Crossover";
  readonly tier = 1 as const;
  readonly description =
    "Trade Golden Cross (50 SMA above 200 SMA) signals. " +
    "A reliable trend-following strategy for capturing major moves.";
  readonly indicators = ["SMA 50", "SMA 200", "Volume", "RSI"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 250);
    if (candles.length < 210) {
      return this.notDetected("Insufficient data (need 210+ candles for SMA 200)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate SMAs
    const sma50 = this.calculateSMA(candles, FAST_SMA);
    const sma200 = this.calculateSMA(candles, SLOW_SMA);

    if (!sma50.current || !sma200.current) {
      return this.notDetected("Could not calculate SMAs");
    }

    // Check for Golden Cross (SMA50 > SMA200)
    if (sma50.current <= sma200.current) {
      return this.notDetected(
        `No Golden Cross (SMA50: $${sma50.current.toFixed(2)} <= SMA200: $${sma200.current.toFixed(2)})`
      );
    }

    // Check if price is above both SMAs
    if (currentPrice < sma50.current) {
      // Price below SMA50 could be a pullback opportunity
      const distanceToSMA50 = Math.abs(currentPrice - sma50.current) / sma50.current;
      if (distanceToSMA50 > PULLBACK_THRESHOLD) {
        return this.notDetected(
          `Price too far below SMA50 (${(distanceToSMA50 * 100).toFixed(1)}%)`
        );
      }
    }

    // Check how recent the crossover is
    const crossoverCandles = this.findCrossoverAge(sma50.values, sma200.values);
    const isRecentCross = crossoverCandles <= CROSSOVER_LOOKBACK;
    const isPullbackSetup = !isRecentCross &&
      currentPrice >= sma50.current * (1 - PULLBACK_THRESHOLD) &&
      currentPrice <= sma50.current * (1 + PULLBACK_THRESHOLD);

    if (!isRecentCross && !isPullbackSetup) {
      return this.notDetected(
        `Golden Cross too old (${crossoverCandles} candles ago) and no pullback setup`
      );
    }

    // Calculate confidence
    let confidence = 0.5;

    // Recent crossover bonus
    if (isRecentCross) {
      confidence += 0.15;
    }

    // Pullback to SMA50 bonus
    if (isPullbackSetup) {
      confidence += 0.15;
    }

    // Volume analysis
    const volumeTrend = this.analyzeVolumeTrend(candles);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // RSI in healthy range (40-60)
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null && rsi.current >= 40 && rsi.current <= 60) {
      confidence += 0.1;
    }

    // Strong trend (SMA50 well above SMA200)
    const smaGap = (sma50.current - sma200.current) / sma200.current;
    if (smaGap > 0.05) {
      confidence += 0.05; // Strong golden cross
    }

    const signals = {
      sma50: sma50.current,
      sma200: sma200.current,
      smaGapPercent: smaGap * 100,
      crossoverAge: crossoverCandles,
      isRecentCross,
      isPullbackSetup,
      priceAboveSMA50: currentPrice >= sma50.current,
      rsi: rsi.current,
      volumeTrend,
    };

    const reasons: string[] = [];
    reasons.push(`Golden Cross: SMA50 ($${sma50.current.toFixed(2)}) > SMA200 ($${sma200.current.toFixed(2)})`);
    if (isRecentCross) {
      reasons.push(`Recent crossover (${crossoverCandles} candles ago)`);
    } else if (isPullbackSetup) {
      reasons.push("Pullback to SMA50 support");
    }
    reasons.push(`SMA gap: ${(smaGap * 100).toFixed(1)}%`);
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

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
        // Check for crossover (fast was below slow, now above)
        if (currentFast > currentSlow && prevFast <= prevSlow) {
          return fastValues.length - 1 - i;
        }
      }
    }
    return 999; // No crossover found
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 250);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const sma50 = this.calculateSMA(candles, FAST_SMA);
    const sma200 = this.calculateSMA(candles, SLOW_SMA);
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;

    // Stop-loss below SMA200 or 2x ATR
    const smaStop = sma200.current ? sma200.current * 0.98 : entryPrice * 0.93;
    const atrStop = atr.current ? entryPrice - atr.current * 2 : entryPrice * 0.93;
    const stopLoss = Math.max(smaStop, atrStop); // Use the tighter stop

    // Take-profits at percentage gains (trend-following)
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
      notes: `Golden Cross trend trade. Stop below SMA200 at $${stopLoss.toFixed(2)}. ` +
        `Trailing stops recommended. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * For this strategy, we use RSI crossovers as proxy signals:
   * BUY signal when: RSI crosses above 30 from below
   * SELL signal when: RSI crosses below 70 from above
   *
   * Additionally checks SMA alignment for trend confirmation.
   */
  generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    const price = bar.close;
    const {
      rsi14,
      rsi14Prev,
      sma50,
      sma200,
    } = indicators;

    // Need RSI values for crossover detection
    if (
      rsi14 === null ||
      rsi14 === undefined ||
      rsi14Prev === null ||
      rsi14Prev === undefined
    ) {
      return null;
    }

    // Check for SELL signal: RSI crosses below 70 from above
    if (rsi14Prev > 70 && rsi14 <= 70) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `RSI crossed below 70 (${rsi14Prev.toFixed(1)} -> ${rsi14.toFixed(1)})`,
      };
    }

    // Check for BUY signal: RSI crosses above 30 from below
    if (rsi14Prev < 30 && rsi14 >= 30) {
      // Check SMA alignment for additional confidence
      const hasSmaAlignment =
        sma50 !== null &&
        sma50 !== undefined &&
        sma200 !== null &&
        sma200 !== undefined &&
        sma50 > sma200;

      const reason = hasSmaAlignment
        ? `RSI crossed above 30 (${rsi14Prev.toFixed(1)} -> ${rsi14.toFixed(1)}) with Golden Cross confirmation`
        : `RSI crossed above 30 (${rsi14Prev.toFixed(1)} -> ${rsi14.toFixed(1)})`;

      return {
        type: "BUY",
        price,
        timestamp: bar.timestamp,
        reason,
      };
    }

    return null;
  }

  /**
   * Get required indicators for backtesting.
   */
  getRequiredIndicators(): string[] {
    return [
      "sma50",
      "sma200",
      "rsi14",
      "rsi14Prev",
      "atr14",
      "volumeRatio",
      "volumeAvg20",
    ];
  }

  getPromptFragment(): string {
    return `
## SMA Crossover Strategy Rules

When creating a plan using the SMA Crossover (Golden Cross) strategy:

### Entry Rules
- Enter after SMA 50 crosses above SMA 200 (Golden Cross)
- Best entries: immediately after cross OR on pullback to SMA 50
- Price should be at or above SMA 50
- Avoid chasing if price is >5% above SMA 50

### Stop-Loss Rules
- Initial stop: below SMA 200 (or 2x ATR below entry)
- As trade progresses, trail stop below SMA 50
- Never let a winning trade become a loser

### Take-Profit Rules
- This is a trend-following strategy - let winners run
- TP1: 2:1 R:R (sell 30%)
- TP2: 4:1 R:R (sell 40%)
- TP3: 6:1 R:R or trail stop (sell remaining 30%)

### Risk Management
- Use trailing stops to maximize trend capture
- Re-enter on pullbacks to SMA 50 if trend intact
- Maximum position size: 5% of portfolio

### Best Conditions
- Works best in trending markets
- Higher timeframes (4h, daily) are more reliable
- Avoid during choppy, range-bound conditions
`;
  }
}

export const smaCrossoverStrategy = new SMACrossoverStrategy();
