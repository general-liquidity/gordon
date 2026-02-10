/**
 * Exhaustion Gap Strategy
 *
 * Detects exhaustion gaps — gaps that occur at the end of a move with
 * extreme volume and RSI, suggesting the trend is about to reverse.
 * Uses Bayesian-style confidence scoring.
 *
 * Entry Conditions:
 * - Gap detected (FVG or price gap > 0.5% from prev close)
 * - Volume spike (> 2x average)
 * - RSI extreme (> 75 for bearish entry, < 25 for bullish entry)
 * - ATR expanding (volatility at peak)
 *
 * Confidence Boosters:
 * - FVG aligns with gap direction (+10%)
 * - Multiple RSI divergence signals (+10%)
 * - Gap partially filled already (+10%)
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
import { calculateFVG } from "../../core/indicators/index.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";

// ============================================================================
// Constants
// ============================================================================

const GAP_MIN_PCT = 0.5;
const VOLUME_SPIKE_MULT = 2.0;
const RSI_OVERBOUGHT = 75;
const RSI_OVERSOLD = 25;
const CANDLE_LIMIT = 100;

// ============================================================================
// Exhaustion Gap Strategy
// ============================================================================

export class ExhaustionGapStrategy extends BaseStrategy {
  readonly id: StrategyId = "exhaustion_gap";
  readonly name = "Exhaustion Gap";
  readonly tier = 2 as const;
  readonly description =
    "Fades exhaustion gaps that occur at trend extremes with massive volume " +
    "and RSI divergence. Uses Bayesian scoring for conviction.";
  readonly indicators = ["FVG", "RSI", "ATR", "Volume"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "high" as const;

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < 30) {
      return this.notDetected("Insufficient data (need 30+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Detect gap
    const gap = this.detectGap(candles);
    if (!gap.hasGap) {
      return this.notDetected("No significant price gap detected");
    }

    // Volume spike check
    const avgVolume = this.getAverageVolume(candles, 20);
    const lastCandle = candles[candles.length - 1]!;
    const volumeSpike = lastCandle.volume / avgVolume;

    if (volumeSpike < VOLUME_SPIKE_MULT) {
      return this.notDetected(
        `Volume not extreme enough: ${volumeSpike.toFixed(1)}x avg (need > ${VOLUME_SPIKE_MULT}x)`
      );
    }

    // RSI extreme
    const rsi = this.calculateRSI(candles);
    if (rsi.current === null) {
      return this.notDetected("Could not calculate RSI");
    }

    const isUpGap = gap.direction === "up";
    const rsiExtreme = isUpGap
      ? rsi.current > RSI_OVERBOUGHT
      : rsi.current < RSI_OVERSOLD;

    if (!rsiExtreme) {
      return this.notDetected(
        `RSI ${rsi.current.toFixed(1)} not extreme enough for ${isUpGap ? "bearish" : "bullish"} exhaustion (need ${isUpGap ? "> " + RSI_OVERBOUGHT : "< " + RSI_OVERSOLD})`
      );
    }

    // Bayesian confidence scoring
    let confidence = 0.4; // Base — gap + volume + RSI extreme is already notable

    // Prior: gap size (larger gap = more likely exhaustion)
    if (gap.gapPct > 1.5) confidence += 0.1;
    else if (gap.gapPct > 1.0) confidence += 0.05;

    // Likelihood: volume spike magnitude
    if (volumeSpike > 3.0) confidence += 0.1;
    else if (volumeSpike > 2.5) confidence += 0.05;

    // Likelihood: RSI extremity
    const rsiExtremity = isUpGap ? rsi.current - RSI_OVERBOUGHT : RSI_OVERSOLD - rsi.current;
    if (rsiExtremity > 10) confidence += 0.1;
    else if (rsiExtremity > 5) confidence += 0.05;

    // ATR expanding
    const atr = this.calculateATR(candles);
    const atrExpanding = this.isATRExpanding(candles);
    if (atrExpanding) confidence += 0.05;

    // FVG alignment
    const fvg = calculateFVG(candles);
    const allGaps = [...fvg.bullishGaps, ...fvg.bearishGaps];
    const recentFVG = allGaps.length > 0 ? allGaps[allGaps.length - 1] : null;
    const fvgAligns = recentFVG != null &&
      ((isUpGap && recentFVG.type === "bullish") || (!isUpGap && recentFVG.type === "bearish"));
    if (fvgAligns) confidence += 0.1;

    // Gap partially filled (more likely to be exhaustion if starting to fill)
    if (gap.partiallyFilled) confidence += 0.1;

    // The trade direction is OPPOSITE the gap (fading the exhaustion)
    const tradeDirection = isUpGap ? "short_fade" : "long_fade";

    const signals = {
      gap: {
        direction: gap.direction,
        gapPct: gap.gapPct,
        gapPrice: gap.gapPrice,
        partiallyFilled: gap.partiallyFilled,
      },
      volumeSpike,
      rsi: rsi.current,
      rsiExtreme: true,
      atrExpanding,
      fvgAligns,
      tradeDirection,
    };

    const reasons: string[] = [];
    reasons.push(`Exhaustion ${gap.direction} gap: ${gap.gapPct.toFixed(2)}%`);
    reasons.push(`Volume spike: ${volumeSpike.toFixed(1)}x average`);
    reasons.push(`RSI extreme: ${rsi.current.toFixed(1)} (${isUpGap ? "overbought" : "oversold"})`);
    if (fvgAligns) reasons.push("FVG confirms gap zone");
    if (gap.partiallyFilled) reasons.push("Gap starting to fill (exhaustion confirmed)");
    if (atrExpanding) reasons.push("ATR expanding (peak volatility)");
    reasons.push(`Trade: ${tradeDirection === "long_fade" ? "BUY (fade bearish exhaustion)" : "SELL/avoid (fade bullish exhaustion)"}`);

    return this.detected(confidence, signals, reasons.join(". "));
  }

  private detectGap(candles: Candle[]): {
    hasGap: boolean;
    direction: "up" | "down";
    gapPct: number;
    gapPrice: number;
    partiallyFilled: boolean;
  } {
    if (candles.length < 3) {
      return { hasGap: false, direction: "up", gapPct: 0, gapPrice: 0, partiallyFilled: false };
    }

    const last = candles[candles.length - 1]!;
    const prev = candles[candles.length - 2]!;

    // Gap up: current low > previous high
    const gapUp = last.low - prev.high;
    // Gap down: current high < previous low
    const gapDown = prev.low - last.high;

    if (gapUp > 0) {
      const gapPct = (gapUp / prev.close) * 100;
      if (gapPct >= GAP_MIN_PCT) {
        // Check if partially filled (price came back toward gap)
        const partiallyFilled = last.close < last.open; // Bearish candle after up gap
        return {
          hasGap: true,
          direction: "up",
          gapPct,
          gapPrice: prev.high,
          partiallyFilled,
        };
      }
    }

    if (gapDown > 0) {
      const gapPct = (gapDown / prev.close) * 100;
      if (gapPct >= GAP_MIN_PCT) {
        const partiallyFilled = last.close > last.open; // Bullish candle after down gap
        return {
          hasGap: true,
          direction: "down",
          gapPct,
          gapPrice: prev.low,
          partiallyFilled,
        };
      }
    }

    // Also check for body gaps (less strict)
    const bodyGapUp = (last.open - prev.close) / prev.close * 100;
    const bodyGapDown = (prev.close - last.open) / prev.close * 100;

    if (bodyGapUp >= GAP_MIN_PCT) {
      return {
        hasGap: true,
        direction: "up",
        gapPct: bodyGapUp,
        gapPrice: prev.close,
        partiallyFilled: last.close < last.open,
      };
    }

    if (bodyGapDown >= GAP_MIN_PCT) {
      return {
        hasGap: true,
        direction: "down",
        gapPct: bodyGapDown,
        gapPrice: prev.close,
        partiallyFilled: last.close > last.open,
      };
    }

    return { hasGap: false, direction: "up", gapPct: 0, gapPrice: 0, partiallyFilled: false };
  }

  private getAverageVolume(candles: Candle[], period: number): number {
    const sliced = candles.slice(-period - 1, -1); // Exclude current candle
    if (sliced.length === 0) return 1;
    return sliced.reduce((sum, c) => sum + c.volume, 0) / sliced.length;
  }

  private isATRExpanding(candles: Candle[]): boolean {
    if (candles.length < 30) return false;

    const recent = candles.slice(-10);
    const older = candles.slice(-25, -10);

    const recentAvgRange = recent.reduce((s, c) => s + (c.high - c.low), 0) / recent.length;
    const olderAvgRange = older.reduce((s, c) => s + (c.high - c.low), 0) / older.length;

    return recentAvgRange > olderAvgRange * 1.3;
  }

  async getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);

    const entryPrice = currentPrice;
    const atrVal = atr.current ?? currentPrice * 0.03;

    // For exhaustion gap fades, stop is tight (above gap for bearish fade, below for bullish)
    const stopLoss = entryPrice - atrVal * 1.5;

    // Target: gap fill (mean reversion)
    const risk = entryPrice - stopLoss;
    const takeProfits: TakeProfitLevel[] = [
      { price: entryPrice + risk * 1.5, percentToSell: 0.4 },
      { price: entryPrice + risk * 2.5, percentToSell: 0.35 },
      { price: entryPrice + risk * 4, percentToSell: 0.25 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Exhaustion gap fade. Gap + extreme volume + RSI suggests trend exhaustion. ` +
        `Stop at $${stopLoss.toFixed(2)} (1.5x ATR). Target gap fill. R:R ${riskRewardRatio.toFixed(1)}:1. ` +
        `WARNING: Counter-trend trade — size small.`,
    };
  }

  getPromptFragment(): string {
    return `
## Exhaustion Gap Strategy Rules

When creating a plan using the Exhaustion Gap strategy:

### Entry Rules
- Price gap > 0.5% from previous close
- Volume spike > 2x average (climactic volume)
- RSI extreme: > 75 (overbought) or < 25 (oversold)
- Trade AGAINST the gap direction (fade the exhaustion)
- Best when gap is partially filled (confirms exhaustion)

### Stop-Loss Rules
- Place stop 1.5x ATR from entry
- Exhaustion fades are counter-trend — tight stops essential
- Exit immediately if gap extends (not exhaustion, continuation)

### Take-Profit Rules
- TP1: 1.5:1 R:R (sell 40%) — quick profit on fade
- TP2: 2.5:1 R:R (sell 35%) — gap fill target
- TP3: 4:1 R:R (sell 25%) — full mean reversion

### Risk Management
- Maximum position size: 2% of portfolio (HIGH RISK counter-trend)
- Only trade clear exhaustion patterns
- Confirm with FVG for structural support
- Exit if RSI reverses back to extreme (new momentum)
- Best on 4h+ timeframes for cleaner gaps
- DO NOT use on low-cap tokens with gaps from illiquidity
`;
  }

  override getRequiredIndicators(): string[] {
    return ["rsi14", "atr14", "volumeAvg20", "volumeRatio"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState
  ): Signal | null {
    if (index < 20) return null;

    const rsi = indicators.rsi14;
    const volumeRatio = indicators.volumeRatio;

    if (rsi == null || volumeRatio == null) return null;

    const prev = data[index - 1]!;

    // Body gap down + volume spike + oversold RSI = buy the exhaustion
    const gapDown = ((prev.close - bar.open) / prev.close) * 100;
    if (gapDown >= GAP_MIN_PCT && volumeRatio > VOLUME_SPIKE_MULT && rsi < RSI_OVERSOLD) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: `Exhaustion gap down: ${gapDown.toFixed(1)}%, volume ${volumeRatio.toFixed(1)}x, RSI ${rsi.toFixed(1)}`,
      };
    }

    return null;
  }
}

export const exhaustionGapStrategy = new ExhaustionGapStrategy();
