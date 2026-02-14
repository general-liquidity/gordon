/**
 * VWAP Bounce Strategy
 *
 * An intraday strategy that buys pullbacks to VWAP (Volume Weighted
 * Average Price), which acts as institutional fair value.
 *
 * Entry Conditions:
 * - Price within 0.5% of VWAP
 * - Previous candle(s) came from above VWAP (pullback)
 * - Not in a strong downtrend
 * - RSI not oversold (not capitulation)
 *
 * Confidence Boosters:
 * - Bounce with volume confirmation (+10%)
 * - RSI 40-50 (healthy pullback) (+10%)
 * - Multiple VWAP tests in session (+10%)
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

/** Maximum distance from VWAP for valid setup (percentage) */
const VWAP_TOUCH_THRESHOLD = 0.005; // 0.5%

/** RSI range for healthy pullback */
const RSI_PULLBACK_LOW = 35;
const RSI_PULLBACK_HIGH = 55;

// ============================================================================
// VWAP Bounce Strategy
// ============================================================================

export class VWAPBounceStrategy extends BaseStrategy {
  readonly id: StrategyId = "vwap_bounce";
  readonly name = "VWAP Bounce";
  readonly tier = 1 as const;
  readonly description =
    "Buy pullbacks to VWAP (Volume Weighted Average Price). " +
    "VWAP represents institutional fair value and acts as dynamic support.";
  readonly indicators = ["VWAP", "RSI", "Volume", "Price Action"];
  readonly timeframes = ["15m", "1h"];
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

    // Calculate VWAP
    const vwap = this.calculateVWAP(candles);
    if (!vwap.current) {
      return this.notDetected("Could not calculate VWAP");
    }

    // Check distance to VWAP
    const distanceToVWAP = Math.abs(currentPrice - vwap.current) / vwap.current;

    if (distanceToVWAP > VWAP_TOUCH_THRESHOLD) {
      return this.notDetected(
        `Price too far from VWAP (${(distanceToVWAP * 100).toFixed(2)}% vs ${VWAP_TOUCH_THRESHOLD * 100}% threshold)`
      );
    }

    // Check for pullback (price was above VWAP, came down)
    const isPullback = this.detectPullbackToVWAP(candles, vwap.values);
    if (!isPullback) {
      return this.notDetected("Not a pullback setup (price wasn't above VWAP)");
    }

    // Check RSI for healthy pullback (not capitulation)
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null && rsi.current < RSI_PULLBACK_LOW) {
      return this.notDetected(
        `RSI too low (${rsi.current.toFixed(1)} < ${RSI_PULLBACK_LOW}) - possible capitulation`
      );
    }

    // Check trend (avoid strong downtrends)
    const ema20 = this.calculateEMA(candles, 20);
    if (ema20.current && vwap.current < ema20.current * 0.98) {
      return this.notDetected("VWAP below EMA20 - bearish structure");
    }

    // Calculate confidence
    let confidence = 0.5;

    // RSI in sweet spot
    if (
      rsi.current !== null &&
      rsi.current >= RSI_PULLBACK_LOW &&
      rsi.current <= RSI_PULLBACK_HIGH
    ) {
      confidence += 0.1;
    }

    // Volume confirmation (increasing on bounce)
    const volumeTrend = this.analyzeVolumeTrend(candles, 5, 10);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // Multiple VWAP tests bonus
    const vwapTouchCount = this.countVWAPTouches(candles, vwap.values);
    if (vwapTouchCount >= 2) {
      confidence += 0.1;
    }

    // Price structure bonus (higher lows)
    const hasHigherLows = this.checkHigherLows(candles, 5);
    if (hasHigherLows) {
      confidence += 0.1;
    }

    // Bounce candle pattern
    const lastCandle = candles[candles.length - 1];
    const isBouncing =
      lastCandle &&
      lastCandle.close > lastCandle.open && // Bullish
      lastCandle.low <= vwap.current; // Wicked to VWAP
    if (isBouncing) {
      confidence += 0.1;
    }

    const signals = {
      vwap: vwap.current,
      distanceToVWAP: distanceToVWAP * 100,
      isPullback,
      vwapTouchCount,
      hasHigherLows,
      isBouncing,
      rsi: rsi.current,
      volumeTrend,
    };

    const reasons: string[] = [];
    reasons.push(`Price at VWAP ($${vwap.current.toFixed(2)})`);
    reasons.push("Pullback from above");
    if (vwapTouchCount >= 2) {
      reasons.push(`VWAP tested ${vwapTouchCount} times (strong level)`);
    }
    if (hasHigherLows) {
      reasons.push("Higher lows forming");
    }
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Detect if price pulled back to VWAP from above
   */
  private detectPullbackToVWAP(
    candles: { close: number; high: number }[],
    vwapValues: (number | null)[]
  ): boolean {
    // Look at last 10 candles
    const lookback = Math.min(10, candles.length);
    let wasAboveVWAP = false;

    for (let i = candles.length - lookback; i < candles.length - 1; i++) {
      const candle = candles[i];
      const vwap = vwapValues[i];
      if (candle && vwap && candle.close > vwap * 1.002) {
        wasAboveVWAP = true;
        break;
      }
    }

    return wasAboveVWAP;
  }

  /**
   * Count how many times price touched VWAP in recent candles
   */
  private countVWAPTouches(
    candles: { low: number; high: number }[],
    vwapValues: (number | null)[]
  ): number {
    let touches = 0;
    const threshold = 0.003; // 0.3% considered a touch

    for (let i = Math.max(0, candles.length - 20); i < candles.length; i++) {
      const candle = candles[i];
      const vwap = vwapValues[i];
      if (!candle || !vwap) continue;

      // Check if candle range includes VWAP
      if (candle.low <= vwap * (1 + threshold) && candle.high >= vwap * (1 - threshold)) {
        touches++;
      }
    }

    return touches;
  }

  /**
   * Check for higher lows pattern
   */
  private checkHigherLows(candles: { low: number }[], count: number): boolean {
    if (candles.length < count) return false;

    const recentCandles = candles.slice(-count);
    for (let i = 1; i < recentCandles.length; i++) {
      const current = recentCandles[i];
      const previous = recentCandles[i - 1];
      if (current && previous && current.low < previous.low) {
        return false; // Found a lower low
      }
    }
    return true;
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "1h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const vwap = this.calculateVWAP(candles);
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;

    // Stop-loss below recent swing low or 1 ATR
    const recentLow = Math.min(...candles.slice(-5).map((c) => c.low));
    const atrStop = atr.current ? entryPrice - atr.current : entryPrice * 0.98;
    const stopLoss = Math.max(recentLow * 0.995, atrStop);

    // Take-profits: VWAP-based targets
    const risk = entryPrice - stopLoss;
    const takeProfits = [
      { price: entryPrice + risk * 1.5, percentToSell: 0.4 },
      { price: entryPrice + risk * 2.5, percentToSell: 0.4 },
      { price: entryPrice + risk * 4, percentToSell: 0.2 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes: `VWAP bounce trade. VWAP at $${(vwap.current ?? 0).toFixed(2)}. ` +
        `Stop below recent swing at $${stopLoss.toFixed(2)}. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## VWAP Bounce Strategy Rules

When creating a plan using the VWAP Bounce strategy:

### Entry Rules
- Enter when price pulls back to VWAP from above
- Price should be within 0.5% of VWAP
- Look for bullish candle pattern at VWAP (hammer, engulfing)
- Best in first half of trading session

### Stop-Loss Rules
- Place stop below recent swing low (last 5 candles)
- Alternative: 1 ATR below VWAP
- If VWAP breaks convincingly, exit

### Take-Profit Rules
- TP1: 1.5:1 R:R (sell 40%)
- TP2: 2.5:1 R:R (sell 40%)
- TP3: 4:1 R:R or trail (sell 20%)

### Risk Management
- VWAP works best in liquid markets
- Avoid late in session when VWAP becomes less relevant
- Maximum position size: 5% of portfolio

### Best Conditions
- Trending days where VWAP acts as support
- High-volume liquid trading pairs
- After market open when VWAP has established
- Multiple previous bounces from VWAP same session
`;
  }

  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * BUY signal when:
   * - Price within 0.5% of VWAP (touching/near VWAP)
   * - RSI in healthy pullback range (35-55)
   * - Bullish candle (close > open) at VWAP
   *
   * SELL signal when:
   * - RSI > 70 (overbought)
   * - Price drops significantly below VWAP (> 1% below)
   */
  override generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    const price = bar.close;
    const { rsi14, vwap, sma20, nearestResistance } = indicators;

    // SELL signals (exit conditions)
    if (rsi14 != null && rsi14 > 70) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `RSI overbought at ${rsi14.toFixed(1)}`,
      };
    }

    if (nearestResistance != null && price >= nearestResistance) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `Price hit resistance at $${nearestResistance.toFixed(2)}`,
      };
    }

    // Price breaking well below VWAP — exit
    if (vwap != null && price < vwap * (1 - 0.01)) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: "Price broke below VWAP — support lost",
      };
    }

    // BUY signals (entry conditions)
    if (vwap != null) {
      const distanceToVWAP = Math.abs(price - vwap) / vwap;
      const isNearVWAP = distanceToVWAP <= VWAP_TOUCH_THRESHOLD;
      const isBullish = bar.close > bar.open;
      const rsiHealthy = rsi14 != null && rsi14 >= RSI_PULLBACK_LOW && rsi14 <= RSI_PULLBACK_HIGH;
      const aboveVWAP = price >= vwap;
      // VWAP should be above or near EMA20 (not bearish structure)
      const structureOk = sma20 == null || vwap >= sma20 * 0.98;

      if (isNearVWAP && isBullish && rsiHealthy && aboveVWAP && structureOk) {
        return {
          type: "BUY",
          price,
          timestamp: bar.timestamp,
          reason: `VWAP bounce: price ${(distanceToVWAP * 100).toFixed(2)}% from VWAP ($${vwap.toFixed(2)}), RSI ${rsi14!.toFixed(1)}`,
        };
      }
    }

    return null;
  }

  /**
   * Get required indicators for backtesting.
   */
  override getRequiredIndicators(): string[] {
    return [
      "vwap",
      "sma20",
      "rsi14",
      "atr14",
      "volumeRatio",
      "nearestResistance",
    ];
  }
}

export const vwapBounceStrategy = new VWAPBounceStrategy();
