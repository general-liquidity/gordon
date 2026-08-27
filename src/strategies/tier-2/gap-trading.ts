/**
 * Gap Trading Strategy
 *
 * Detects price gaps between candles and trades based on gap continuation
 * or gap fill dynamics. Uses volume confirmation and ATR-relative gap
 * significance to filter high-probability setups.
 *
 * Gap detection and continuation/fill trading strategy
 * from backtesting (best: 1% threshold, 2.5% TP, 2% SL).
 *
 * Entry Conditions:
 * - Gap detected: open vs previous close > 1% deviation
 * - Volume confirmation (current vs 20-period average)
 * - ATR context for gap significance
 * - SMA 20 trend alignment
 *
 * Confidence Boosters:
 * - Gap > 2% of price (+10%)
 * - Gap > 1.5x ATR (+10%)
 * - Volume > 1.5x average (+10%)
 * - Gap aligns with SMA 20 trend (+10%)
 * - Price holding gap (not filling back) (+15%)
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

const GAP_UP_THRESHOLD = 1.01; // 1% gap up: open > prevClose * 1.01
const GAP_DOWN_THRESHOLD = 0.99; // 1% gap down: open < prevClose * 0.99
const _GAP_SMALL_MIN = 1.0; // Small gap: 1-2%
const GAP_MEDIUM_MIN = 2.0; // Medium gap: 2-4%
const GAP_LARGE_MIN = 4.0; // Large gap: 4%+
const ATR_SIGNIFICANT_MULT = 1.5; // Gap > 1.5x ATR = significant
const VOLUME_CONFIRM_MULT = 1.5; // Volume > 1.5x avg = confirmation
const CANDLE_LIMIT = 100;
const SMA_PERIOD = 20;

// ============================================================================
// Gap Trading Strategy
// ============================================================================

export class GapTradingStrategy extends BaseStrategy {
  readonly id: StrategyId = "gap_trading";
  readonly name = "Gap Trading";
  readonly tier = 2 as const;
  readonly description =
    "Trades price gaps using continuation or fill dynamics with volume " +
    "confirmation and ATR-relative gap significance scoring.";
  readonly indicators = ["ATR", "SMA 20", "Volume"];
  readonly timeframes = ["1h", "4h"];
  readonly riskLevel = "medium" as const;

  // ==========================================================================
  // Detection
  // ==========================================================================

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

    // ---------- Gap Detection ----------
    const lastCandle = candles[candles.length - 1]!;
    const prevCandle = candles[candles.length - 2]!;
    const prevClose = prevCandle.close;

    const gapRatio = lastCandle.open / prevClose;
    const isGapUp = gapRatio > GAP_UP_THRESHOLD;
    const isGapDown = gapRatio < GAP_DOWN_THRESHOLD;

    if (!isGapUp && !isGapDown) {
      return this.notDetected(
        `No significant gap detected (open/prevClose ratio: ${gapRatio.toFixed(4)}, need > ${GAP_UP_THRESHOLD} or < ${GAP_DOWN_THRESHOLD})`,
      );
    }

    const gapDirection: "up" | "down" = isGapUp ? "up" : "down";
    const gapPercent = Math.abs((lastCandle.open - prevClose) / prevClose) * 100;

    // ---------- Gap Size Classification ----------
    let gapSize: "small" | "medium" | "large";
    if (gapPercent >= GAP_LARGE_MIN) {
      gapSize = "large";
    } else if (gapPercent >= GAP_MEDIUM_MIN) {
      gapSize = "medium";
    } else {
      gapSize = "small";
    }

    // ---------- Gap Fill vs Continuation ----------
    // Filling: price moving back toward previous close
    // Continuation: price moving away from previous close
    let gapType: "continuation" | "filling";
    if (isGapUp) {
      // Gap up: filling if current price < open (moving back down toward prevClose)
      gapType = currentPrice < lastCandle.open ? "filling" : "continuation";
    } else {
      // Gap down: filling if current price > open (moving back up toward prevClose)
      gapType = currentPrice > lastCandle.open ? "filling" : "continuation";
    }

    // ---------- Volume Confirmation ----------
    const avgVolume = this.getAverageVolume(candles, SMA_PERIOD);
    const volumeRatio = avgVolume > 0 ? lastCandle.volume / avgVolume : 1;
    const volumeConfirmed = volumeRatio > VOLUME_CONFIRM_MULT;

    // ---------- ATR Context ----------
    const atr = this.calculateATR(candles);
    const atrValue = atr.current ?? currentPrice * 0.03;
    const gapAbsolute = Math.abs(lastCandle.open - prevClose);
    const gapVsAtr = atrValue > 0 ? gapAbsolute / atrValue : 0;

    // ---------- SMA 20 Trend ----------
    const sma = this.calculateSMA(candles, SMA_PERIOD);
    const smaValue = sma.current;
    let trendAligns = false;
    if (smaValue !== null) {
      // Gap up aligns with uptrend (price above SMA)
      // Gap down aligns with downtrend (price below SMA)
      trendAligns = (isGapUp && currentPrice > smaValue) || (isGapDown && currentPrice < smaValue);
    }

    // ---------- Confidence Scoring ----------
    let confidence = 0.45; // Base confidence

    // Gap > 2% of price
    if (gapPercent > 2.0) {
      confidence += 0.1;
    }

    // Gap > 1.5x ATR (significant)
    if (gapVsAtr > ATR_SIGNIFICANT_MULT) {
      confidence += 0.1;
    }

    // Volume above 1.5x average
    if (volumeConfirmed) {
      confidence += 0.1;
    }

    // Gap direction aligns with SMA 20 trend
    if (trendAligns) {
      confidence += 0.1;
    }

    // Price holding gap (not filling back) — continuation is stronger
    if (gapType === "continuation") {
      confidence += 0.15;
    }

    // ---------- Signals ----------
    const signals = {
      gapPercent,
      gapDirection,
      gapSize,
      gapType,
      volumeRatio,
      atr: atrValue,
      gapVsAtr,
      trendAligns,
      volumeConfirmed,
      sma20: smaValue,
    };

    // ---------- Reasoning ----------
    const reasons: string[] = [];
    reasons.push(
      `${gapDirection.toUpperCase()} gap detected: ${gapPercent.toFixed(2)}% (${gapSize})`,
    );
    reasons.push(
      `Gap type: ${gapType} (price ${gapType === "filling" ? "reverting toward" : "extending away from"} previous close)`,
    );
    reasons.push(
      `Volume: ${volumeRatio.toFixed(1)}x average${volumeConfirmed ? " (confirmed)" : " (weak)"}`,
    );
    reasons.push(
      `Gap vs ATR: ${gapVsAtr.toFixed(2)}x${gapVsAtr > ATR_SIGNIFICANT_MULT ? " (significant)" : ""}`,
    );
    if (trendAligns) {
      reasons.push("SMA 20 trend aligns with gap direction");
    }
    reasons.push(
      gapType === "continuation"
        ? `Trade: ${isGapUp ? "BUY" : "SELL"} gap continuation`
        : `Trade: ${isGapUp ? "SELL" : "BUY"} gap fill toward $${prevClose.toFixed(2)}`,
    );

    return this.detected(confidence, signals, reasons.join(". "));
  }

  // ==========================================================================
  // Plan Parameters
  // ==========================================================================

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.03;

    const lastCandle = candles[candles.length - 1]!;
    const prevCandle = candles[candles.length - 2]!;
    const prevClose = prevCandle.close;

    const isGapUp = lastCandle.open > prevClose * GAP_UP_THRESHOLD;
    const isGapDown = lastCandle.open < prevClose * GAP_DOWN_THRESHOLD;

    // Determine if gap is filling or continuing
    let isFilling: boolean;
    if (isGapUp) {
      isFilling = currentPrice < lastCandle.open;
    } else {
      isFilling = currentPrice > lastCandle.open;
    }

    const entryPrice = currentPrice;
    let stopLoss: number;
    let primaryTarget: number;

    if (isFilling) {
      // Gap fill trade: target is the previous close (fill level)
      if (isGapUp) {
        // Gap up filling: price falling back, go short or wait
        // Stop above the gap high
        stopLoss = lastCandle.high + atrVal * 0.5;
        primaryTarget = prevClose; // Gap fill level
      } else {
        // Gap down filling: price rising back, go long
        // Stop below the gap low
        stopLoss = lastCandle.low - atrVal * 0.5;
        primaryTarget = prevClose; // Gap fill level
      }
    } else {
      // Gap continuation trade
      if (isGapUp) {
        // Gap up continuation: go long
        // Stop below gap low
        stopLoss = lastCandle.low - atrVal * 0.5;
        primaryTarget = entryPrice + Math.abs(entryPrice - stopLoss) * 2;
      } else {
        // Gap down continuation: go short/avoid (default long bias)
        // Stop above gap high
        stopLoss = lastCandle.high + atrVal * 0.5;
        primaryTarget = entryPrice - Math.abs(entryPrice - stopLoss) * 2;
      }
    }

    // Take profits: 40% at 1R, 35% at 2R, 25% at 3R
    const risk = Math.abs(entryPrice - stopLoss);
    const direction = entryPrice > stopLoss ? 1 : -1; // 1 for long, -1 for short context

    const takeProfits: TakeProfitLevel[] = [
      { price: entryPrice + risk * 1.0 * direction, percentToSell: 0.4 },
      { price: entryPrice + risk * 2.0 * direction, percentToSell: 0.35 },
      { price: entryPrice + risk * 3.0 * direction, percentToSell: 0.25 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    const tradeType = isFilling ? "gap fill" : "gap continuation";
    const gapDir = isGapUp ? "up" : isGapDown ? "down" : "neutral";

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Gap ${gapDir} ${tradeType} trade. ` +
        `Entry at $${entryPrice.toFixed(2)}, stop at $${stopLoss.toFixed(2)} (ATR-based). ` +
        `TP levels: 1R (40%), 2R (35%), 3R (25%). R:R ${riskRewardRatio.toFixed(1)}:1. ` +
        (isFilling
          ? `Target: gap fill at $${prevClose.toFixed(2)}.`
          : `Target: 2x risk continuation at $${primaryTarget.toFixed(2)}.`),
    };
  }

  // ==========================================================================
  // Prompt Fragment
  // ==========================================================================

  getPromptFragment(): string {
    return `
## Gap Trading Strategy Rules

When creating a plan using the Gap Trading strategy:

### Gap Types
- **Gap Up Continuation**: Price gaps up (open > prev close * 1.01) and continues higher.
  Buy the breakout, stop below gap low.
- **Gap Up Fill**: Price gaps up but reverses back toward the previous close.
  Fade the gap, target the fill level.
- **Gap Down Continuation**: Price gaps down (open < prev close * 0.99) and continues lower.
  Avoid or short, stop above gap high.
- **Gap Down Fill**: Price gaps down but reverses back toward the previous close.
  Buy the reversal, target the fill level.

### Volume Confirmation
- Volume > 1.5x 20-period average confirms the gap direction
- Low volume gaps are more likely to fill
- High volume gaps are more likely to continue

### ATR-Relative Gap Significance
- Gap > 1.5x ATR(14) = significant gap, higher conviction
- Gap < 1x ATR = noise, lower conviction
- Use ATR for stop-loss placement (0.5x ATR buffer beyond gap extremes)

### Entry Rules
- Minimum 1% gap threshold to trigger
- Confirm with volume and trend (SMA 20) alignment
- For continuation: enter at current price, stop below/above gap
- For fill: enter at current price, target previous close

### Stop-Loss Rules
- Continuation: stop 0.5x ATR below gap low (gap up) or above gap high (gap down)
- Fill: stop 0.5x ATR beyond gap extreme (high for gap up, low for gap down)
- Move to breakeven after TP1 hit

### Take-Profit Rules
- TP1: 1:1 R:R (sell 40%) — secure initial profit
- TP2: 2:1 R:R (sell 35%) — core position target
- TP3: 3:1 R:R (sell 25%) — runner for extended move

### Session Awareness
- Gaps are most significant at session opens (crypto: UTC 00:00, equities: market open)
- Weekend gaps in crypto can be tradeable but less reliable
- News-driven gaps tend to continue; liquidity gaps tend to fill

### Risk Management
- Maximum position size: 3% of portfolio (medium risk)
- Reduce size for gaps < 1.5x ATR
- Best on 1h and 4h timeframes for crypto
- Avoid trading gaps on illiquid/low-cap tokens
`;
  }

  // ==========================================================================
  // Backtesting
  // ==========================================================================

  override getRequiredIndicators(): string[] {
    return ["sma20", "atr14"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    if (index < 20) return null;

    const sma20 = indicators.sma20;
    const atr14 = indicators.atr14;

    if (sma20 == null || atr14 == null) return null;

    const prev = data[index - 1]!;

    // Calculate 20-period average volume for confirmation
    let volumeSum = 0;
    const volLookback = Math.min(20, index);
    for (let i = index - volLookback; i < index; i++) {
      volumeSum += data[i]!.volume;
    }
    const avgVolume = volumeSum / volLookback;
    const volumeRatio = avgVolume > 0 ? bar.volume / avgVolume : 1;

    // Gap up detection: open > prev close * 1.01
    const gapUpPct = ((bar.open - prev.close) / prev.close) * 100;
    if (gapUpPct >= 1.0) {
      // Volume confirmation: current volume > 1.2x average (relaxed for backtest)
      const volumeOk = volumeRatio > 1.2;

      // Trend alignment: price above SMA 20
      const trendOk = bar.close > sma20;

      if (volumeOk && trendOk) {
        return {
          type: "BUY",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `Gap up ${gapUpPct.toFixed(1)}%, vol ${volumeRatio.toFixed(1)}x, above SMA20`,
        };
      }
    }

    // Gap down detection: open < prev close * 0.99
    const gapDownPct = ((prev.close - bar.open) / prev.close) * 100;
    if (gapDownPct >= 1.0) {
      const volumeOk = volumeRatio > 1.2;
      const trendOk = bar.close < sma20;

      if (volumeOk && trendOk) {
        return {
          type: "SELL",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `Gap down ${gapDownPct.toFixed(1)}%, vol ${volumeRatio.toFixed(1)}x, below SMA20`,
        };
      }
    }

    return null;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private getAverageVolume(candles: Candle[], period: number): number {
    const sliced = candles.slice(-period - 1, -1); // Exclude current candle
    if (sliced.length === 0) return 1;
    return sliced.reduce((sum, c) => sum + c.volume, 0) / sliced.length;
  }
}

export const gapTradingStrategy = new GapTradingStrategy();
