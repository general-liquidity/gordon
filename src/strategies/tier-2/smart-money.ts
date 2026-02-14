/**
 * Smart Money / Liquidity Sweep Strategy (ICT)
 *
 * Detects stop hunts where price sweeps past previous highs/lows
 * to trigger stop losses, then reverses as smart money enters.
 *
 * Entry Conditions:
 * - Bullish sweep: price breaks below recent low then closes back above
 * - Bearish sweep: price breaks above recent high then closes back below
 * - Volume spike on the sweep candle confirms institutional activity
 *
 * Confidence Boosters:
 * - Volume spike >2x avg (+15%)
 * - Immediate reversal candle (+10%)
 * - RSI divergence (+10%)
 * - Multiple sweeps at same level (+10%)
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
} from "../types.ts";
import type { Candle } from "../../core/indicators/types.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Types
// ============================================================================

interface SwingPoint {
  price: number;
  index: number;
  type: "high" | "low";
}

interface LiquiditySweep {
  type: "bullish" | "bearish";
  sweptLevel: number;
  sweepExtreme: number;
  closeAfterSweep: number;
  sweepIndex: number;
  volumeRatio: number;
}

// ============================================================================
// Constants
// ============================================================================

const SWING_LOOKBACK = 15;
const VOLUME_SPIKE_RATIO = 2.0;
const MIN_SWING_POINTS = 2;

// ============================================================================
// Smart Money Strategy
// ============================================================================

export class SmartMoneyStrategy extends BaseStrategy {
  readonly id: StrategyId = "smart_money";
  readonly name = "Smart Money Sweep (ICT)";
  readonly tier = 2 as const;
  readonly description =
    "Detect liquidity sweeps where price hunts stop losses beyond previous highs/lows, " +
    "then reverses. Trade the reversal after smart money grabs liquidity.";
  readonly indicators = ["ATR", "RSI", "Volume", "Price Action", "Structure"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "high" as const;

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

    // Find swing points
    const swingPoints = this.findSwingPoints(candles, SWING_LOOKBACK);
    if (swingPoints.length < MIN_SWING_POINTS) {
      return this.notDetected("Not enough swing points for liquidity analysis");
    }

    // Calculate average volume for comparison
    const avgVolume = this.getAverageVolume(candles, 20);

    // Look for recent liquidity sweeps (last 5 candles)
    const sweeps = this.findLiquiditySweeps(candles, swingPoints, avgVolume, 5);
    if (sweeps.length === 0) {
      return this.notDetected("No recent liquidity sweeps detected");
    }

    // Pick the most recent sweep
    const bestSweep = sweeps[0]!;

    // Verify the reversal — price should have closed back on the "right" side
    const hasReversed =
      (bestSweep.type === "bullish" && bestSweep.closeAfterSweep > bestSweep.sweptLevel) ||
      (bestSweep.type === "bearish" && bestSweep.closeAfterSweep < bestSweep.sweptLevel);

    if (!hasReversed) {
      return this.notDetected("Sweep detected but no reversal confirmation yet");
    }

    // Calculate confidence
    let confidence = 0.5;

    // Volume spike bonus
    if (bestSweep.volumeRatio >= VOLUME_SPIKE_RATIO) {
      confidence += 0.15;
    } else if (bestSweep.volumeRatio >= 1.5) {
      confidence += 0.08;
    }

    // Immediate reversal (next candle after sweep is opposing)
    const sweepIdx = bestSweep.sweepIndex;
    if (sweepIdx + 1 < candles.length) {
      const nextCandle = candles[sweepIdx + 1]!;
      const isReversalCandle =
        (bestSweep.type === "bullish" && nextCandle.close > nextCandle.open) ||
        (bestSweep.type === "bearish" && nextCandle.close < nextCandle.open);
      if (isReversalCandle) {
        confidence += 0.1;
      }
    }

    // RSI divergence check
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null) {
      const rsiDivergence =
        (bestSweep.type === "bullish" && rsi.current < 40) ||
        (bestSweep.type === "bearish" && rsi.current > 60);
      if (rsiDivergence) {
        confidence += 0.1;
      }
    }

    // Multiple sweeps at same level
    const sameLevelSweeps = sweeps.filter((s) =>
      Math.abs(s.sweptLevel - bestSweep.sweptLevel) < (candles[candles.length - 1]!.high - candles[candles.length - 1]!.low) * 0.5
    );
    if (sameLevelSweeps.length >= 2) {
      confidence += 0.1;
    }

    const signals = {
      sweepType: bestSweep.type,
      sweptLevel: bestSweep.sweptLevel,
      sweepExtreme: bestSweep.sweepExtreme,
      volumeRatio: bestSweep.volumeRatio,
      sweepDepth: Math.abs(bestSweep.sweepExtreme - bestSweep.sweptLevel),
      sweepsAtLevel: sameLevelSweeps.length,
      rsi: rsi.current,
    };

    const reasons: string[] = [];
    reasons.push(
      `${bestSweep.type} liquidity sweep past ${bestSweep.sweptLevel.toFixed(2)}`
    );
    reasons.push(
      `Swept to ${bestSweep.sweepExtreme.toFixed(2)} then reversed (vol: ${bestSweep.volumeRatio.toFixed(1)}x avg)`
    );
    if (sameLevelSweeps.length >= 2) {
      reasons.push(`${sameLevelSweeps.length} sweeps at this level`);
    }
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Find swing highs and lows
   */
  private findSwingPoints(candles: Candle[], lookback: number): SwingPoint[] {
    const points: SwingPoint[] = [];

    for (let i = lookback; i < candles.length - lookback; i++) {
      const current = candles[i]!;

      // Check if swing high
      let isSwingHigh = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j]!.high >= current.high) {
          isSwingHigh = false;
          break;
        }
      }
      if (isSwingHigh) {
        points.push({ price: current.high, index: i, type: "high" });
      }

      // Check if swing low
      let isSwingLow = true;
      for (let j = i - lookback; j <= i + lookback; j++) {
        if (j === i) continue;
        if (candles[j]!.low <= current.low) {
          isSwingLow = false;
          break;
        }
      }
      if (isSwingLow) {
        points.push({ price: current.low, index: i, type: "low" });
      }
    }

    return points;
  }

  /**
   * Find liquidity sweeps in recent candles
   */
  private findLiquiditySweeps(
    candles: Candle[],
    swingPoints: SwingPoint[],
    avgVolume: number,
    recentWindow: number
  ): LiquiditySweep[] {
    const sweeps: LiquiditySweep[] = [];
    const startIdx = Math.max(0, candles.length - recentWindow);

    for (let i = startIdx; i < candles.length; i++) {
      const candle = candles[i]!;
      const volumeRatio = avgVolume > 0 ? candle.volume / avgVolume : 1;

      // Check for bullish sweep (break below swing low then close above)
      const swingLows = swingPoints.filter((p) => p.type === "low" && p.index < i);
      for (const sl of swingLows) {
        if (candle.low < sl.price && candle.close > sl.price) {
          sweeps.push({
            type: "bullish",
            sweptLevel: sl.price,
            sweepExtreme: candle.low,
            closeAfterSweep: candle.close,
            sweepIndex: i,
            volumeRatio,
          });
        }
      }

      // Check for bearish sweep (break above swing high then close below)
      const swingHighs = swingPoints.filter((p) => p.type === "high" && p.index < i);
      for (const sh of swingHighs) {
        if (candle.high > sh.price && candle.close < sh.price) {
          sweeps.push({
            type: "bearish",
            sweptLevel: sh.price,
            sweepExtreme: candle.high,
            closeAfterSweep: candle.close,
            sweepIndex: i,
            volumeRatio,
          });
        }
      }
    }

    // Sort by most recent first
    return sweeps.sort((a, b) => b.sweepIndex - a.sweepIndex);
  }

  /**
   * Calculate average volume
   */
  private getAverageVolume(candles: Candle[], period: number): number {
    const slice = candles.slice(-period);
    return slice.reduce((sum, c) => sum + c.volume, 0) / slice.length;
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.02;

    const swingPoints = this.findSwingPoints(candles, SWING_LOOKBACK);
    const avgVolume = this.getAverageVolume(candles, 20);
    const sweeps = this.findLiquiditySweeps(candles, swingPoints, avgVolume, 10);
    const bestSweep = sweeps[0];

    const entryPrice = bestSweep ? bestSweep.sweptLevel : currentPrice;
    const stopLoss = bestSweep
      ? bestSweep.sweepExtreme + (bestSweep.type === "bullish" ? -atrVal * 0.5 : atrVal * 0.5)
      : currentPrice - atrVal * 2;

    const risk = Math.abs(entryPrice - stopLoss);
    const takeProfits = [
      { price: entryPrice + risk * 2, percentToSell: 0.3 },
      { price: entryPrice + risk * 3, percentToSell: 0.4 },
      { price: entryPrice + risk * 5, percentToSell: 0.3 },
    ];

    const avgTp = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTp);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Smart money sweep trade. Entry at swept level $${entryPrice.toFixed(2)}. ` +
        `Stop beyond sweep wick + 0.5 ATR at $${stopLoss.toFixed(2)}. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  getPromptFragment(): string {
    return `
## Smart Money Sweep (ICT) Strategy Rules

When creating a plan using the Smart Money strategy:

### Entry Rules
- Enter after price sweeps past a swing high/low and reverses
- Bullish: price breaks below swing low, then closes back above
- Bearish: price breaks above swing high, then closes back below
- Wait for the reversal candle to close before entering

### Stop-Loss Rules
- Place stop beyond the sweep wick + 0.5x ATR
- This accounts for potential re-tests of the swept level

### Take-Profit Rules
- TP1: 2:1 R:R (sell 30%)
- TP2: 3:1 R:R (sell 40%)
- TP3: 5:1 R:R (sell 30%)

### Risk Management
- Volume spike on the sweep confirms institutional activity
- RSI divergence at the sweep increases probability
- Multiple sweeps at the same level = very high probability
- This is a counter-trend entry — use smaller position sizes
- Wait for the reversal candle to close before committing
`;
  }
  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  /**
   * Generate trading signal for backtesting.
   *
   * Detects liquidity sweeps from raw OHLC data:
   * 1. Find swing lows/highs in recent history (using a 5-bar lookback for speed)
   * 2. Current bar sweeps below a swing low (wick below) but closes above it = bullish sweep
   * 3. Current bar sweeps above a swing high (wick above) but closes below it = bearish sweep
   *
   * BUY signal when:
   * - Bullish liquidity sweep detected (stop hunt below swing low, reversal close)
   * - RSI < 60 (not overbought)
   * - Volume ratio > 1.5 (institutional volume spike)
   *
   * SELL signal when:
   * - Bearish liquidity sweep detected
   * - RSI > 65
   */
  override generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    const price = bar.close;
    const { rsi14, volumeRatio } = indicators;

    // Need enough history for swing detection
    const swingLookback = 5;
    if (_index < swingLookback * 2 + 2) return null;

    // Find recent swing lows (local minima)
    for (let i = _index - swingLookback - 1; i >= Math.max(swingLookback, _index - 30); i--) {
      let isSwingLow = true;
      let isSwingHigh = true;
      const candidate = _data[i]!;

      for (let j = i - swingLookback; j <= i + swingLookback; j++) {
        if (j === i || j < 0 || j >= _index) { continue; }
        if (_data[j]!.low <= candidate.low) { isSwingLow = false; }
        if (_data[j]!.high >= candidate.high) { isSwingHigh = false; }
      }

      // Bullish sweep: bar wicks below swing low but closes above it
      if (isSwingLow && bar.low < candidate.low && bar.close > candidate.low) {
        const rsiOk = rsi14 != null ? rsi14 < 60 : true;
        const volumeOk = volumeRatio != null ? volumeRatio >= 1.5 : true;

        if (rsiOk && volumeOk) {
          return {
            type: "BUY",
            price,
            timestamp: bar.timestamp,
            reason: `Bullish sweep below $${candidate.low.toFixed(2)}, reversed to $${price.toFixed(2)}${volumeRatio != null ? `, vol ${volumeRatio.toFixed(1)}x` : ""}`,
          };
        }
      }

      // Bearish sweep: bar wicks above swing high but closes below it
      if (isSwingHigh && bar.high > candidate.high && bar.close < candidate.high) {
        const rsiConfirm = rsi14 != null ? rsi14 > 65 : true;
        const volumeOk = volumeRatio != null ? volumeRatio >= 1.5 : true;

        if (rsiConfirm && volumeOk) {
          return {
            type: "SELL",
            price,
            timestamp: bar.timestamp,
            reason: `Bearish sweep above $${candidate.high.toFixed(2)}, reversed to $${price.toFixed(2)}${volumeRatio != null ? `, vol ${volumeRatio.toFixed(1)}x` : ""}`,
          };
        }
      }
    }

    // Fallback SELL: RSI extreme overbought
    if (rsi14 != null && rsi14 > 75) {
      return {
        type: "SELL",
        price,
        timestamp: bar.timestamp,
        reason: `RSI extreme overbought at ${rsi14.toFixed(1)}`,
      };
    }

    return null;
  }

  /**
   * Get required indicators for backtesting.
   */
  override getRequiredIndicators(): string[] {
    return [
      "rsi14",
      "atr14",
      "volumeRatio",
      "volumeAvg20",
      "nearestSupport",
      "nearestResistance",
    ];
  }
}

export const smartMoneyStrategy = new SmartMoneyStrategy();
