/**
 * Relative Strength Strategy
 *
 * An intermediate strategy that identifies altcoins outperforming
 * Bitcoin, as relative strength often leads to continued outperformance.
 *
 * Entry Conditions:
 * - Coin's 7-day return > BTC's 7-day return
 * - Coin making higher highs while BTC flat/down
 * - RSI not overbought (< 70)
 * - Volume increasing
 *
 * Confidence Boosters:
 * - Significant outperformance (>5% delta) (+15%)
 * - Sustained outperformance (14-day also better) (+10%)
 * - Rising volume during outperformance (+10%)
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

/** Minimum outperformance vs BTC (percentage) */
const MIN_OUTPERFORMANCE = 2;

/** Strong outperformance threshold */
const STRONG_OUTPERFORMANCE = 5;

/** RSI overbought threshold */
const RSI_OVERBOUGHT = 70;

/** Lookback period in candles (for 4h, ~7 days) */
const LOOKBACK_7D = 42;

/** Extended lookback (14 days) */
const LOOKBACK_14D = 84;

// ============================================================================
// Relative Strength Strategy
// ============================================================================

export class RelativeStrengthStrategy extends BaseStrategy {
  readonly id: StrategyId = "relative_strength";
  readonly name = "Relative Strength";
  readonly tier = 2 as const;
  readonly description =
    "Buy altcoins outperforming Bitcoin. Relative strength indicates " +
    "institutional interest and often continues.";
  readonly indicators = ["RS vs BTC", "Price Action", "RSI", "Volume"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    // Skip BTC itself
    if (symbol.toUpperCase().startsWith("BTC")) {
      return this.notDetected("Cannot compare BTC to itself");
    }

    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < LOOKBACK_7D) {
      return this.notDetected(`Insufficient data (need ${LOOKBACK_7D}+ candles)`);
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Fetch BTC candles for comparison
    let btcCandles;
    try {
      btcCandles = await this.fetchCandles(ctx, "BTCUSDT", timeframe, 100);
    } catch {
      return this.notDetected("Could not fetch BTC data for comparison");
    }

    if (btcCandles.length < LOOKBACK_7D) {
      return this.notDetected("Insufficient BTC data for comparison");
    }

    // Calculate returns
    const coinReturn7d = this.calculateReturn(candles, LOOKBACK_7D);
    const btcReturn7d = this.calculateReturn(btcCandles, LOOKBACK_7D);
    const outperformance7d = coinReturn7d - btcReturn7d;

    if (outperformance7d < MIN_OUTPERFORMANCE) {
      return this.notDetected(
        `Not outperforming BTC (${outperformance7d.toFixed(1)}% < ${MIN_OUTPERFORMANCE}%)`
      );
    }

    // Check RSI not overbought
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null && rsi.current > RSI_OVERBOUGHT) {
      return this.notDetected(
        `RSI overbought (${rsi.current.toFixed(1)} > ${RSI_OVERBOUGHT})`
      );
    }

    // Calculate 14-day return if enough data
    let outperformance14d: number | null = null;
    if (candles.length >= LOOKBACK_14D && btcCandles.length >= LOOKBACK_14D) {
      const coinReturn14d = this.calculateReturn(candles, LOOKBACK_14D);
      const btcReturn14d = this.calculateReturn(btcCandles, LOOKBACK_14D);
      outperformance14d = coinReturn14d - btcReturn14d;
    }

    // Calculate RS ratio (coin/BTC)
    const rsRatio = this.calculateRSRatio(candles, btcCandles, 20);

    // Calculate confidence
    let confidence = 0.5;

    // Outperformance magnitude bonus
    if (outperformance7d >= STRONG_OUTPERFORMANCE) {
      confidence += 0.15;
    } else {
      confidence += (outperformance7d - MIN_OUTPERFORMANCE) / (STRONG_OUTPERFORMANCE - MIN_OUTPERFORMANCE) * 0.1;
    }

    // Sustained outperformance bonus
    if (outperformance14d !== null && outperformance14d > 0) {
      confidence += 0.1;
    }

    // RS ratio rising bonus
    if (rsRatio.trend === "rising") {
      confidence += 0.1;
    }

    // Volume bonus
    const volumeTrend = this.analyzeVolumeTrend(candles);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // RSI healthy range bonus
    if (rsi.current !== null && rsi.current >= 50 && rsi.current <= 65) {
      confidence += 0.05;
    }

    const signals = {
      coinReturn7d,
      btcReturn7d,
      outperformance7d,
      outperformance14d,
      rsRatioCurrent: rsRatio.current,
      rsRatioTrend: rsRatio.trend,
      rsi: rsi.current,
      volumeTrend,
    };

    const reasons: string[] = [];
    reasons.push(
      `Outperforming BTC by ${outperformance7d.toFixed(1)}% (7d)`
    );
    reasons.push(`Coin: ${coinReturn7d >= 0 ? "+" : ""}${coinReturn7d.toFixed(1)}% vs BTC: ${btcReturn7d >= 0 ? "+" : ""}${btcReturn7d.toFixed(1)}%`);
    if (outperformance14d !== null) {
      reasons.push(`14d outperformance: ${outperformance14d.toFixed(1)}%`);
    }
    reasons.push(`RS ratio ${rsRatio.trend}`);
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Calculate return over lookback period
   */
  private calculateReturn(
    candles: { close: number }[],
    lookback: number
  ): number {
    const startIdx = Math.max(0, candles.length - lookback);
    const startPrice = candles[startIdx]?.close ?? 0;
    const endPrice = candles[candles.length - 1]?.close ?? 0;

    if (startPrice === 0) return 0;
    return ((endPrice - startPrice) / startPrice) * 100;
  }

  /**
   * Calculate RS ratio (coin price / BTC price) and its trend
   */
  private calculateRSRatio(
    coinCandles: { close: number }[],
    btcCandles: { close: number }[],
    period: number
  ): { current: number; trend: "rising" | "falling" | "flat" } {
    const minLen = Math.min(coinCandles.length, btcCandles.length);
    const ratios: number[] = [];

    for (let i = Math.max(0, minLen - period); i < minLen; i++) {
      const coinPrice = coinCandles[i]?.close ?? 0;
      const btcPrice = btcCandles[i]?.close ?? 1;
      if (btcPrice > 0) {
        ratios.push(coinPrice / btcPrice);
      }
    }

    if (ratios.length < 5) {
      return { current: 0, trend: "flat" };
    }

    const current = ratios[ratios.length - 1] ?? 0;
    const firstHalf = ratios.slice(0, Math.floor(ratios.length / 2));
    const secondHalf = ratios.slice(Math.floor(ratios.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    let trend: "rising" | "falling" | "flat" = "flat";
    if (secondAvg > firstAvg * 1.02) {
      trend = "rising";
    } else if (secondAvg < firstAvg * 0.98) {
      trend = "falling";
    }

    return { current, trend };
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const atr = this.calculateATR(candles);
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);

    const entryPrice = currentPrice;

    // Stop-loss at recent swing low or support
    const recentLow = Math.min(...candles.slice(-10).map((c) => c.low));
    const supportStop = supports[0]?.price ? supports[0].price * 0.98 : entryPrice * 0.92;
    const stopLoss = Math.max(recentLow * 0.99, supportStop);

    // Take-profits (RS trades can run)
    const risk = entryPrice - stopLoss;
    const takeProfits = [
      { price: entryPrice + risk * 2, percentToSell: 0.3 },
      { price: entryPrice + risk * 4, percentToSell: 0.35 },
      { price: entryPrice + risk * 7, percentToSell: 0.35 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes: `Relative strength trade vs BTC. Stop at $${stopLoss.toFixed(2)}. ` +
        `Monitor RS ratio for exit signals. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Relative Strength Strategy Rules

When creating a plan using the Relative Strength strategy:

### Entry Rules
- Enter when coin outperforms BTC by 2%+ over 7 days
- RSI must be below 70 (not overbought)
- RS ratio should be rising (sustained outperformance)
- Prefer coins also showing strong absolute performance

### Stop-Loss Rules
- Place stop below recent swing low (10 candles)
- Or 8% below entry for wider stop
- Exit if RS ratio starts falling

### Take-Profit Rules
- TP1: 2:1 R:R (sell 30%)
- TP2: 4:1 R:R (sell 35%)
- TP3: 7:1 R:R or RS reversal (sell 35%)
- RS leaders can produce large moves

### Risk Management
- Monitor BTC - if BTC dumps, most alts follow
- Exit early if RS ratio reverses
- Exit if coin starts underperforming BTC
- Maximum position size: 4% of portfolio

### Best Conditions
- Altcoin season (BTC dominance falling)
- Risk-on market environment
- When BTC is consolidating
- Sector rotation phases
`;
  }
  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * Since backtest runs on a single asset (no BTC comparison data available),
   * we approximate relative strength using momentum indicators:
   *
   * BUY signal when:
   * - Price above SMA50 (trending up)
   * - RSI between 45-65 (healthy momentum, not overbought)
   * - Volume ratio > 1.2 (increasing participation)
   * - Price above EMA26 (short-term momentum positive)
   *
   * SELL signal when:
   * - RSI > 70 (overbought, likely to revert)
   * - Price drops below SMA50 (trend reversal / RS loss)
   */
  override generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    const price = bar.close;
    const { rsi14, sma50, ema26, volumeRatio } = indicators;

    // Check SELL signal first (exit conditions)
    if (rsi14 != null && rsi14 > 70) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `RSI overbought at ${rsi14.toFixed(1)} — momentum exhaustion`,
      };
    }

    if (sma50 != null && price < sma50) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `Price below SMA50 ($${sma50.toFixed(2)}) — trend weakening`,
      };
    }

    // Check BUY signal — strong momentum proxy for relative strength
    const aboveSma50 = sma50 != null && price > sma50;
    const rsiHealthy = rsi14 != null && rsi14 >= 45 && rsi14 <= 65;
    const aboveEma26 = ema26 != null && price > ema26;
    const volumeOk = volumeRatio != null && volumeRatio >= 1.2;

    if (aboveSma50 && rsiHealthy && aboveEma26 && volumeOk) {
      return {
        type: "BUY",
        price,
        timestamp: bar.timestamp,
        reason: `Strong momentum: above SMA50, RSI ${rsi14!.toFixed(1)}, volume ${volumeRatio!.toFixed(1)}x`,
      };
    }

    return null;
  }

  /**
   * Get required indicators for backtesting.
   */
  override getRequiredIndicators(): string[] {
    return [
      "sma50",
      "ema26",
      "rsi14",
      "atr14",
      "volumeRatio",
      "volumeAvg20",
      "nearestSupport",
      "nearestResistance",
    ];
  }
}

export const relativeStrengthStrategy = new RelativeStrengthStrategy();
