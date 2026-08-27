/**
 * DSL Strategy Adapter
 *
 * Converts Strategy DSL definitions into executable strategies
 * compatible with the backtesting engine.
 */

import type { StrategyDSL, SignalRule, TakeProfit } from "./schema.ts";
import type { OHLC, Signal, IndicatorState, Position } from "../../backtest/types.ts";
import { evaluateSignalRule, type EvaluationContext } from "./conditions.ts";

// ============================================================================
// DSL Strategy Adapter
// ============================================================================

/**
 * Adapter that converts a Strategy DSL into an executable strategy
 * for the backtesting engine.
 */
export class DSLStrategyAdapter {
  readonly id: string;
  readonly name: string;
  private dsl: StrategyDSL;
  private prevBar?: OHLC;
  private prevIndicators?: IndicatorState;

  constructor(dsl: StrategyDSL) {
    this.dsl = dsl;
    this.id = dsl.id;
    this.name = dsl.name;
  }

  /**
   * Generate a trading signal based on the DSL rules.
   * This is the main interface for the backtesting engine.
   */
  generateSignal(bar: OHLC, indicators: IndicatorState, position: Position | null): Signal {
    const ctx: EvaluationContext = {
      bar,
      indicators,
      prevBar: this.prevBar,
      prevIndicators: this.prevIndicators,
      supportLevels: indicators.nearestSupport ? [indicators.nearestSupport] : [],
      resistanceLevels: indicators.nearestResistance ? [indicators.nearestResistance] : [],
    };

    // Save for next iteration (for crossover detection)
    this.prevBar = { ...bar };
    this.prevIndicators = { ...indicators };

    // Check filters first
    if (!this.checkFilters(bar, indicators)) {
      return this.holdSignal(bar);
    }

    // If we have a position, check exit conditions
    if (position) {
      const exitSignal = this.checkExitConditions(bar, indicators, position);
      if (exitSignal) {
        return exitSignal;
      }
      return this.holdSignal(bar);
    }

    // Check entry conditions
    const entrySignal = this.checkEntryConditions(ctx);
    if (entrySignal) {
      return entrySignal;
    }

    return this.holdSignal(bar);
  }

  /**
   * Get required indicators for this strategy
   */
  getRequiredIndicators(): string[] {
    return this.dsl.requiredIndicators;
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Check market condition filters
   */
  private checkFilters(bar: OHLC, indicators: IndicatorState): boolean {
    const filters = this.dsl.filters;
    if (!filters) return true;

    // Volume filter
    if (filters.minVolume !== undefined) {
      const volumeRatio = indicators.volumeRatio ?? 1;
      if (volumeRatio < filters.minVolume) {
        return false;
      }
    }

    // Volatility filters
    if (filters.minVolatility !== undefined || filters.maxVolatility !== undefined) {
      const atr = indicators.atr14 ?? 0;
      const volatilityPct = bar.close > 0 ? (atr / bar.close) * 100 : 0;

      if (filters.minVolatility !== undefined && volatilityPct < filters.minVolatility) {
        return false;
      }
      if (filters.maxVolatility !== undefined && volatilityPct > filters.maxVolatility) {
        return false;
      }
    }

    // Trend filter
    if (filters.trendFilter && filters.trendFilter !== "any") {
      const sma50 = indicators.sma50;
      const sma200 = indicators.sma200;

      if (sma50 !== null && sma50 !== undefined && sma200 !== null && sma200 !== undefined) {
        const isUptrend = sma50 > sma200;

        if (filters.trendFilter === "up" && !isUptrend) {
          return false;
        }
        if (filters.trendFilter === "down" && isUptrend) {
          return false;
        }
      }
    }

    return true;
  }

  /**
   * Check entry conditions
   */
  private checkEntryConditions(ctx: EvaluationContext): Signal | null {
    const { entryRules } = this.dsl;

    // Check long entry rules
    if (entryRules.long && entryRules.long.length > 0) {
      const longSignal = this.evaluateEntryRules(entryRules.long, "LONG", ctx);
      if (longSignal) return longSignal;
    }

    // Check short entry rules if defined
    if (entryRules.short && entryRules.short.length > 0) {
      const shortSignal = this.evaluateEntryRules(entryRules.short, "SHORT", ctx);
      if (shortSignal) return shortSignal;
    }

    return null;
  }

  /**
   * Evaluate a set of entry rules
   */
  private evaluateEntryRules(
    rules: SignalRule[],
    direction: "LONG" | "SHORT",
    ctx: EvaluationContext,
  ): Signal | null {
    let totalWeight = 0;
    let weightedScore = 0;
    const triggeredRules: string[] = [];

    for (const rule of rules) {
      const result = evaluateSignalRule(rule.conditions, rule.operator, ctx);

      if (result.met) {
        triggeredRules.push(rule.name);
        totalWeight += rule.weight;
        weightedScore += rule.weight * result.confidence;
      }
    }

    // Require at least 50% of total weight to trigger
    const totalRuleWeight = rules.reduce((sum, r) => sum + r.weight, 0);
    const requiredWeight = totalRuleWeight * 0.5;

    if (totalWeight >= requiredWeight && triggeredRules.length > 0) {
      const avgConfidence = totalWeight > 0 ? weightedScore / totalWeight : 0;

      return {
        type: direction === "LONG" ? "BUY" : "SELL",
        price: ctx.bar.close,
        timestamp: ctx.bar.timestamp,
        reason: `Entry signal: ${triggeredRules.join(", ")} (confidence: ${(avgConfidence * 100).toFixed(0)}%)`,
      };
    }

    return null;
  }

  /**
   * Check exit conditions
   */
  private checkExitConditions(
    bar: OHLC,
    indicators: IndicatorState,
    position: Position,
  ): Signal | null {
    const { exitRules } = this.dsl;

    // Check stop loss
    const stopPrice = this.calculateStopPrice(position, indicators, bar);
    if (stopPrice !== null) {
      if (position.side === "LONG" && bar.low <= stopPrice) {
        return {
          type: "SELL",
          price: stopPrice,
          timestamp: bar.timestamp,
          reason: `Stop loss triggered at ${stopPrice.toFixed(2)}`,
        };
      }
      if (position.side === "SHORT" && bar.high >= stopPrice) {
        return {
          type: "BUY",
          price: stopPrice,
          timestamp: bar.timestamp,
          reason: `Stop loss triggered at ${stopPrice.toFixed(2)}`,
        };
      }
    }

    // Check take profit levels
    for (const tp of exitRules.takeProfit) {
      const tpPrice = this.calculateTakeProfitPrice(position, tp, indicators, bar);
      if (tpPrice !== null) {
        if (position.side === "LONG" && bar.high >= tpPrice) {
          return {
            type: "SELL",
            price: tpPrice,
            timestamp: bar.timestamp,
            reason: `Take profit triggered at ${tpPrice.toFixed(2)} (R:R ${tp.target})`,
          };
        }
        if (position.side === "SHORT" && bar.low <= tpPrice) {
          return {
            type: "BUY",
            price: tpPrice,
            timestamp: bar.timestamp,
            reason: `Take profit triggered at ${tpPrice.toFixed(2)} (R:R ${tp.target})`,
          };
        }
      }
    }

    // Check trailing stop if enabled
    if (exitRules.trailingStop?.enabled) {
      const trailingSignal = this.checkTrailingStop(bar, position, exitRules.trailingStop);
      if (trailingSignal) return trailingSignal;
    }

    return null;
  }

  /**
   * Calculate stop loss price
   */
  private calculateStopPrice(
    position: Position,
    indicators: IndicatorState,
    _bar: OHLC,
  ): number | null {
    const { stopLoss } = this.dsl.exitRules;
    const entry = position.entryPrice;

    switch (stopLoss.type) {
      case "percent": {
        const stopDistance = entry * (stopLoss.value / 100);
        return position.side === "LONG" ? entry - stopDistance : entry + stopDistance;
      }

      case "atr": {
        const atr = indicators.atr14;
        if (atr === null || atr === undefined) return null;
        const multiplier = stopLoss.multiplier ?? 2;
        const stopDistance = atr * multiplier;
        return position.side === "LONG" ? entry - stopDistance : entry + stopDistance;
      }

      case "support": {
        const support = indicators.nearestSupport;
        if (support === null || support === undefined) return null;
        // Place stop slightly below support
        const buffer = entry * 0.002; // 0.2% buffer
        return support - buffer;
      }

      case "fixed": {
        return position.side === "LONG" ? entry - stopLoss.value : entry + stopLoss.value;
      }

      default:
        return null;
    }
  }

  /**
   * Calculate take profit price
   */
  private calculateTakeProfitPrice(
    position: Position,
    tp: TakeProfit,
    indicators: IndicatorState,
    bar: OHLC,
  ): number | null {
    const entry = position.entryPrice;

    // Handle special target types
    if (typeof tp.target === "string") {
      if (tp.target === "resistance") {
        return indicators.nearestResistance ?? null;
      }
      if (tp.target === "atr_multiple") {
        const atr = indicators.atr14;
        if (atr === null || atr === undefined) return null;
        const targetValue = tp.targetValue ?? 3;
        return position.side === "LONG" ? entry + atr * targetValue : entry - atr * targetValue;
      }
      return null;
    }

    // Numeric target is a risk:reward ratio
    const rrRatio = tp.target;

    // Calculate risk (distance to stop loss)
    const stopPrice = this.calculateStopPrice(position, indicators, bar);
    if (stopPrice === null) return null;

    const risk = Math.abs(entry - stopPrice);
    const reward = risk * rrRatio;

    return position.side === "LONG" ? entry + reward : entry - reward;
  }

  /**
   * Check trailing stop condition
   */
  private checkTrailingStop(
    bar: OHLC,
    position: Position,
    config: NonNullable<StrategyDSL["exitRules"]["trailingStop"]>,
  ): Signal | null {
    const { activation, distance } = config;
    if (!activation || !distance) return null;

    const entry = position.entryPrice;
    const pnlPercent =
      position.side === "LONG"
        ? ((bar.close - entry) / entry) * 100
        : ((entry - bar.close) / entry) * 100;

    // Only activate if profit threshold reached
    if (pnlPercent < activation) return null;

    // Calculate trailing stop price
    const trailDistance = bar.close * (distance / 100);
    const trailPrice =
      position.side === "LONG" ? bar.close - trailDistance : bar.close + trailDistance;

    // Check if price hit trailing stop
    if (position.side === "LONG" && bar.low <= trailPrice) {
      return {
        type: "SELL",
        price: trailPrice,
        timestamp: bar.timestamp,
        reason: `Trailing stop triggered at ${trailPrice.toFixed(2)} (${pnlPercent.toFixed(1)}% profit)`,
      };
    }
    if (position.side === "SHORT" && bar.high >= trailPrice) {
      return {
        type: "BUY",
        price: trailPrice,
        timestamp: bar.timestamp,
        reason: `Trailing stop triggered at ${trailPrice.toFixed(2)} (${pnlPercent.toFixed(1)}% profit)`,
      };
    }

    return null;
  }

  /**
   * Create a HOLD signal
   */
  private holdSignal(bar: OHLC): Signal {
    return {
      type: "HOLD",
      price: bar.close,
      timestamp: bar.timestamp,
      reason: "No signal",
    };
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a strategy adapter from DSL
 */
export function createStrategyFromDSL(dsl: StrategyDSL): DSLStrategyAdapter {
  return new DSLStrategyAdapter(dsl);
}
