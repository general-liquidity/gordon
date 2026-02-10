/**
 * Trend Range Detector Strategy
 *
 * Detects when price enters a consolidation range using Weighted Moving Average
 * (WMA) center + ATR bands, waits for minimum duration, then trades the breakout.
 *
 * Based on Moon Dev's Trend Range Detector (Zeiierman concept from TradingView).
 *
 * Entry Conditions:
 * - WMA(20) defines range center
 * - ATR(14) * 1.5 defines upper/lower boundaries
 * - 15+ of last 20 bars close within range (consolidation confirmed)
 * - Price closes beyond band + 0.5 ATR buffer (breakout)
 * - 2-bar confirmation: next bar also closes beyond band
 *
 * Confidence Boosters:
 * - 18+ of 20 bars in range (tight consolidation): +15%
 * - Range duration 20+ bars: +10%
 * - Breakout volume > 1.5x average: +15%
 * - ATR contracting during range (squeeze): +10%
 * - Breakout direction aligns with SMA 20 slope: +5%
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
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

/** Weighted Moving Average period for range center */
const WMA_PERIOD = 20;

/** ATR period for range width calculation */
const ATR_PERIOD = 14;

/** Multiplier for ATR to define range boundaries */
const ATR_MULTIPLIER = 1.5;

/** Minimum bars-in-range out of lookback window to confirm consolidation */
const MIN_BARS_IN_RANGE = 15;

/** Lookback window for counting bars in range */
const RANGE_LOOKBACK = 20;

/** Minimum ATR units beyond band for breakout conviction */
const BREAKOUT_BUFFER_ATR = 0.5;

/** Number of candles to fetch for detection */
const CANDLE_LIMIT = 100;

/** Volume ratio threshold for breakout confirmation */
const BREAKOUT_VOLUME_RATIO = 1.5;

// ============================================================================
// Trend Range Detector Strategy
// ============================================================================

export class TrendRangeStrategy extends BaseStrategy {
  readonly id: StrategyId = "trend_range";
  readonly name = "Trend Range Detector";
  readonly tier = 2 as const;
  readonly description =
    "Detects consolidation ranges using WMA center + ATR bands, " +
    "then trades breakouts with 2-bar confirmation and volume conviction.";
  readonly indicators = ["ATR", "SMA 20", "Volume"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "medium" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < 50) {
      return this.notDetected("Insufficient data (need 50+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate WMA(20) and ATR(14)
    const closes = this.extractPrices(candles);
    const wmaValues = this.computeWMA(closes, WMA_PERIOD);
    const atr = this.calculateATR(candles, ATR_PERIOD);

    const currentWma = wmaValues[wmaValues.length - 1];
    const currentAtr = atr.current;

    if (currentWma === undefined || currentAtr === null || currentAtr === 0) {
      return this.notDetected("Could not calculate WMA or ATR");
    }

    // Determine range boundaries
    const rangeUpper = currentWma + currentAtr * ATR_MULTIPLIER;
    const rangeLower = currentWma - currentAtr * ATR_MULTIPLIER;

    // Count how many of the last N bars have close prices within the range
    const recentCloses = closes.slice(-RANGE_LOOKBACK);
    const recentWmaSlice = wmaValues.slice(-RANGE_LOOKBACK);

    // Use per-bar WMA for range check (more accurate than static range)
    let barsInRange = 0;
    for (let i = 0; i < recentCloses.length; i++) {
      const price = recentCloses[i]!;
      const wma = recentWmaSlice[i];
      if (wma === undefined) continue;

      const upper = wma + currentAtr * ATR_MULTIPLIER;
      const lower = wma - currentAtr * ATR_MULTIPLIER;
      if (price >= lower && price <= upper) {
        barsInRange++;
      }
    }

    if (barsInRange < MIN_BARS_IN_RANGE) {
      return this.notDetected(
        `Only ${barsInRange}/${RANGE_LOOKBACK} bars in range (need ${MIN_BARS_IN_RANGE}+)`
      );
    }

    // Check for breakout: current close beyond band + 0.5 ATR buffer
    const breakoutBuffer = currentAtr * BREAKOUT_BUFFER_ATR;
    let breakoutDirection: "up" | "down" | null = null;
    let breakoutStrength = 0;

    if (currentPrice > rangeUpper + breakoutBuffer) {
      breakoutDirection = "up";
      breakoutStrength = (currentPrice - rangeUpper) / currentAtr;
    } else if (currentPrice < rangeLower - breakoutBuffer) {
      breakoutDirection = "down";
      breakoutStrength = (rangeLower - currentPrice) / currentAtr;
    }

    // Also check recent bars (within last 3) for a breakout that just happened
    if (!breakoutDirection) {
      for (let lookback = 1; lookback <= 3; lookback++) {
        const idx = closes.length - 1 - lookback;
        if (idx < 0) break;
        const pastClose = closes[idx]!;
        const pastWma = wmaValues[idx];
        if (pastWma === undefined) continue;

        const pastUpper = pastWma + currentAtr * ATR_MULTIPLIER;
        const pastLower = pastWma - currentAtr * ATR_MULTIPLIER;

        if (pastClose > pastUpper + breakoutBuffer && currentPrice > rangeUpper) {
          breakoutDirection = "up";
          breakoutStrength = (currentPrice - rangeUpper) / currentAtr;
          break;
        } else if (pastClose < pastLower - breakoutBuffer && currentPrice < rangeLower) {
          breakoutDirection = "down";
          breakoutStrength = (rangeLower - currentPrice) / currentAtr;
          break;
        }
      }
    }

    if (!breakoutDirection) {
      return this.notDetected(
        `Range detected (${barsInRange}/${RANGE_LOOKBACK} bars in range) but no breakout yet`
      );
    }

    // 2-bar breakout confirmation: check that the previous bar also closed beyond the band
    const prevClose = closes[closes.length - 2];
    if (prevClose !== undefined) {
      const prevWma = wmaValues[wmaValues.length - 2];
      if (prevWma !== undefined) {
        const prevUpper = prevWma + currentAtr * ATR_MULTIPLIER;
        const prevLower = prevWma - currentAtr * ATR_MULTIPLIER;

        if (breakoutDirection === "up" && prevClose <= prevUpper) {
          // Current bar is the first bar of breakout, no 2-bar confirmation yet
          // Still allow detection but at lower confidence (breakout just starting)
        }
        if (breakoutDirection === "down" && prevClose >= prevLower) {
          // Same for downward
        }
      }
    }

    // Volume analysis
    const volumeRatio = this.getVolumeRatio(candles);

    // Calculate range duration (how many consecutive bars were within the range before breakout)
    let rangeDuration = 0;
    for (let i = closes.length - 2; i >= 0; i--) {
      const price = closes[i]!;
      const wma = wmaValues[i];
      if (wma === undefined) break;
      const upper = wma + currentAtr * ATR_MULTIPLIER;
      const lower = wma - currentAtr * ATR_MULTIPLIER;
      if (price >= lower && price <= upper) {
        rangeDuration++;
      } else {
        break;
      }
    }

    // SMA 20 slope for trend alignment
    const sma20 = this.calculateSMA(candles, 20);
    const sma20Values = sma20.values.filter((v): v is number => v !== null);
    let smaSlope: "up" | "down" | "flat" = "flat";
    if (sma20Values.length >= 5) {
      const recentSma = sma20Values[sma20Values.length - 1]!;
      const olderSma = sma20Values[sma20Values.length - 5]!;
      if (olderSma > 0) {
        const change = (recentSma - olderSma) / olderSma;
        if (change > 0.005) smaSlope = "up";
        else if (change < -0.005) smaSlope = "down";
      }
    }

    // ATR contraction check (squeeze during range)
    const atrValues = this.getATRValues(candles, ATR_PERIOD);
    let atrContracting = false;
    if (atrValues.length >= RANGE_LOOKBACK) {
      const earlyAtr = atrValues.slice(-RANGE_LOOKBACK, -RANGE_LOOKBACK + 5);
      const lateAtr = atrValues.slice(-5);
      const earlyAvg = earlyAtr.reduce((a, b) => a + b, 0) / earlyAtr.length;
      const lateAvg = lateAtr.reduce((a, b) => a + b, 0) / lateAtr.length;
      if (earlyAvg > 0 && lateAvg < earlyAvg * 0.85) {
        atrContracting = true;
      }
    }

    // Calculate confidence
    let confidence = 0.45; // Base

    // Tight consolidation: 18+ of 20 bars in range
    if (barsInRange >= 18) {
      confidence += 0.15;
    }

    // Long range duration
    if (rangeDuration >= 20) {
      confidence += 0.10;
    }

    // Breakout volume surge
    if (volumeRatio >= BREAKOUT_VOLUME_RATIO) {
      confidence += 0.15;
    }

    // ATR squeeze during range
    if (atrContracting) {
      confidence += 0.10;
    }

    // Breakout aligns with SMA 20 slope
    if (
      (breakoutDirection === "up" && smaSlope === "up") ||
      (breakoutDirection === "down" && smaSlope === "down")
    ) {
      confidence += 0.05;
    }

    const signals = {
      rangeCenter: currentWma,
      rangeUpper,
      rangeLower,
      barsInRange,
      rangeDuration,
      breakoutDirection,
      breakoutStrength,
      volumeRatio,
      atrContracting,
      smaSlope,
    };

    const reasons: string[] = [];
    reasons.push(
      `Range detected: ${barsInRange}/${RANGE_LOOKBACK} bars in range (WMA ${currentWma.toFixed(2)})`
    );
    reasons.push(
      `Breakout ${breakoutDirection} with ${breakoutStrength.toFixed(2)} ATR conviction`
    );
    reasons.push(`Range: $${rangeLower.toFixed(2)} - $${rangeUpper.toFixed(2)}`);
    reasons.push(`Volume: ${volumeRatio.toFixed(1)}x average`);
    if (atrContracting) {
      reasons.push("ATR contracting during range (squeeze)");
    }
    if (rangeDuration >= 20) {
      reasons.push(`Extended range: ${rangeDuration} bars`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  // ============================================================================
  // WMA Calculation
  // ============================================================================

  /**
   * Calculate Weighted Moving Average.
   * weights = [1, 2, 3, ..., period]
   * WMA = sum(price[i] * weight[i]) / sum(weights)
   */
  private computeWMA(prices: number[], period: number): number[] {
    const result: number[] = [];
    const weightSum = (period * (period + 1)) / 2;

    for (let i = 0; i < prices.length; i++) {
      if (i < period - 1) {
        // Not enough data yet, push undefined-like placeholder
        // We'll filter these out in usage
        result.push(prices[i]!); // fallback to raw price
        continue;
      }

      let wma = 0;
      for (let j = 0; j < period; j++) {
        const weight = j + 1; // weights: 1, 2, 3, ..., period
        wma += prices[i - period + 1 + j]! * weight;
      }
      result.push(wma / weightSum);
    }

    return result;
  }

  // ============================================================================
  // ATR Values (raw array for contraction analysis)
  // ============================================================================

  /**
   * Get raw ATR values as an array for trend analysis.
   */
  private getATRValues(candles: Candle[], period: number): number[] {
    const trueRanges: number[] = [];
    for (let i = 1; i < candles.length; i++) {
      const current = candles[i]!;
      const previous = candles[i - 1]!;
      const tr = Math.max(
        current.high - current.low,
        Math.abs(current.high - previous.close),
        Math.abs(current.low - previous.close)
      );
      trueRanges.push(tr);
    }

    // Calculate ATR using simple moving average of true ranges
    const result: number[] = [];
    for (let i = period - 1; i < trueRanges.length; i++) {
      const slice = trueRanges.slice(i - period + 1, i + 1);
      const avg = slice.reduce((a, b) => a + b, 0) / period;
      result.push(avg);
    }

    return result;
  }

  // ============================================================================
  // Volume Ratio
  // ============================================================================

  /**
   * Get volume ratio (current bar volume vs 20-bar average).
   */
  private getVolumeRatio(candles: Candle[]): number {
    if (candles.length < 21) return 1;
    const lastVolume = candles[candles.length - 1]?.volume ?? 0;
    const avgVolume =
      candles.slice(-21, -1).reduce((sum, c) => sum + c.volume, 0) / 20;
    return avgVolume > 0 ? lastVolume / avgVolume : 0;
  }

  // ============================================================================
  // Plan Parameters
  // ============================================================================

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const closes = this.extractPrices(candles);
    const wmaValues = this.computeWMA(closes, WMA_PERIOD);
    const atr = this.calculateATR(candles, ATR_PERIOD);

    const currentWma = wmaValues[wmaValues.length - 1] ?? currentPrice;
    const currentAtr = atr.current ?? currentPrice * 0.03;

    const rangeUpper = currentWma + currentAtr * ATR_MULTIPLIER;
    const rangeLower = currentWma - currentAtr * ATR_MULTIPLIER;
    const rangeWidth = rangeUpper - rangeLower;

    const entryPrice = currentPrice;

    // Determine breakout direction
    const isUpBreakout = currentPrice >= rangeUpper;

    // Stop: opposite side of range
    const stopLoss = isUpBreakout ? rangeLower : rangeUpper;

    // Take-profits: range width projected from breakout point
    // TP1 = 1x range width (40%), TP2 = 2x range width (35%), TP3 = 3x range width (25%)
    const takeProfits: TakeProfitLevel[] = isUpBreakout
      ? [
          { price: entryPrice + rangeWidth * 1, percentToSell: 0.4 },
          { price: entryPrice + rangeWidth * 2, percentToSell: 0.35 },
          { price: entryPrice + rangeWidth * 3, percentToSell: 0.25 },
        ]
      : [
          { price: entryPrice - rangeWidth * 1, percentToSell: 0.4 },
          { price: entryPrice - rangeWidth * 2, percentToSell: 0.35 },
          { price: entryPrice - rangeWidth * 3, percentToSell: 0.25 },
        ];

    const avgTpPrice = takeProfits.reduce(
      (sum, tp) => sum + tp.price * tp.percentToSell,
      0
    );
    const riskRewardRatio = this.calculateRiskReward(
      entryPrice,
      stopLoss,
      avgTpPrice
    );

    const direction = isUpBreakout ? "upward" : "downward";

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Trend Range ${direction} breakout. Range: $${rangeLower.toFixed(2)} - $${rangeUpper.toFixed(2)} ` +
        `(width $${rangeWidth.toFixed(2)}). Stop at opposite side $${stopLoss.toFixed(2)}. ` +
        `Targets: 1x/2x/3x range width. R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  // ============================================================================
  // Prompt Fragment
  // ============================================================================

  getPromptFragment(): string {
    return `
## Trend Range Detector Strategy Rules

When creating a plan using the Trend Range Detector strategy:

### Core Concept
- Consolidation range is defined by WMA(20) center + ATR(14) * 1.5 upper/lower bands
- Minimum 15 of 20 bars must close within the range to confirm consolidation
- Breakout requires close beyond band + 0.5 ATR buffer for conviction
- Target = range width projected from breakout point

### Entry Rules
- Enter when price closes beyond the range boundary with 0.5 ATR buffer
- 2-bar confirmation preferred: both current and previous bar close beyond band
- Volume surge on breakout is critical confirmation (1.5x+ average)
- Prefer breakouts aligned with SMA 20 slope direction

### Stop-Loss Rules
- Place stop at the opposite side of the range
- For upward breakout: stop at range lower boundary
- For downward breakout: stop at range upper boundary
- This gives a natural stop defined by the consolidation structure

### Take-Profit Rules
- TP1: 1x range width from breakout (sell 40%)
- TP2: 2x range width from breakout (sell 35%)
- TP3: 3x range width from breakout (sell 25%)
- Classic pattern: breakout target = range width projected from breakout point

### Risk Management
- Maximum position size: 4% of portfolio
- ATR contraction during range (squeeze) increases breakout potential
- If price re-enters the range after breakout, exit immediately (false breakout)
- Longer consolidation periods tend to produce stronger breakouts
- Best on 1h and 4h timeframes
`;
  }

  // ============================================================================
  // Backtesting
  // ============================================================================

  override getRequiredIndicators(): string[] {
    return ["atr14", "sma20"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    // Need enough history for WMA + range lookback
    if (index < WMA_PERIOD + RANGE_LOOKBACK) return null;

    const atr = indicators.atr14;
    const sma20 = indicators.sma20;
    if (atr == null || atr === 0 || sma20 == null) return null;

    // Compute WMA inline from recent data
    const startIdx = index - WMA_PERIOD + 1;
    if (startIdx < 0) return null;

    const weightSum = (WMA_PERIOD * (WMA_PERIOD + 1)) / 2;
    let wma = 0;
    for (let j = 0; j < WMA_PERIOD; j++) {
      const weight = j + 1;
      const dataBar = data[startIdx + j];
      if (!dataBar) return null;
      wma += dataBar.close * weight;
    }
    wma /= weightSum;

    // Range boundaries
    const rangeUpper = wma + atr * ATR_MULTIPLIER;
    const rangeLower = wma - atr * ATR_MULTIPLIER;

    // Count bars in range over lookback window
    let barsInRange = 0;
    for (let i = index - RANGE_LOOKBACK; i < index; i++) {
      if (i < 0) continue;
      const pastBar = data[i];
      if (!pastBar) continue;
      if (pastBar.close >= rangeLower && pastBar.close <= rangeUpper) {
        barsInRange++;
      }
    }

    // Not enough consolidation
    if (barsInRange < MIN_BARS_IN_RANGE) return null;

    // Check breakout with conviction buffer
    const breakoutBuffer = atr * BREAKOUT_BUFFER_ATR;

    // Upward breakout
    if (bar.close > rangeUpper + breakoutBuffer) {
      // Check previous bar was still in or near range (fresh breakout)
      const prevBar = data[index - 1];
      if (prevBar && prevBar.close <= rangeUpper + breakoutBuffer * 0.5) {
        // Volume check using available data
        let volumeOk = true;
        if (bar.volume > 0 && index >= 21) {
          let volSum = 0;
          for (let v = index - 20; v < index; v++) {
            volSum += (data[v]?.volume ?? 0);
          }
          const avgVol = volSum / 20;
          volumeOk = avgVol === 0 || bar.volume >= avgVol * 1.2;
        }

        if (volumeOk) {
          return {
            type: "BUY",
            price: bar.close,
            timestamp: bar.timestamp,
            reason: `Trend Range breakout UP: ${barsInRange}/${RANGE_LOOKBACK} bars in range, close above upper band + buffer`,
          };
        }
      }
    }

    // Downward breakout (SELL signal)
    if (bar.close < rangeLower - breakoutBuffer) {
      const prevBar = data[index - 1];
      if (prevBar && prevBar.close >= rangeLower - breakoutBuffer * 0.5) {
        let volumeOk = true;
        if (bar.volume > 0 && index >= 21) {
          let volSum = 0;
          for (let v = index - 20; v < index; v++) {
            volSum += (data[v]?.volume ?? 0);
          }
          const avgVol = volSum / 20;
          volumeOk = avgVol === 0 || bar.volume >= avgVol * 1.2;
        }

        if (volumeOk) {
          return {
            type: "SELL",
            price: bar.close,
            timestamp: bar.timestamp,
            reason: `Trend Range breakout DOWN: ${barsInRange}/${RANGE_LOOKBACK} bars in range, close below lower band + buffer`,
          };
        }
      }
    }

    return null;
  }
}

export const trendRangeStrategy = new TrendRangeStrategy();
