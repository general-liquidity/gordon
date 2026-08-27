/**
 * Condition Evaluators for Strategy DSL
 *
 * Provides functions to evaluate DSL conditions against market data.
 * Each condition type (indicator, price, pattern) has its own evaluator.
 */

import type { OHLC, IndicatorState } from "../../backtest/types.ts";
import type { Condition, IndicatorCondition, PriceCondition, PatternCondition } from "./schema.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Context for condition evaluation
 */
export interface EvaluationContext {
  /** Current OHLC bar */
  bar: OHLC;
  /** Current indicator values */
  indicators: IndicatorState;
  /** Previous OHLC bar (for crossover detection) */
  prevBar?: OHLC;
  /** Previous indicator values (for crossover detection) */
  prevIndicators?: IndicatorState;
  /** Support levels */
  supportLevels?: number[];
  /** Resistance levels */
  resistanceLevels?: number[];
}

/**
 * Result of condition evaluation
 */
export interface EvaluationResult {
  /** Whether the condition is met */
  met: boolean;
  /** Human-readable reason */
  reason: string;
  /** Confidence score (0-1) */
  confidence: number;
}

// ============================================================================
// Main Evaluation Function
// ============================================================================

/**
 * Evaluate a condition against current market data
 */
export function evaluateCondition(
  condition: Condition,
  bar: OHLC,
  indicators: IndicatorState,
  prevBar?: OHLC,
  prevIndicators?: IndicatorState,
): boolean {
  const ctx: EvaluationContext = {
    bar,
    indicators,
    prevBar,
    prevIndicators,
    supportLevels: indicators.nearestSupport ? [indicators.nearestSupport] : [],
    resistanceLevels: indicators.nearestResistance ? [indicators.nearestResistance] : [],
  };

  switch (condition.type) {
    case "indicator":
      return evaluateIndicatorCondition(condition, ctx).met;
    case "price":
      return evaluatePriceCondition(condition, ctx).met;
    case "pattern":
      return evaluatePatternCondition(condition, ctx).met;
    default:
      return false;
  }
}

/**
 * Evaluate a condition with full result details
 */
export function evaluateConditionWithResult(
  condition: Condition,
  ctx: EvaluationContext,
): EvaluationResult {
  switch (condition.type) {
    case "indicator":
      return evaluateIndicatorCondition(condition, ctx);
    case "price":
      return evaluatePriceCondition(condition, ctx);
    case "pattern":
      return evaluatePatternCondition(condition, ctx);
    default:
      return { met: false, reason: "Unknown condition type", confidence: 0 };
  }
}

// ============================================================================
// Indicator Condition Evaluator
// ============================================================================

/**
 * Evaluate an indicator-based condition
 */
export function evaluateIndicatorCondition(
  condition: IndicatorCondition,
  ctx: EvaluationContext,
): EvaluationResult {
  const { indicator, comparison, value, params } = condition;
  const { indicators, prevIndicators } = ctx;

  // Get current indicator value
  const indicatorParams = params as Record<string, number> | undefined;
  const currentValue = getIndicatorValue(indicator, indicators, indicatorParams);
  if (currentValue === null || currentValue === undefined) {
    return {
      met: false,
      reason: `Indicator ${indicator} not available`,
      confidence: 0,
    };
  }

  // Get comparison value
  const compareValue = typeof value === "number" ? value : getIndicatorReference(value, indicators);

  if (compareValue === null || compareValue === undefined) {
    return {
      met: false,
      reason: `Comparison value ${value} not available`,
      confidence: 0,
    };
  }

  // Handle crossover comparisons
  if (comparison === "cross_above" || comparison === "cross_below") {
    if (!prevIndicators) {
      return {
        met: false,
        reason: "Previous indicators not available for crossover",
        confidence: 0,
      };
    }

    const prevValue = getIndicatorValue(indicator, prevIndicators, indicatorParams);
    const prevCompare =
      typeof value === "number" ? value : getIndicatorReference(value, prevIndicators);

    if (
      prevValue === null ||
      prevValue === undefined ||
      prevCompare === null ||
      prevCompare === undefined
    ) {
      return {
        met: false,
        reason: "Previous values not available for crossover",
        confidence: 0,
      };
    }

    if (comparison === "cross_above") {
      const crossed = prevValue <= prevCompare && currentValue > compareValue;
      return {
        met: crossed,
        reason: crossed
          ? `${indicator} crossed above ${value}`
          : `${indicator} did not cross above ${value}`,
        confidence: crossed ? 0.8 : 0,
      };
    } else {
      const crossed = prevValue >= prevCompare && currentValue < compareValue;
      return {
        met: crossed,
        reason: crossed
          ? `${indicator} crossed below ${value}`
          : `${indicator} did not cross below ${value}`,
        confidence: crossed ? 0.8 : 0,
      };
    }
  }

  // Handle simple comparisons
  let met = false;
  switch (comparison) {
    case "gt":
      met = currentValue > compareValue;
      break;
    case "lt":
      met = currentValue < compareValue;
      break;
    case "gte":
      met = currentValue >= compareValue;
      break;
    case "lte":
      met = currentValue <= compareValue;
      break;
    case "eq":
      // Use 1% tolerance for equality
      met = Math.abs(currentValue - compareValue) <= compareValue * 0.01;
      break;
  }

  const opSymbol = getOperatorSymbol(comparison);
  return {
    met,
    reason: met
      ? `${indicator} (${currentValue.toFixed(2)}) ${opSymbol} ${compareValue.toFixed(2)}`
      : `${indicator} (${currentValue.toFixed(2)}) not ${opSymbol} ${compareValue.toFixed(2)}`,
    confidence: met ? 0.7 : 0,
  };
}

/**
 * Get indicator value from state
 */
function getIndicatorValue(
  indicator: string,
  state: IndicatorState,
  params?: Record<string, number>,
): number | null {
  const period = params?.period;

  switch (indicator) {
    case "rsi":
      return state.rsi14 ?? null;
    case "macd":
      return state.macdLine ?? null;
    case "sma":
      if (period === 20) return state.sma20 ?? null;
      if (period === 50) return state.sma50 ?? null;
      if (period === 200) return state.sma200 ?? null;
      return state.sma20 ?? null;
    case "ema":
      if (period === 12) return state.ema12 ?? null;
      if (period === 26) return state.ema26 ?? null;
      if (period === 50) return state.ema50 ?? null;
      return state.ema12 ?? null;
    case "bollinger":
      return state.bbMiddle ?? null;
    case "atr":
      return state.atr14 ?? null;
    case "vwap":
      return state.vwap ?? null;
    case "volume":
      return state.volumeRatio ?? null;
    case "adx":
      // ADX not in default state, would need custom indicator
      return state.adx ?? null;
    case "stochastic":
      // Would need stochastic in state
      return state.stochK ?? null;
    default:
      // Try direct key lookup
      return state[indicator] ?? null;
  }
}

/**
 * Get indicator value from a reference string like 'sma_20'
 */
function getIndicatorReference(ref: string, state: IndicatorState): number | null {
  // Handle special references
  if (ref === "signal") return state.macdSignal ?? null;
  if (ref === "upper" || ref === "bb_upper") return state.bbUpper ?? null;
  if (ref === "lower" || ref === "bb_lower") return state.bbLower ?? null;
  if (ref === "middle" || ref === "bb_middle") return state.bbMiddle ?? null;

  // Parse reference like 'sma_20'
  const match = ref.match(/^([a-z]+)_?(\d+)?$/);
  if (!match) return null;

  const [, indicator, periodStr] = match;
  const period = periodStr ? parseInt(periodStr, 10) : undefined;

  return getIndicatorValue(indicator ?? "", state, period ? { period } : undefined);
}

/**
 * Get human-readable operator symbol
 */
function getOperatorSymbol(op: string): string {
  switch (op) {
    case "gt":
      return ">";
    case "lt":
      return "<";
    case "gte":
      return ">=";
    case "lte":
      return "<=";
    case "eq":
      return "=";
    default:
      return op;
  }
}

// ============================================================================
// Price Condition Evaluator
// ============================================================================

/**
 * Evaluate a price-based condition
 */
export function evaluatePriceCondition(
  condition: PriceCondition,
  ctx: EvaluationContext,
): EvaluationResult {
  const { condition: condType, threshold = 3 } = condition;
  const { bar, supportLevels = [], resistanceLevels = [] } = ctx;
  const price = bar.close;

  switch (condType) {
    case "near_support": {
      if (supportLevels.length === 0) {
        return { met: false, reason: "No support levels available", confidence: 0 };
      }
      const nearestSupport = supportLevels[0] ?? 0;
      const distance = ((price - nearestSupport) / nearestSupport) * 100;
      const isNear = distance >= 0 && distance <= threshold;
      return {
        met: isNear,
        reason: isNear
          ? `Price ${distance.toFixed(1)}% from support at ${nearestSupport.toFixed(2)}`
          : `Price too far from support (${distance.toFixed(1)}% > ${threshold}%)`,
        confidence: isNear ? Math.max(0, 1 - distance / threshold) : 0,
      };
    }

    case "near_resistance": {
      if (resistanceLevels.length === 0) {
        return { met: false, reason: "No resistance levels available", confidence: 0 };
      }
      const nearestResistance = resistanceLevels[0] ?? 0;
      const distance = ((nearestResistance - price) / price) * 100;
      const isNear = distance >= 0 && distance <= threshold;
      return {
        met: isNear,
        reason: isNear
          ? `Price ${distance.toFixed(1)}% from resistance at ${nearestResistance.toFixed(2)}`
          : `Price too far from resistance (${distance.toFixed(1)}% > ${threshold}%)`,
        confidence: isNear ? Math.max(0, 1 - distance / threshold) : 0,
      };
    }

    case "breakout_above": {
      if (resistanceLevels.length === 0) {
        return { met: false, reason: "No resistance levels available", confidence: 0 };
      }
      const nearestResistance = resistanceLevels[0] ?? 0;
      const { prevBar } = ctx;
      if (!prevBar) {
        return { met: false, reason: "Previous bar not available", confidence: 0 };
      }
      const brokeOut = prevBar.close <= nearestResistance && price > nearestResistance;
      return {
        met: brokeOut,
        reason: brokeOut
          ? `Price broke above resistance at ${nearestResistance.toFixed(2)}`
          : `No breakout above resistance`,
        confidence: brokeOut ? 0.8 : 0,
      };
    }

    case "breakout_below": {
      if (supportLevels.length === 0) {
        return { met: false, reason: "No support levels available", confidence: 0 };
      }
      const nearestSupport = supportLevels[0] ?? 0;
      const { prevBar } = ctx;
      if (!prevBar) {
        return { met: false, reason: "Previous bar not available", confidence: 0 };
      }
      const brokeOut = prevBar.close >= nearestSupport && price < nearestSupport;
      return {
        met: brokeOut,
        reason: brokeOut
          ? `Price broke below support at ${nearestSupport.toFixed(2)}`
          : `No breakout below support`,
        confidence: brokeOut ? 0.8 : 0,
      };
    }

    case "in_range": {
      if (supportLevels.length === 0 || resistanceLevels.length === 0) {
        return { met: false, reason: "Support/resistance levels not available", confidence: 0 };
      }
      const support = supportLevels[0] ?? 0;
      const resistance = resistanceLevels[0] ?? 0;
      const inRange = price >= support && price <= resistance;
      return {
        met: inRange,
        reason: inRange
          ? `Price in range between ${support.toFixed(2)} and ${resistance.toFixed(2)}`
          : `Price outside range`,
        confidence: inRange ? 0.6 : 0,
      };
    }

    default:
      return { met: false, reason: `Unknown price condition: ${condType}`, confidence: 0 };
  }
}

// ============================================================================
// Pattern Condition Evaluator
// ============================================================================

/**
 * Evaluate a candlestick pattern condition
 */
export function evaluatePatternCondition(
  condition: PatternCondition,
  ctx: EvaluationContext,
): EvaluationResult {
  const { pattern, direction = "any" } = condition;
  const { bar, prevBar } = ctx;

  if (!prevBar) {
    return { met: false, reason: "Previous bar required for pattern detection", confidence: 0 };
  }

  switch (pattern) {
    case "engulfing":
      return detectEngulfingPattern(bar, prevBar, direction);

    case "doji":
      return detectDojiPattern(bar, direction);

    case "hammer":
      return detectHammerPattern(bar, direction);

    case "shooting_star":
      return detectShootingStarPattern(bar, direction);

    case "morning_star":
    case "evening_star":
    case "three_soldiers":
    case "three_crows":
      // These patterns require 3 candles - would need more history
      return {
        met: false,
        reason: `Pattern ${pattern} requires more candle history`,
        confidence: 0,
      };

    default:
      return { met: false, reason: `Unknown pattern: ${pattern}`, confidence: 0 };
  }
}

/**
 * Detect engulfing pattern
 */
function detectEngulfingPattern(
  current: OHLC,
  prev: OHLC,
  direction: "bullish" | "bearish" | "any",
): EvaluationResult {
  const prevBody = prev.close - prev.open;
  const currBody = current.close - current.open;

  // Bullish engulfing: prev bearish, current bullish, current engulfs prev
  const isBullishEngulfing =
    prevBody < 0 && // Previous candle bearish
    currBody > 0 && // Current candle bullish
    current.open <= prev.close && // Opens at or below prev close
    current.close >= prev.open; // Closes at or above prev open

  // Bearish engulfing: prev bullish, current bearish, current engulfs prev
  const isBearishEngulfing =
    prevBody > 0 && // Previous candle bullish
    currBody < 0 && // Current candle bearish
    current.open >= prev.close && // Opens at or above prev close
    current.close <= prev.open; // Closes at or below prev open

  if (direction === "bullish" || direction === "any") {
    if (isBullishEngulfing) {
      const ratio = Math.abs(currBody) / Math.abs(prevBody);
      return {
        met: true,
        reason: `Bullish engulfing pattern (${ratio.toFixed(1)}x body ratio)`,
        confidence: Math.min(0.9, 0.6 + ratio * 0.1),
      };
    }
  }

  if (direction === "bearish" || direction === "any") {
    if (isBearishEngulfing) {
      const ratio = Math.abs(currBody) / Math.abs(prevBody);
      return {
        met: true,
        reason: `Bearish engulfing pattern (${ratio.toFixed(1)}x body ratio)`,
        confidence: Math.min(0.9, 0.6 + ratio * 0.1),
      };
    }
  }

  return {
    met: false,
    reason: "No engulfing pattern detected",
    confidence: 0,
  };
}

/**
 * Detect doji pattern
 */
function detectDojiPattern(bar: OHLC, direction: "bullish" | "bearish" | "any"): EvaluationResult {
  const body = Math.abs(bar.close - bar.open);
  const range = bar.high - bar.low;

  if (range === 0) {
    return { met: false, reason: "No price range", confidence: 0 };
  }

  const bodyRatio = body / range;

  // Doji: very small body relative to range (< 10%)
  const isDoji = bodyRatio < 0.1;

  if (isDoji) {
    // Direction hint based on position in range
    const _midPoint = (bar.high + bar.low) / 2;
    const closePosition = (bar.close - bar.low) / range;

    let directionHint = "neutral";
    if (closePosition > 0.6) directionHint = "bullish bias";
    if (closePosition < 0.4) directionHint = "bearish bias";

    if (direction !== "any") {
      const matchesDirection =
        (direction === "bullish" && closePosition > 0.5) ||
        (direction === "bearish" && closePosition < 0.5);

      if (!matchesDirection) {
        return {
          met: false,
          reason: `Doji found but ${direction} direction not confirmed`,
          confidence: 0.3,
        };
      }
    }

    return {
      met: true,
      reason: `Doji pattern detected (${directionHint})`,
      confidence: 0.6,
    };
  }

  return {
    met: false,
    reason: "No doji pattern (body too large)",
    confidence: 0,
  };
}

/**
 * Detect hammer pattern (bullish reversal)
 */
function detectHammerPattern(
  bar: OHLC,
  direction: "bullish" | "bearish" | "any",
): EvaluationResult {
  const body = Math.abs(bar.close - bar.open);
  const range = bar.high - bar.low;

  if (range === 0 || body === 0) {
    return { met: false, reason: "Invalid candle for pattern", confidence: 0 };
  }

  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;

  // Hammer: long lower wick (>= 2x body), small upper wick
  const isHammer =
    lowerWick >= body * 2 && // Long lower wick
    upperWick <= body * 0.5 && // Small upper wick
    body / range <= 0.4; // Body in upper portion

  if (isHammer) {
    if (direction === "bearish") {
      return {
        met: false,
        reason: "Hammer is bullish pattern, bearish direction requested",
        confidence: 0,
      };
    }

    return {
      met: true,
      reason: `Hammer pattern (lower wick ${(lowerWick / body).toFixed(1)}x body)`,
      confidence: 0.7,
    };
  }

  return {
    met: false,
    reason: "No hammer pattern",
    confidence: 0,
  };
}

/**
 * Detect shooting star pattern (bearish reversal)
 */
function detectShootingStarPattern(
  bar: OHLC,
  direction: "bullish" | "bearish" | "any",
): EvaluationResult {
  const body = Math.abs(bar.close - bar.open);
  const range = bar.high - bar.low;

  if (range === 0 || body === 0) {
    return { met: false, reason: "Invalid candle for pattern", confidence: 0 };
  }

  const upperWick = bar.high - Math.max(bar.open, bar.close);
  const lowerWick = Math.min(bar.open, bar.close) - bar.low;

  // Shooting star: long upper wick (>= 2x body), small lower wick
  const isShootingStar =
    upperWick >= body * 2 && // Long upper wick
    lowerWick <= body * 0.5 && // Small lower wick
    body / range <= 0.4; // Body in lower portion

  if (isShootingStar) {
    if (direction === "bullish") {
      return {
        met: false,
        reason: "Shooting star is bearish pattern, bullish direction requested",
        confidence: 0,
      };
    }

    return {
      met: true,
      reason: `Shooting star pattern (upper wick ${(upperWick / body).toFixed(1)}x body)`,
      confidence: 0.7,
    };
  }

  return {
    met: false,
    reason: "No shooting star pattern",
    confidence: 0,
  };
}

// ============================================================================
// Rule Evaluation
// ============================================================================

/**
 * Evaluate a signal rule (group of conditions)
 */
export function evaluateSignalRule(
  conditions: Condition[],
  operator: "AND" | "OR",
  ctx: EvaluationContext,
): { met: boolean; confidence: number; reasons: string[] } {
  const results = conditions.map((c) => evaluateConditionWithResult(c, ctx));
  const reasons = results.map((r) => r.reason);

  if (operator === "AND") {
    const allMet = results.every((r) => r.met);
    const avgConfidence = allMet
      ? results.reduce((sum, r) => sum + r.confidence, 0) / results.length
      : 0;
    return { met: allMet, confidence: avgConfidence, reasons };
  } else {
    const anyMet = results.some((r) => r.met);
    const metResults = results.filter((r) => r.met);
    const maxConfidence = anyMet ? Math.max(...metResults.map((r) => r.confidence)) : 0;
    return { met: anyMet, confidence: maxConfidence, reasons };
  }
}
