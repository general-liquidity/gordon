/**
 * ICT Killzones Strategy
 *
 * Inner Circle Trader methodology identifies specific time windows where
 * institutional activity creates tradeable setups. Five sessions define
 * the daily structure:
 *
 * 1. Asia (20:00-00:00 UTC): Sets the range (low volatility, range-bound)
 * 2. London (02:00-05:00 UTC): First breakout attempt, often sets daily high or low
 * 3. NY AM (07:00-10:00 UTC): Highest volume, largest moves, continuation or reversal
 * 4. NY Lunch (12:00-13:00 UTC): Dead zone, avoid trading
 * 5. NY PM (13:00-16:00 UTC): Final positioning, often reverts
 *
 * Core Setup:
 * - Asia session establishes a consolidation range
 * - London breaks above or below the Asia range
 * - NY AM continues in the breakout direction (high probability)
 * - Alternative: London fakeout, NY reverses
 *
 * Confidence Boosters:
 * - Clean Asia range (< 1.5 ATR) (+10%)
 * - London broke with conviction (close beyond range + 0.3 ATR) (+15%)
 * - Volume increasing in killzone vs Asia (+10%)
 * - RSI not extreme (30-70) (+5%)
 * - Near key S/R level (+10%)
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

type KillzoneName = "asia" | "london" | "ny_am" | "ny_lunch" | "ny_pm";

interface SessionRange {
  high: number;
  low: number;
  volume: number;
  candleCount: number;
}

interface KillzoneDefinition {
  name: KillzoneName;
  startHour: number;
  endHour: number;
}

// ============================================================================
// Constants
// ============================================================================

const _KILLZONES: KillzoneDefinition[] = [
  { name: "asia", startHour: 20, endHour: 0 }, // 20:00-00:00 UTC (wraps midnight)
  { name: "london", startHour: 2, endHour: 5 }, // 02:00-05:00 UTC
  { name: "ny_am", startHour: 7, endHour: 10 }, // 07:00-10:00 UTC
  { name: "ny_lunch", startHour: 12, endHour: 13 }, // 12:00-13:00 UTC
  { name: "ny_pm", startHour: 13, endHour: 16 }, // 13:00-16:00 UTC
];

const MIN_CANDLES = 50;
const ASIA_RANGE_ATR_MAX = 1.5;
const BREAKOUT_ATR_FACTOR = 0.3;

// Intraday-only timeframes that support session detection
const INTRADAY_TIMEFRAMES = ["1m", "3m", "5m", "15m", "30m", "1h", "2h"];

// ============================================================================
// ICT Killzones Strategy
// ============================================================================

export class IctKillzonesStrategy extends BaseStrategy {
  readonly id: StrategyId = "ict_killzones";
  readonly name = "ICT Killzones";
  readonly tier = 2 as const;
  readonly description =
    "Identifies ICT Killzone sessions (Asia, London, NY) to trade institutional breakouts. " +
    "Asia sets the range, London breaks it, and NY AM continues or reverses.";
  readonly indicators = ["ATR", "Volume", "Support/Resistance"];
  readonly timeframes = ["15m", "1h"];
  readonly riskLevel = "medium" as const;

  // ==========================================================================
  // Detection
  // ==========================================================================

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    // Guard: need intraday data for session detection
    if (!INTRADAY_TIMEFRAMES.includes(timeframe)) {
      return this.notDetected(
        "ICT Killzones requires intraday data (15m or 1h recommended). " +
          "Cannot detect sessions on 4h/1d timeframes.",
      );
    }

    const candles = await this.fetchCandles(ctx, symbol, timeframe, 200);
    if (candles.length < MIN_CANDLES) {
      return this.notDetected(
        `Insufficient data (need ${MIN_CANDLES}+ candles, got ${candles.length})`,
      );
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Determine current UTC hour from latest candle timestamp
    const latestCandle = candles[candles.length - 1]!;
    const currentHour = this.getUtcHour(latestCandle);
    if (currentHour === null) {
      return this.notDetected("Cannot determine candle timestamp for session detection");
    }

    // Identify which killzone we are in (or approaching)
    const currentKillzone = this.identifyKillzone(currentHour);
    if (currentKillzone === null) {
      return this.notDetected(`Current hour (${currentHour} UTC) is not in an active killzone`);
    }
    if (currentKillzone === "ny_lunch") {
      return this.notDetected("Currently in NY Lunch dead zone (12:00-13:00 UTC) — avoid trading");
    }

    // Group candles by session and compute Asia range
    const asiaRange = this.computeSessionRange(candles, "asia");
    if (asiaRange === null || asiaRange.candleCount < 2) {
      return this.notDetected("Not enough Asia session candles to define range");
    }

    const asiaHigh = asiaRange.high;
    const asiaLow = asiaRange.low;
    const asiaRangeSize = asiaHigh - asiaLow;

    if (asiaRangeSize <= 0) {
      return this.notDetected("Asia range is zero — no defined range");
    }

    // Calculate ATR for reference
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.02;

    // Check London session breakout
    const londonRange = this.computeSessionRange(candles, "london");
    const nyAmRange = this.computeSessionRange(candles, "ny_am");

    // Determine breakout direction from London or current session
    let breakoutDirection: "above" | "below" | null = null;
    let breakoutConviction = false;

    if (londonRange !== null && londonRange.candleCount >= 1) {
      if (londonRange.high > asiaHigh) {
        breakoutDirection = "above";
        // Conviction: London closed above Asia high + 0.3 ATR
        breakoutConviction = londonRange.high > asiaHigh + atrVal * BREAKOUT_ATR_FACTOR;
      } else if (londonRange.low < asiaLow) {
        breakoutDirection = "below";
        breakoutConviction = londonRange.low < asiaLow - atrVal * BREAKOUT_ATR_FACTOR;
      }
    }

    // Also check if current price has broken the range (for NY sessions)
    if (breakoutDirection === null) {
      if (currentPrice > asiaHigh) {
        breakoutDirection = "above";
      } else if (currentPrice < asiaLow) {
        breakoutDirection = "below";
      }
    }

    if (breakoutDirection === null) {
      return this.notDetected("Price is still within Asia range — no breakout detected");
    }

    // Determine if NY is continuing London direction
    let isLondonContinuation = false;
    if (londonRange !== null && nyAmRange !== null && currentKillzone === "ny_am") {
      if (breakoutDirection === "above" && nyAmRange.high > londonRange.high) {
        isLondonContinuation = true;
      } else if (breakoutDirection === "below" && nyAmRange.low < londonRange.low) {
        isLondonContinuation = true;
      }
    }

    // ========================================================================
    // Confidence Scoring
    // ========================================================================

    let confidence = 0.45;

    // Clean Asia range (< 1.5 ATR): +0.10
    if (asiaRangeSize < atrVal * ASIA_RANGE_ATR_MAX) {
      confidence += 0.1;
    }

    // London broke with conviction: +0.15
    if (breakoutConviction) {
      confidence += 0.15;
    }

    // Volume increasing in killzone vs Asia: +0.10
    const sessionVolume = this.getCurrentSessionVolume(candles, currentKillzone);
    if (asiaRange.volume > 0 && sessionVolume > asiaRange.volume * 1.2) {
      confidence += 0.1;
    }

    // RSI not extreme (30-70): +0.05
    const rsi = this.calculateRSI(candles);
    if (rsi.current !== null && rsi.current >= 30 && rsi.current <= 70) {
      confidence += 0.05;
    }

    // Near key S/R level: +0.10
    const levels = this.detectLevels(candles, currentPrice);
    const nearestSupport = this.getSupports(levels, currentPrice)[0];
    const nearestResistance = this.getResistances(levels, currentPrice)[0];
    const nearSR =
      (nearestSupport &&
        Math.abs(this.calculateDistancePercent(currentPrice, nearestSupport.price)) < 1.5) ||
      (nearestResistance &&
        Math.abs(this.calculateDistancePercent(currentPrice, nearestResistance.price)) < 1.5);
    if (nearSR) {
      confidence += 0.1;
    }

    // ========================================================================
    // Build Signals and Reasoning
    // ========================================================================

    const signals = {
      killzone: currentKillzone,
      asiaHigh,
      asiaLow,
      asiaRange: asiaRangeSize,
      breakoutDirection,
      sessionVolume,
      isLondonContinuation,
      rsi: rsi.current,
      atr: atrVal,
    };

    const reasons: string[] = [];
    reasons.push(
      `Currently in ${currentKillzone.toUpperCase()} killzone (hour ${currentHour} UTC)`,
    );
    reasons.push(
      `Asia range: ${asiaLow.toFixed(2)} - ${asiaHigh.toFixed(2)} (${asiaRangeSize.toFixed(2)})`,
    );
    reasons.push(`Breakout ${breakoutDirection} Asia range`);
    if (breakoutConviction) {
      reasons.push("London broke with conviction (> 0.3 ATR beyond range)");
    }
    if (isLondonContinuation) {
      reasons.push("NY AM continuing London breakout direction");
    }
    if (nearSR) {
      reasons.push("Price near key support/resistance level");
    }
    if (rsi.current !== null) {
      reasons.push(`RSI: ${rsi.current.toFixed(1)}`);
    }

    return this.detected(confidence, signals, reasons.join(". "));
  }

  // ==========================================================================
  // Plan Parameters
  // ==========================================================================

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "1h", 200);
    const currentPrice = this.getCurrentPrice(candles, ctx);
    const atr = this.calculateATR(candles);
    const atrVal = atr.current ?? currentPrice * 0.02;

    // Compute Asia range for stop placement
    const asiaRange = this.computeSessionRange(candles, "asia");
    const asiaHigh = asiaRange?.high ?? currentPrice + atrVal;
    const asiaLow = asiaRange?.low ?? currentPrice - atrVal;
    const _asiaRangeSize = asiaHigh - asiaLow;

    // Determine breakout direction
    let breakoutDirection: "above" | "below" = "above";
    if (currentPrice < asiaLow) {
      breakoutDirection = "below";
    } else if (currentPrice <= asiaHigh) {
      // Still in range, default to above but use ATR as fallback
      breakoutDirection = currentPrice > (asiaHigh + asiaLow) / 2 ? "above" : "below";
    }

    const entryPrice = currentPrice;

    // Stop: opposite side of Asia range
    let stopLoss: number;
    if (breakoutDirection === "above") {
      stopLoss = asiaLow - atrVal * 0.2; // Below Asia low with small buffer
    } else {
      stopLoss = asiaHigh + atrVal * 0.2; // Above Asia high with small buffer
    }

    const risk = Math.abs(entryPrice - stopLoss);

    // TP1: 1R (40%), TP2: 2R (35%), TP3: 3R (25%)
    let takeProfits: Array<{ price: number; percentToSell: number }>;
    if (breakoutDirection === "above") {
      takeProfits = [
        { price: entryPrice + risk * 1, percentToSell: 0.4 },
        { price: entryPrice + risk * 2, percentToSell: 0.35 },
        { price: entryPrice + risk * 3, percentToSell: 0.25 },
      ];
    } else {
      takeProfits = [
        { price: entryPrice - risk * 1, percentToSell: 0.4 },
        { price: entryPrice - risk * 2, percentToSell: 0.35 },
        { price: entryPrice - risk * 3, percentToSell: 0.25 },
      ];
    }

    const avgTp = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTp);

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes:
        `ICT Killzones trade. Breakout ${breakoutDirection} Asia range ` +
        `(${asiaLow.toFixed(2)}-${asiaHigh.toFixed(2)}). ` +
        `Entry at $${entryPrice.toFixed(2)}, stop at $${stopLoss.toFixed(2)} ` +
        `(opposite side of Asia range). ` +
        `TP1: 1R (40%), TP2: 2R (35%), TP3: 3R (25%). R:R ${riskRewardRatio.toFixed(1)}:1`,
    };
  }

  // ==========================================================================
  // Prompt Fragment
  // ==========================================================================

  getPromptFragment(): string {
    return `
## ICT Killzones Strategy Rules

When creating a plan using the ICT Killzones strategy:

### Session Definitions (UTC)
- **Asia (20:00-00:00)**: Sets the daily range. Low volatility, range-bound.
- **London (02:00-05:00)**: First breakout attempt. Often sets the daily high or low.
- **NY AM (07:00-10:00)**: Highest volume session. Continuation or reversal of London.
- **NY Lunch (12:00-13:00)**: Dead zone. Avoid trading.
- **NY PM (13:00-16:00)**: Final positioning. Often reverts.

### Core Setup
- Asia establishes a consolidation range (high and low)
- London breaks above or below this range
- Best setup: London breakout + NY AM continuation in same direction
- Alternative: London fakeout — NY reverses the London move

### Entry Rules
- Enter when price breaks Asia range during London or NY AM killzone
- Confirm with volume increase vs Asia session
- Prefer entries where London broke with conviction (close > 0.3 ATR beyond range)
- Avoid entries during NY Lunch dead zone

### Stop-Loss Rules
- Place stop on the opposite side of the Asia range
- Add a small ATR buffer (0.2x ATR) beyond the range extreme
- This protects against false breakout wicks back into the range

### Take-Profit Rules
- TP1: 1R from entry (sell 40%)
- TP2: 2R from entry (sell 35%)
- TP3: 3R from entry (sell 25%)

### Risk Management
- Session pivots (Asia high/low) are institutional reference levels
- Clean Asia ranges (< 1.5 ATR) produce better breakouts
- Volume confirmation in London/NY vs Asia increases probability
- RSI should not be extreme (30-70 range preferred)
- Avoid NY Lunch — institutional desks step away, erratic price action
`;
  }

  // ==========================================================================
  // Backtesting
  // ==========================================================================

  override getRequiredIndicators(): string[] {
    return ["atr14", "rsi14", "volumeAvg20", "volumeRatio"];
  }

  override generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    // Need enough history for session analysis
    if (index < 30) return null;

    const atr = indicators.atr14;
    if (atr == null || atr <= 0) return null;

    // Extract hour from bar timestamp for session detection
    const hour = new Date(bar.timestamp).getUTCHours();

    // Only trade during London (2-5) or NY AM (7-10) killzones
    const inLondon = hour >= 2 && hour < 5;
    const inNyAm = hour >= 7 && hour < 10;
    if (!inLondon && !inNyAm) return null;

    // Compute Asia range from recent bars
    // Look back over previous bars to find those in Asia session (20:00-00:00 UTC)
    let asiaHigh = -Infinity;
    let asiaLow = Infinity;
    let asiaBarCount = 0;

    for (let i = index - 1; i >= Math.max(0, index - 48); i--) {
      const prevBar = data[i]!;
      const prevHour = new Date(prevBar.timestamp).getUTCHours();
      if (prevHour >= 20 || prevHour < 1) {
        // Asia session candle
        asiaHigh = Math.max(asiaHigh, prevBar.high);
        asiaLow = Math.min(asiaLow, prevBar.low);
        asiaBarCount++;
      }
    }

    // Need at least 2 Asia candles
    if (asiaBarCount < 2 || asiaHigh === -Infinity || asiaLow === Infinity) {
      return null;
    }

    const asiaRange = asiaHigh - asiaLow;
    if (asiaRange <= 0) return null;

    // Use a simple proxy: volatility expansion after compression
    // If candle timeframe doesn't have reliable timestamps, this still works
    // via the ATR-based range check
    const cleanRange = asiaRange < atr * ASIA_RANGE_ATR_MAX;

    // Check for breakout
    if (bar.close > asiaHigh && inNyAm) {
      // BUY: London broke above Asia range and we're in NY AM
      // Verify London actually broke above (check a few bars back)
      let londonBroke = false;
      for (let i = index - 1; i >= Math.max(0, index - 24); i--) {
        const prevBar = data[i]!;
        const prevHour = new Date(prevBar.timestamp).getUTCHours();
        if (prevHour >= 2 && prevHour < 5 && prevBar.high > asiaHigh) {
          londonBroke = true;
          break;
        }
      }

      if (londonBroke || bar.close > asiaHigh + atr * BREAKOUT_ATR_FACTOR) {
        return {
          type: "BUY",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `ICT Killzones: NY AM continuation above Asia range (${asiaLow.toFixed(2)}-${asiaHigh.toFixed(2)})${cleanRange ? ", clean Asia range" : ""}`,
        };
      }
    } else if (bar.close < asiaLow && inNyAm) {
      // SELL: London broke below Asia range and we're in NY AM
      let londonBroke = false;
      for (let i = index - 1; i >= Math.max(0, index - 24); i--) {
        const prevBar = data[i]!;
        const prevHour = new Date(prevBar.timestamp).getUTCHours();
        if (prevHour >= 2 && prevHour < 5 && prevBar.low < asiaLow) {
          londonBroke = true;
          break;
        }
      }

      if (londonBroke || bar.close < asiaLow - atr * BREAKOUT_ATR_FACTOR) {
        return {
          type: "SELL",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `ICT Killzones: NY AM continuation below Asia range (${asiaLow.toFixed(2)}-${asiaHigh.toFixed(2)})${cleanRange ? ", clean Asia range" : ""}`,
        };
      }
    } else if (inLondon) {
      // During London session: detect initial breakout
      if (bar.close > asiaHigh + atr * BREAKOUT_ATR_FACTOR && cleanRange) {
        return {
          type: "BUY",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `ICT Killzones: London breakout above Asia range with conviction (${asiaLow.toFixed(2)}-${asiaHigh.toFixed(2)})`,
        };
      } else if (bar.close < asiaLow - atr * BREAKOUT_ATR_FACTOR && cleanRange) {
        return {
          type: "SELL",
          price: bar.close,
          timestamp: bar.timestamp,
          reason: `ICT Killzones: London breakout below Asia range with conviction (${asiaLow.toFixed(2)}-${asiaHigh.toFixed(2)})`,
        };
      }
    }

    return null;
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  /**
   * Extract UTC hour from a candle's openTime timestamp.
   * Returns null if no timestamp is available.
   */
  private getUtcHour(candle: Candle): number | null {
    if (candle.openTime != null && candle.openTime > 0) {
      return new Date(candle.openTime).getUTCHours();
    }
    if (candle.closeTime != null && candle.closeTime > 0) {
      return new Date(candle.closeTime).getUTCHours();
    }
    return null;
  }

  /**
   * Identify which killzone a given UTC hour belongs to.
   * Returns null if the hour is not in any active killzone.
   */
  private identifyKillzone(hour: number): KillzoneName | null {
    // Asia wraps midnight: 20-23 and 0
    if (hour >= 20 || hour === 0) return "asia";
    if (hour >= 2 && hour < 5) return "london";
    if (hour >= 7 && hour < 10) return "ny_am";
    if (hour >= 12 && hour < 13) return "ny_lunch";
    if (hour >= 13 && hour < 16) return "ny_pm";
    return null;
  }

  /**
   * Determine if a candle's hour falls within a specific session.
   */
  private isInSession(hour: number, session: KillzoneName): boolean {
    switch (session) {
      case "asia":
        return hour >= 20 || hour < 1; // 20:00-00:59 UTC
      case "london":
        return hour >= 2 && hour < 5;
      case "ny_am":
        return hour >= 7 && hour < 10;
      case "ny_lunch":
        return hour >= 12 && hour < 13;
      case "ny_pm":
        return hour >= 13 && hour < 16;
      default:
        return false;
    }
  }

  /**
   * Compute the high, low, and total volume for candles in a given session.
   * Looks through recent candles (backward from end) to find the most recent
   * occurrence of the session.
   */
  private computeSessionRange(candles: Candle[], session: KillzoneName): SessionRange | null {
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;
    let count = 0;

    // Scan backward to find the most recent occurrence of this session
    // Limit search to last 96 candles (covers ~4 days on 1h, ~1 day on 15m)
    const searchLimit = Math.max(0, candles.length - 96);
    let foundSession = false;
    let _passedSession = false;

    for (let i = candles.length - 1; i >= searchLimit; i--) {
      const candle = candles[i]!;
      const hour = this.getUtcHour(candle);
      if (hour === null) continue;

      const inSession = this.isInSession(hour, session);

      if (inSession) {
        foundSession = true;
        high = Math.max(high, candle.high);
        low = Math.min(low, candle.low);
        volume += candle.volume;
        count++;
      } else if (foundSession && !inSession) {
        // We've passed through the session, stop collecting
        _passedSession = true;
        break;
      }
    }

    if (!foundSession || count === 0) return null;

    return { high, low, volume, candleCount: count };
  }

  /**
   * Get aggregate volume for candles in the current session.
   */
  private getCurrentSessionVolume(candles: Candle[], session: KillzoneName): number {
    let volume = 0;
    // Look at last 20 candles for current session volume
    const startIdx = Math.max(0, candles.length - 20);
    for (let i = startIdx; i < candles.length; i++) {
      const candle = candles[i]!;
      const hour = this.getUtcHour(candle);
      if (hour !== null && this.isInSession(hour, session)) {
        volume += candle.volume;
      }
    }
    return volume;
  }
}

export const ictKillzonesStrategy = new IctKillzonesStrategy();
