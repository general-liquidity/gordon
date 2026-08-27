/**
 * ATR Stepping Trend Channels Strategy
 *
 * A noise-filtered trend detection strategy using dynamic trend lines that
 * "step" up/down based on ATR multiples. Unlike moving averages (continuous),
 * these lines only move when price triggers a threshold, filtering out noise.
 *
 * Core Mechanism:
 * - Upper and lower lines initialized from first candle +/- ATR * trigger_mult
 * - Lines only step when close breaches the opposite line
 * - Trend flips require an ATR-threshold breach (high conviction)
 * - Minimum hold bars prevent whipsaw flips
 *
 * Entry Conditions:
 * - Trend just flipped (within last 3 bars) or price retests stepped line
 * - LONG on bullish flip, SHORT on bearish flip
 *
 * Confidence Boosters:
 * - Fresh flip (within 2 bars): +0.15
 * - Volume rising on flip: +0.10
 * - Price holding above/below stepped line for 2+ bars: +0.10
 * - ADX > 20 (trending environment): +0.10
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

/** ATR multiplier for triggering a step / trend flip */
const TRIGGER_MULT = 2.5;

/** ATR multiplier for step size when trend continues */
const STEP_MULT = 1.0;

/** Minimum bars to hold trend before allowing flip (anti-whipsaw) */
const HOLD_BARS = 3;

/** Number of candles to analyze */
const LOOKBACK = 100;

/** ATR calculation period */
const ATR_PERIOD = 14;

/** SMA period for general trend reference */
const _SMA_PERIOD = 20;

// ============================================================================
// Stepping Algorithm Types
// ============================================================================

interface SteppingState {
  upperLine: number;
  lowerLine: number;
  trend: "bullish" | "bearish";
  barsSinceFlip: number;
  holdCounter: number;
  flipOccurred: boolean;
}

interface SteppingResult {
  states: SteppingState[];
  currentTrend: "bullish" | "bearish";
  currentUpperLine: number;
  currentLowerLine: number;
  flipBar: number; // bars since last flip
  holdingLine: boolean; // price holding above/below stepped line for 2+ bars
}

// ============================================================================
// ATR Stepping Strategy
// ============================================================================

export class AtrSteppingStrategy extends BaseStrategy {
  readonly id: StrategyId = "atr_stepping" as StrategyId;
  readonly name = "ATR Stepping Channels";
  readonly tier = 2 as const;
  readonly description =
    "Noise-filtered trend detection using dynamic trend lines that only step " +
    "on significant ATR-threshold breaches. Trend flips are high-conviction signals.";
  readonly indicators = ["ATR", "SMA 20"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "medium" as const;

  // ==========================================================================
  // Core Stepping Algorithm
  // ==========================================================================

  /**
   * Run the ATR stepping algorithm over a set of candles with pre-computed ATR values.
   * Returns the full state history and summary of the current state.
   */
  private runSteppingAlgorithm(
    candles: Array<{ high: number; low: number; close: number }>,
    atrValues: number[],
  ): SteppingResult {
    const states: SteppingState[] = [];

    if (candles.length === 0 || atrValues.length === 0) {
      return {
        states: [],
        currentTrend: "bullish",
        currentUpperLine: 0,
        currentLowerLine: 0,
        flipBar: LOOKBACK,
        holdingLine: false,
      };
    }

    const firstCandle = candles[0]!;
    const firstAtr = atrValues[0] ?? 0;

    // Initialize: upper_line = first candle high + ATR * trigger_mult
    //             lower_line = first candle low  - ATR * trigger_mult
    let upperLine = firstCandle.high + firstAtr * TRIGGER_MULT;
    let lowerLine = firstCandle.low - firstAtr * TRIGGER_MULT;
    let trend: "bullish" | "bearish" = "bullish";
    let holdCounter = 0;
    let barsSinceFlip = LOOKBACK; // large initial value

    states.push({
      upperLine,
      lowerLine,
      trend,
      barsSinceFlip,
      holdCounter: 0,
      flipOccurred: false,
    });

    for (let i = 1; i < candles.length; i++) {
      const candle = candles[i]!;
      const atr = atrValues[i] ?? atrValues[atrValues.length - 1] ?? 0;
      const maxStep = atr * STEP_MULT;
      let flipOccurred = false;

      barsSinceFlip++;

      if (candle.close > upperLine) {
        // Potential bullish flip or continuation
        if (trend === "bearish") {
          // Check hold bars anti-whipsaw
          holdCounter++;
          if (holdCounter >= HOLD_BARS || barsSinceFlip > HOLD_BARS) {
            // Flip to bullish
            trend = "bullish";
            barsSinceFlip = 0;
            holdCounter = 0;
            flipOccurred = true;
          }
        }
        // Step upper line up
        const step = Math.min(maxStep, candle.close - upperLine);
        if (step > 0) {
          upperLine += step;
        }
        // Reset lower line for the new trend context
        lowerLine = candle.close - atr * TRIGGER_MULT;
      } else if (candle.close < lowerLine) {
        // Potential bearish flip or continuation
        if (trend === "bullish") {
          // Check hold bars anti-whipsaw
          holdCounter++;
          if (holdCounter >= HOLD_BARS || barsSinceFlip > HOLD_BARS) {
            // Flip to bearish
            trend = "bearish";
            barsSinceFlip = 0;
            holdCounter = 0;
            flipOccurred = true;
          }
        }
        // Step lower line down
        const step = Math.min(maxStep, lowerLine - candle.close);
        if (step > 0) {
          lowerLine -= step;
        }
        // Reset upper line for the new trend context
        upperLine = candle.close + atr * TRIGGER_MULT;
      } else {
        // Price between lines - hold current trend, lines stay put
        holdCounter = 0;
      }

      states.push({
        upperLine,
        lowerLine,
        trend,
        barsSinceFlip,
        holdCounter,
        flipOccurred,
      });
    }

    // Determine if price is holding above/below stepped line for 2+ bars
    let holdingLine = false;
    if (states.length >= 3) {
      const last3 = states.slice(-3);
      const last3Candles = candles.slice(-3);
      if (trend === "bullish") {
        holdingLine = last3.every((s, idx) => last3Candles[idx]!.close > s.lowerLine);
      } else {
        holdingLine = last3.every((s, idx) => last3Candles[idx]!.close < s.upperLine);
      }
    }

    const lastState = states[states.length - 1]!;

    return {
      states,
      currentTrend: lastState.trend,
      currentUpperLine: lastState.upperLine,
      currentLowerLine: lastState.lowerLine,
      flipBar: lastState.barsSinceFlip,
      holdingLine,
    };
  }

  // ==========================================================================
  // Detection
  // ==========================================================================

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, LOOKBACK);
    if (candles.length < 30) {
      return this.notDetected("Insufficient data (need 30+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate ATR
    const atrResult = this.calculateATR(candles, ATR_PERIOD);
    if (!atrResult.current) {
      return this.notDetected("Could not calculate ATR");
    }

    // Build per-bar ATR values from the ATR result
    // ATR values array may be shorter than candles (needs ATR_PERIOD bars to warm up)
    const atrValues = this.buildAtrPerBar(candles, ATR_PERIOD);

    // Run stepping algorithm
    const steppingResult = this.runSteppingAlgorithm(
      candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
      atrValues,
    );

    const { currentTrend, currentUpperLine, currentLowerLine, flipBar, holdingLine } =
      steppingResult;

    // Check for entry: trend just flipped (within last 3 bars)
    // OR price retesting the stepped line after a flip
    const freshFlip = flipBar <= 3;
    const retest = this.isRetesting(candles, steppingResult);

    if (!freshFlip && !retest) {
      return this.notDetected(
        `No recent flip or retest. Trend: ${currentTrend}, bars since flip: ${flipBar}`,
      );
    }

    // Calculate confidence
    let confidence = 0.5;

    // Fresh flip (within 2 bars): +0.15
    if (flipBar <= 2) {
      confidence += 0.15;
    }

    // Volume rising on flip: +0.10
    const volumeTrend = this.analyzeVolumeTrend(candles);
    if (volumeTrend === "rising") {
      confidence += 0.1;
    }

    // Price holding above/below stepped line for 2+ bars: +0.10
    if (holdingLine) {
      confidence += 0.1;
    }

    // ADX > 20 (trending environment): +0.10
    const adxValue = this.estimateADX(candles);
    if (adxValue > 20) {
      confidence += 0.1;
    }

    const direction = currentTrend === "bullish" ? "LONG" : "SHORT";

    const signals = {
      trend: currentTrend,
      upperLine: currentUpperLine,
      lowerLine: currentLowerLine,
      flipBar,
      atr: atrResult.current,
      volumeTrend,
      holdingLine,
      direction,
      adx: adxValue,
      retest,
    };

    const reasons: string[] = [];
    reasons.push(`ATR Stepping trend: ${currentTrend} (${direction})`);
    if (freshFlip) {
      reasons.push(`Fresh flip ${flipBar} bar(s) ago`);
    }
    if (retest) {
      reasons.push("Price retesting stepped line");
    }
    reasons.push(`Volume: ${volumeTrend}`);
    if (holdingLine) {
      reasons.push("Price holding above/below stepped line");
    }
    reasons.push(`ADX estimate: ${adxValue.toFixed(1)}`);
    reasons.push(`Upper: $${currentUpperLine.toFixed(2)}, Lower: $${currentLowerLine.toFixed(2)}`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  /**
   * Check if price is retesting the stepped line after a previous flip.
   * A retest means price pulled back to the trend line and is bouncing.
   */
  private isRetesting(candles: Candle[], result: SteppingResult): boolean {
    if (candles.length < 3 || result.states.length < 3) return false;
    if (result.flipBar <= 3) return false; // Already counted as a fresh flip

    const lastCandle = candles[candles.length - 1]!;
    const prevCandle = candles[candles.length - 2]!;
    const lastState = result.states[result.states.length - 1]!;

    if (result.currentTrend === "bullish") {
      // Retest: price dipped near lower line and bounced
      const nearLower =
        prevCandle.low <= lastState.lowerLine * 1.01 && lastCandle.close > lastState.lowerLine;
      return nearLower;
    } else {
      // Retest: price rose near upper line and rejected
      const nearUpper =
        prevCandle.high >= lastState.upperLine * 0.99 && lastCandle.close < lastState.upperLine;
      return nearUpper;
    }
  }

  /**
   * Build per-bar ATR values using a simple True Range calculation.
   * Returns an array the same length as candles.
   */
  private buildAtrPerBar(candles: Candle[], period: number): number[] {
    const trueRanges: number[] = [];

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i]!;
      if (i === 0) {
        trueRanges.push(c.high - c.low);
      } else {
        const prev = candles[i - 1]!;
        const tr = Math.max(
          c.high - c.low,
          Math.abs(c.high - prev.close),
          Math.abs(c.low - prev.close),
        );
        trueRanges.push(tr);
      }
    }

    // Calculate running ATR using Wilder's smoothing
    const atrValues: number[] = [];
    for (let i = 0; i < candles.length; i++) {
      if (i < period) {
        // Use simple average of available true ranges
        const slice = trueRanges.slice(0, i + 1);
        const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length;
        atrValues.push(avg);
      } else if (i === period) {
        // First real ATR: SMA of first `period` true ranges
        const avg = trueRanges.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
        atrValues.push(avg);
      } else {
        // Wilder's smoothing: ATR = (prevATR * (period-1) + currentTR) / period
        const prevAtr = atrValues[i - 1]!;
        atrValues.push((prevAtr * (period - 1) + trueRanges[i]!) / period);
      }
    }

    return atrValues;
  }

  /**
   * Estimate ADX using a simplified directional movement calculation.
   * Returns the approximate ADX value.
   */
  private estimateADX(candles: Candle[]): number {
    if (candles.length < 28) return 0;

    const period = 14;
    const plusDMs: number[] = [];
    const minusDMs: number[] = [];
    const trueRanges: number[] = [];

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

    // Wilder's smoothing
    const smooth = (values: number[]): number[] => {
      if (values.length < period) return [];
      const result: number[] = [];
      let sum = values.slice(0, period).reduce((a, b) => a + b, 0);
      result.push(sum);
      for (let i = period; i < values.length; i++) {
        sum = sum - sum / period + values[i]!;
        result.push(sum);
      }
      return result;
    };

    const smoothTR = smooth(trueRanges);
    const smoothPlusDM = smooth(plusDMs);
    const smoothMinusDM = smooth(minusDMs);

    if (smoothTR.length === 0) return 0;

    // Calculate DX values
    const dxValues: number[] = [];
    for (let i = 0; i < smoothTR.length; i++) {
      const pdi = (smoothPlusDM[i]! / smoothTR[i]!) * 100;
      const mdi = (smoothMinusDM[i]! / smoothTR[i]!) * 100;
      const denom = pdi + mdi;
      if (denom === 0) continue;
      const dx = (Math.abs(pdi - mdi) / denom) * 100;
      if (!Number.isNaN(dx)) dxValues.push(dx);
    }

    // Smooth DX to get ADX
    const adxValues = smooth(dxValues);
    return adxValues[adxValues.length - 1] ?? 0;
  }

  // ==========================================================================
  // Plan Parameters
  // ==========================================================================

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", LOOKBACK);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const atrResult = this.calculateATR(candles, ATR_PERIOD);
    const atrValues = this.buildAtrPerBar(candles, ATR_PERIOD);

    const steppingResult = this.runSteppingAlgorithm(
      candles.map((c) => ({ high: c.high, low: c.low, close: c.close })),
      atrValues,
    );

    const { currentTrend, currentUpperLine, currentLowerLine } = steppingResult;
    const entryPrice = currentPrice;

    // Stop at the opposite stepped line
    const stopLoss = currentTrend === "bullish" ? currentLowerLine : currentUpperLine;

    // Risk = distance from entry to stop
    const risk = Math.abs(entryPrice - stopLoss);

    // TP1: 1.5R (35%), TP2: 2.5R (35%), TP3: 3.5R (30%)
    const takeProfits: TakeProfitLevel[] =
      currentTrend === "bullish"
        ? [
            { price: entryPrice + risk * 1.5, percentToSell: 0.35 },
            { price: entryPrice + risk * 2.5, percentToSell: 0.35 },
            { price: entryPrice + risk * 3.5, percentToSell: 0.3 },
          ]
        : [
            { price: entryPrice - risk * 1.5, percentToSell: 0.35 },
            { price: entryPrice - risk * 2.5, percentToSell: 0.35 },
            { price: entryPrice - risk * 3.5, percentToSell: 0.3 },
          ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `ATR Stepping ${currentTrend} trade. ` +
        `Entry: $${entryPrice.toFixed(2)}. ` +
        `Stop at opposite stepped line: $${stopLoss.toFixed(2)}. ` +
        `ATR: ${atrResult.current?.toFixed(2) ?? "N/A"}. ` +
        `Upper: $${currentUpperLine.toFixed(2)}, Lower: $${currentLowerLine.toFixed(2)}. ` +
        `R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  // ==========================================================================
  // Prompt Fragment
  // ==========================================================================

  getPromptFragment(): string {
    return `
## ATR Stepping Channels Strategy Rules

When creating a plan using the ATR Stepping Channels strategy:

### Core Concept
ATR stepping uses noise-filtered trend detection where trend lines only move when
price makes a significant move (ATR-threshold breach). This means:
- Lines stay flat during choppy/noisy price action
- Trend flips are high-conviction because they require breaching ATR * ${TRIGGER_MULT}
- Minimum ${HOLD_BARS} bar hold prevents whipsaw flip-flops

### Entry Rules
- LONG when trend flips bullish (close breaches upper stepped line)
- SHORT when trend flips bearish (close breaches lower stepped line)
- Also valid: retest of the stepped line after a flip (continuation entry)
- Best entries are within 3 bars of a flip

### Stop-Loss Rules
- Place stop at the opposite stepped line
- For longs: stop at lower stepped line
- For shorts: stop at upper stepped line
- These levels are dynamic and ATR-based, adapting to volatility

### Take-Profit Rules
- TP1: 1.5R - sell 35% (secure initial profit)
- TP2: 2.5R - sell 35% (let trend develop)
- TP3: 3.5R - sell 30% (trend exhaustion target)
- Consider trailing stop along the stepped line for remaining position

### Risk Management
- Only trade when trend has clearly flipped (avoid anticipating flips)
- Volume should confirm the flip (rising volume = stronger signal)
- ADX > 20 indicates a trending environment (better for this strategy)
- Exit if price closes back beyond the stepped line against your direction
- Maximum position size: 3-5% of portfolio
`;
  }

  // ==========================================================================
  // Backtesting
  // ==========================================================================

  override getRequiredIndicators(): string[] {
    return ["atr14", "sma20"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    _indicators: IndicatorState,
  ): Signal | null {
    // Need enough bars for ATR warmup + stepping algorithm
    if (index < ATR_PERIOD + 5) return null;

    // Compute ATR values from bar 0 to current index
    const lookbackStart = Math.max(0, index - LOOKBACK + 1);
    const slice = data.slice(lookbackStart, index + 1);

    // Build ATR per bar for the slice
    const atrValues = this.buildAtrPerBarFromOHLC(slice, ATR_PERIOD);

    // Run stepping algorithm on the slice
    const steppingResult = this.runSteppingAlgorithm(
      slice.map((c) => ({ high: c.high, low: c.low, close: c.close })),
      atrValues,
    );

    const { states } = steppingResult;
    if (states.length < 2) return null;

    const currentState = states[states.length - 1]!;
    const prevState = states[states.length - 2]!;

    // Detect trend flip
    if (currentState.flipOccurred) {
      if (currentState.trend === "bullish") {
        return {
          type: "BUY",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `ATR Stepping bullish flip. Upper: ${currentState.upperLine.toFixed(2)}, Lower: ${currentState.lowerLine.toFixed(2)}`,
        };
      } else {
        return {
          type: "SELL",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `ATR Stepping bearish flip. Upper: ${currentState.upperLine.toFixed(2)}, Lower: ${currentState.lowerLine.toFixed(2)}`,
        };
      }
    }

    // Check for retest within a few bars of a flip (continuation signal)
    if (currentState.barsSinceFlip > 1 && currentState.barsSinceFlip <= 5 && slice.length >= 2) {
      const prevBar = slice[slice.length - 2]!;
      if (currentState.trend === "bullish") {
        // Retest: prev bar dipped near lower line, current bar bounced
        if (prevBar.low <= prevState.lowerLine * 1.01 && bar.close > currentState.lowerLine) {
          return {
            type: "BUY",
            price: bar.close,
            timestamp: bar.timestamp,
            reason: `ATR Stepping bullish retest after flip`,
          };
        }
      } else {
        // Retest: prev bar spiked near upper line, current bar rejected
        if (prevBar.high >= prevState.upperLine * 0.99 && bar.close < currentState.upperLine) {
          return {
            type: "SELL",
            price: bar.close,
            timestamp: bar.timestamp,
            reason: `ATR Stepping bearish retest after flip`,
          };
        }
      }
    }

    return null;
  }

  /**
   * Build per-bar ATR values from OHLC data (for backtesting).
   */
  private buildAtrPerBarFromOHLC(data: OHLC[], period: number): number[] {
    const trueRanges: number[] = [];

    for (let i = 0; i < data.length; i++) {
      const c = data[i]!;
      if (i === 0) {
        trueRanges.push(c.high - c.low);
      } else {
        const prev = data[i - 1]!;
        const tr = Math.max(
          c.high - c.low,
          Math.abs(c.high - prev.close),
          Math.abs(c.low - prev.close),
        );
        trueRanges.push(tr);
      }
    }

    const atrValues: number[] = [];
    for (let i = 0; i < data.length; i++) {
      if (i < period) {
        const slice = trueRanges.slice(0, i + 1);
        const avg = slice.reduce((sum, v) => sum + v, 0) / slice.length;
        atrValues.push(avg);
      } else if (i === period) {
        const avg = trueRanges.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
        atrValues.push(avg);
      } else {
        const prevAtr = atrValues[i - 1]!;
        atrValues.push((prevAtr * (period - 1) + trueRanges[i]!) / period);
      }
    }

    return atrValues;
  }
}

export const atrSteppingStrategy = new AtrSteppingStrategy();
