/**
 * Sellers Exhaustion Strategy
 *
 * Detects seller exhaustion through two distinct patterns that signal
 * potential bottoming formations:
 *
 * Pattern A — Climax Volume Rebound:
 *   Massive selling volume spike (>2.5x average) but price recovers to
 *   close in the upper 70% of the candle's range. Previous candle was
 *   bearish. Interpretation: panic selling absorbed by buyers.
 *
 * Pattern B — Declining Volume on Lower Lows:
 *   Price makes successive lower lows but selling volume diminishes on
 *   each new low, confirmed by RSI < 35. Interpretation: sellers are
 *   losing conviction while price keeps drifting lower.
 *
 * Both patterns are classic bottoming signals used to enter long positions
 * at exhaustion points where selling pressure is fading.
 *
 * Detects seller capitulation via volume patterns
 * (ClimaxVolumeExhaustion + DecliningVolumeExhaustion).
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategyId,
  TakeProfitLevel,
} from "../types.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";
import type { Candle } from "../../core/indicators/types.ts";

// ============================================================================
// Constants
// ============================================================================

const CANDLE_LIMIT = 100;

// Pattern A: Climax Volume Rebound
const CLIMAX_VOLUME_MULTIPLIER = 2.5;
const CLIMAX_VOLUME_HIGH = 3.5;
const CLIMAX_REBOUND_THRESHOLD = 0.7; // Close in upper 70% of range
const CLIMAX_REBOUND_HIGH = 0.85; // Close in upper 85% of range
const VOLUME_AVG_PERIOD = 20;

// Pattern B: Declining Volume on Lower Lows
const SWING_LOW_LOOKBACK = 20;
const PIVOT_BARS = 3; // 3-bar pivot low detection
const VOLUME_DECLINE_THRESHOLD = 0.7; // Volume < 70% of prior low's volume
const VOLUME_DECLINE_DEEP = 0.5; // Volume < 50% (stronger signal)
const RSI_OVERSOLD_THRESHOLD = 35;
const RSI_DEEP_OVERSOLD = 30;

// Support proximity
const SUPPORT_PROXIMITY_PCT = 0.03; // Within 3% of support

// ============================================================================
// Sellers Exhaustion Strategy
// ============================================================================

export class SellersExhaustionStrategy extends BaseStrategy {
  readonly id: StrategyId = "sellers_exhaustion";
  readonly name = "Sellers Exhaustion";
  readonly tier = 2 as const;
  readonly description =
    "Detects seller exhaustion through climax volume rebounds and declining " +
    "volume on lower lows — both are classic bottoming signals indicating " +
    "that selling pressure is fading and buyers are stepping in.";
  readonly indicators = ["Volume", "RSI", "ATR"];
  readonly timeframes = ["4h", "1d"];
  readonly riskLevel = "low" as const;

  // ==========================================================================
  // Detection
  // ==========================================================================

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, CANDLE_LIMIT);
    if (candles.length < SWING_LOW_LOOKBACK + PIVOT_BARS + 5) {
      return this.notDetected("Insufficient data (need 28+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Calculate shared indicators
    const rsi = this.calculateRSI(candles);
    const atr = this.calculateATR(candles);
    const _atrVal = atr.current ?? currentPrice * 0.02;

    // Detect support/resistance for proximity check
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);
    const nearSupport =
      supports.length > 0 &&
      Math.abs(supports[0]!.price - currentPrice) / currentPrice < SUPPORT_PROXIMITY_PCT;

    // ------------------------------------------------------------------
    // Try Pattern A first (more immediate signal)
    // ------------------------------------------------------------------
    const patternA = this.detectClimaxVolumeRebound(candles, rsi.current, nearSupport);
    if (patternA) {
      return this.detected(
        patternA.confidence,
        {
          pattern: "climax_volume",
          volumeSpike: patternA.volumeSpike,
          volumeDecline: null,
          candleReboundPercent: patternA.reboundPct,
          rsi: rsi.current,
          lowerLowCount: null,
          nearSupport,
        },
        patternA.reasoning,
      );
    }

    // ------------------------------------------------------------------
    // Try Pattern B (slower, structural signal)
    // ------------------------------------------------------------------
    const patternB = this.detectDecliningVolumeLowerLows(candles, rsi.current, nearSupport);
    if (patternB) {
      return this.detected(
        patternB.confidence,
        {
          pattern: "declining_volume",
          volumeSpike: null,
          volumeDecline: patternB.volumeDeclinePct,
          candleReboundPercent: null,
          rsi: rsi.current,
          lowerLowCount: patternB.lowerLowCount,
          nearSupport,
        },
        patternB.reasoning,
      );
    }

    return this.notDetected(
      "No seller exhaustion pattern detected. " +
        `RSI: ${rsi.current?.toFixed(1) ?? "N/A"}, ` +
        `Price: $${currentPrice.toFixed(2)}`,
    );
  }

  // ==========================================================================
  // Pattern A: Climax Volume Rebound
  // ==========================================================================

  private detectClimaxVolumeRebound(
    candles: Candle[],
    rsiCurrent: number | null,
    nearSupport: boolean,
  ): {
    confidence: number;
    volumeSpike: number;
    reboundPct: number;
    reasoning: string;
  } | null {
    if (candles.length < VOLUME_AVG_PERIOD + 2) return null;

    const current = candles[candles.length - 1]!;
    const previous = candles[candles.length - 2]!;

    // 1. Calculate 20-period average volume
    const volumeSlice = candles.slice(-(VOLUME_AVG_PERIOD + 1), -1);
    const avgVolume = volumeSlice.reduce((sum, c) => sum + c.volume, 0) / volumeSlice.length;

    if (avgVolume === 0) return null;

    // 2. Current candle volume > 2.5x average
    const volumeSpike = current.volume / avgVolume;
    if (volumeSpike < CLIMAX_VOLUME_MULTIPLIER) return null;

    // 3. Current candle closes in upper 70% of its range
    const candleRange = current.high - current.low;
    if (candleRange === 0) return null;
    const reboundPct = (current.close - current.low) / candleRange;
    if (reboundPct < CLIMAX_REBOUND_THRESHOLD) return null;

    // 4. Previous candle was bearish
    if (previous.close >= previous.open) return null;

    // --- Confidence scoring ---
    let confidence = 0.55;

    if (volumeSpike > CLIMAX_VOLUME_HIGH) confidence += 0.1;
    if (reboundPct > CLIMAX_REBOUND_HIGH) confidence += 0.1;
    if (rsiCurrent !== null && rsiCurrent < RSI_DEEP_OVERSOLD) confidence += 0.1;
    if (nearSupport) confidence += 0.1;

    // Build reasoning
    const reasons: string[] = [];
    reasons.push(
      `Climax volume rebound detected: volume ${volumeSpike.toFixed(1)}x average (threshold: ${CLIMAX_VOLUME_MULTIPLIER}x)`,
    );
    reasons.push(
      `Candle closed in upper ${(reboundPct * 100).toFixed(0)}% of range (sellers absorbed)`,
    );
    reasons.push("Previous candle was bearish (selling pressure preceded the climax)");
    if (rsiCurrent !== null) reasons.push(`RSI: ${rsiCurrent.toFixed(1)}`);
    if (nearSupport) reasons.push("Price near support level (adds confluence)");
    reasons.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);

    return {
      confidence,
      volumeSpike,
      reboundPct,
      reasoning: reasons.join(". "),
    };
  }

  // ==========================================================================
  // Pattern B: Declining Volume on Lower Lows
  // ==========================================================================

  private detectDecliningVolumeLowerLows(
    candles: Candle[],
    rsiCurrent: number | null,
    nearSupport: boolean,
  ): {
    confidence: number;
    volumeDeclinePct: number;
    lowerLowCount: number;
    reasoning: string;
  } | null {
    // 1. Scan last 20 candles for 3-bar pivot lows
    const recentCandles = candles.slice(-SWING_LOW_LOOKBACK);
    const swingLows: { index: number; price: number; volume: number }[] = [];

    for (let i = PIVOT_BARS; i < recentCandles.length - PIVOT_BARS; i++) {
      const candidate = recentCandles[i]!;
      let isPivotLow = true;

      // Check bars on both sides
      for (let j = 1; j <= PIVOT_BARS; j++) {
        const left = recentCandles[i - j];
        const right = recentCandles[i + j];
        if (!left || !right) {
          isPivotLow = false;
          break;
        }
        if (candidate.low >= left.low || candidate.low >= right.low) {
          isPivotLow = false;
          break;
        }
      }

      if (isPivotLow) {
        swingLows.push({
          index: i,
          price: candidate.low,
          volume: candidate.volume,
        });
      }
    }

    // 2. Find successive lower lows (at least 2)
    if (swingLows.length < 2) return null;

    // Walk through swing lows to find successive lower lows with declining volume
    let lowerLowCount = 0;
    let volumeDeclinePct = 0;
    let firstLowVolume = 0;
    let lastLowVolume = 0;

    for (let i = 1; i < swingLows.length; i++) {
      const prev = swingLows[i - 1]!;
      const curr = swingLows[i]!;

      if (curr.price < prev.price) {
        lowerLowCount++;
        if (lowerLowCount === 1) {
          firstLowVolume = prev.volume;
        }
        lastLowVolume = curr.volume;
      } else {
        // Reset if not a lower low
        lowerLowCount = 0;
        firstLowVolume = 0;
        lastLowVolume = 0;
      }
    }

    if (lowerLowCount < 1) return null; // Need at least 2 lows total (1 pair)

    // 3. Volume on the second lower low must be < 70% of the first
    if (firstLowVolume === 0) return null;
    volumeDeclinePct = (1 - lastLowVolume / firstLowVolume) * 100;
    if (lastLowVolume >= firstLowVolume * VOLUME_DECLINE_THRESHOLD) return null;

    // 4. RSI < 35 confirms oversold
    if (rsiCurrent === null || rsiCurrent >= RSI_OVERSOLD_THRESHOLD) return null;

    // --- Confidence scoring ---
    let confidence = 0.5;

    // Volume decline > 50% (stronger exhaustion)
    if (lastLowVolume < firstLowVolume * VOLUME_DECLINE_DEEP) confidence += 0.1;
    // 3+ successive lower lows with declining volume
    if (lowerLowCount >= 3) confidence += 0.1;
    // Deeply oversold RSI
    if (rsiCurrent < RSI_DEEP_OVERSOLD) confidence += 0.1;
    // Near support
    if (nearSupport) confidence += 0.1;

    // Build reasoning
    const reasons: string[] = [];
    reasons.push(
      `Declining volume on lower lows: ${lowerLowCount + 1} successive lower lows detected`,
    );
    reasons.push(`Volume declined ${volumeDeclinePct.toFixed(0)}% from first to last swing low`);
    reasons.push(`RSI: ${rsiCurrent.toFixed(1)} (oversold, confirms exhaustion)`);
    if (nearSupport) reasons.push("Price near support level (adds confluence)");
    reasons.push(`Confidence: ${(confidence * 100).toFixed(0)}%`);

    return {
      confidence,
      volumeDeclinePct,
      lowerLowCount: lowerLowCount + 1, // Total number of lows (pairs + 1)
      reasoning: reasons.join(". "),
    };
  }

  // ==========================================================================
  // Plan Parameters
  // ==========================================================================

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", CANDLE_LIMIT);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.02;
    const rsi = this.calculateRSI(candles);

    const entryPrice = currentPrice;

    // Determine which pattern is active to set the stop-loss
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);
    const nearSupport =
      supports.length > 0 &&
      Math.abs(supports[0]!.price - currentPrice) / currentPrice < SUPPORT_PROXIMITY_PCT;

    const patternA = this.detectClimaxVolumeRebound(candles, rsi.current, nearSupport);

    let stopLoss: number;
    let patternName: string;

    if (patternA) {
      // Pattern A: stop below the exhaustion candle low - 0.5 ATR buffer
      const exhaustionCandleLow = candles[candles.length - 1]!.low;
      stopLoss = exhaustionCandleLow - 0.5 * atrVal;
      patternName = "Climax Volume Rebound";
    } else {
      // Pattern B: stop below the lowest lower low - 0.5 ATR buffer
      const recentCandles = candles.slice(-SWING_LOW_LOOKBACK);
      let lowestLow = Infinity;
      for (const c of recentCandles) {
        if (c.low < lowestLow) lowestLow = c.low;
      }
      stopLoss = lowestLow - 0.5 * atrVal;
      patternName = "Declining Volume on Lower Lows";
    }

    // Take-profits: 1.5R (35%), 2.5R (35%), 4R (30%)
    const risk = entryPrice - stopLoss;
    const takeProfits: TakeProfitLevel[] = [
      { price: entryPrice + risk * 1.5, percentToSell: 0.35 },
      { price: entryPrice + risk * 2.5, percentToSell: 0.35 },
      { price: entryPrice + risk * 4.0, percentToSell: 0.3 },
    ];

    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `Sellers Exhaustion — ${patternName}. LONG entry at $${entryPrice.toFixed(2)}. ` +
        `Stop: $${stopLoss.toFixed(2)} (0.5 ATR below exhaustion low). ` +
        `TP1 (1.5R): $${takeProfits[0]!.price.toFixed(2)} sell 35%, ` +
        `TP2 (2.5R): $${takeProfits[1]!.price.toFixed(2)} sell 35%, ` +
        `TP3 (4R): $${takeProfits[2]!.price.toFixed(2)} sell 30%. ` +
        `R:R ${riskRewardRatio.toFixed(1)}:1. Direction: LONG (buying the exhaustion bottom).`,
    };
  }

  // ==========================================================================
  // Prompt Fragment
  // ==========================================================================

  getPromptFragment(): string {
    return `
## Sellers Exhaustion Strategy Rules

When creating a plan using the Sellers Exhaustion strategy:

### What Is Seller Exhaustion?
Seller exhaustion occurs when bearish pressure fades and buyers begin absorbing
the remaining sell orders. Two distinct patterns signal this:

### Pattern A: Climax Volume Rebound
- A climax candle prints with volume > 2.5x the 20-period average
- Despite the massive selling volume, the candle closes in the upper 70%+ of its range
- The previous candle was bearish, setting up the context of ongoing selling
- Interpretation: this is **panic selling** followed by a strong rebound — sellers dumped
  everything they had, and buyers absorbed it all. The selling is exhausted.

### Pattern B: Declining Volume on Lower Lows
- Price makes 2 or more successive lower lows (swing lows using 3-bar pivots)
- Volume on each new lower low is significantly lower than the previous one (<70%)
- RSI is below 35, confirming oversold conditions
- Interpretation: sellers are **losing conviction**. Price keeps drifting lower
  but fewer participants are selling — the move is running out of fuel.

### Entry Rules
- Direction is always LONG (buying the exhaustion bottom)
- Pattern A is the more immediate signal — enter on the climax candle close
- Pattern B is a structural signal — enter once the declining volume divergence is confirmed

### Stop-Loss Rules
- Pattern A: stop below the exhaustion candle's low minus 0.5x ATR buffer
- Pattern B: stop below the lowest swing low minus 0.5x ATR buffer
- If price breaks below these levels, the exhaustion thesis is invalidated

### Take-Profit Rules
- TP1 at 1.5R: sell 35% (quick partial profit)
- TP2 at 2.5R: sell 35% (let the mean reversion play out)
- TP3 at 4.0R: sell 30% (extended runner if momentum flips bullish)

### Confidence Boosters
- Volume spike > 3.5x average (Pattern A): very strong exhaustion
- Candle closes in upper 85% of range (Pattern A): extremely strong rebound
- RSI < 30 (deeply oversold): adds conviction to both patterns
- Price near a support level: adds structural confluence
- 3+ lower lows with declining volume (Pattern B): very clear exhaustion structure

### Risk Management
- These are counter-trend entries — respect the stop-loss strictly
- Best on higher timeframes (4h, 1d) where exhaustion signals are more reliable
- Combine with support/resistance levels for added confluence
- If the broader trend is a strong downtrend, reduce position size
`;
  }

  // ==========================================================================
  // Backtesting
  // ==========================================================================

  override getRequiredIndicators(): string[] {
    return ["atr14", "rsi14"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    if (index < VOLUME_AVG_PERIOD + 2) return null;

    const rsi = indicators.rsi14;
    if (rsi == null) return null;

    // Calculate 20-period average volume from historical data
    const volumeSlice = data.slice(index - VOLUME_AVG_PERIOD, index);
    if (volumeSlice.length < VOLUME_AVG_PERIOD) return null;

    const avgVolume = volumeSlice.reduce((sum, c) => sum + c.volume, 0) / volumeSlice.length;
    if (avgVolume === 0) return null;

    const volumeRatio = bar.volume / avgVolume;

    // Check candle rebound (close position within range)
    const candleRange = bar.high - bar.low;
    if (candleRange === 0) return null;
    const reboundPct = (bar.close - bar.low) / candleRange;

    // Previous bar must be bearish
    const prevBar = data[index - 1];
    if (!prevBar) return null;
    const prevBearish = prevBar.close < prevBar.open;

    // BUY signal: volume > 2.5x SMA(volume,20) AND close in upper 70% AND prev bar red
    if (
      volumeRatio >= CLIMAX_VOLUME_MULTIPLIER &&
      reboundPct >= CLIMAX_REBOUND_THRESHOLD &&
      prevBearish
    ) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason:
          `Sellers exhaustion (climax): vol ${volumeRatio.toFixed(1)}x avg, ` +
          `rebound ${(reboundPct * 100).toFixed(0)}%, RSI ${rsi.toFixed(1)}`,
      };
    }

    return null;
  }
}

export const sellersExhaustionStrategy = new SellersExhaustionStrategy();
