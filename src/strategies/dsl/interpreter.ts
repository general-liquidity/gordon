/**
 * DSL Strategy Interpreter
 *
 * Converts Strategy DSL definitions into executable Strategy objects
 * that can be used with the backtest engine and strategy registry.
 */

import { BaseStrategy } from "../base-strategy.ts";
import type {
  StrategyId,
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  TakeProfitLevel,
} from "../types.ts";
import type { OHLC, Signal, IndicatorState } from "../../backtest/types.ts";
import type { StrategyDSL, Condition, StopLoss, TakeProfit } from "./schema.ts";
import { validateStrategyDSL } from "./schema.ts";
import { evaluateSignalRule, type EvaluationContext } from "./conditions.ts";

// ============================================================================
// DSL-Based Strategy Class
// ============================================================================

/**
 * Strategy implementation generated from a DSL definition.
 * Extends BaseStrategy to integrate with existing infrastructure.
 */
export class DSLBasedStrategy extends BaseStrategy {
  readonly id: StrategyId;
  readonly name: string;
  readonly tier: 1 | 2;
  readonly description: string;
  readonly indicators: string[];
  readonly timeframes: string[];
  readonly riskLevel: "low" | "medium" | "high";

  private readonly dsl: StrategyDSL;
  private prevBar: OHLC | null = null;
  private prevIndicators: IndicatorState | null = null;

  constructor(dsl: StrategyDSL) {
    super();
    this.dsl = dsl;

    // Map DSL properties to Strategy interface
    this.id = dsl.id as StrategyId;
    this.name = dsl.name;
    this.tier = dsl.tier === "2" ? 2 : 1;
    this.description = dsl.description;
    this.indicators = this.extractIndicatorNames(dsl.requiredIndicators);
    this.timeframes = dsl.timeframes;
    this.riskLevel = dsl.riskLevel;
  }

  /**
   * Get the underlying DSL definition
   */
  getDSL(): StrategyDSL {
    return this.dsl;
  }

  // ============================================================================
  // Strategy Interface Implementation
  // ============================================================================

  async detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext,
  ): Promise<StrategyDetectionResult> {
    const candles = await this.fetchCandles(ctx, symbol, timeframe, 100);
    if (candles.length < 30) {
      return this.notDetected("Insufficient data (need 30+ candles)");
    }

    const currentPrice = this.getCurrentPrice(candles, ctx);
    if (currentPrice === 0) {
      return this.notDetected("Could not determine current price");
    }

    // Build indicator state from candles
    const indicatorState = this.buildIndicatorState(candles, currentPrice);

    // Get current and previous bars
    const currentBar = candles[candles.length - 1];
    const prevBar = candles[candles.length - 2];

    if (!currentBar) {
      return this.notDetected("No current bar data");
    }

    // Convert to OHLC format
    const bar: OHLC = {
      timestamp: currentBar.openTime ?? Date.now(),
      open: currentBar.open,
      high: currentBar.high,
      low: currentBar.low,
      close: currentBar.close,
      volume: currentBar.volume,
    };

    const prev: OHLC | undefined = prevBar
      ? {
          timestamp: prevBar.openTime ?? Date.now(),
          open: prevBar.open,
          high: prevBar.high,
          low: prevBar.low,
          close: prevBar.close,
          volume: prevBar.volume,
        }
      : undefined;

    // Check filters first
    if (this.dsl.filters) {
      const filterResult = this.checkFilters(bar, indicatorState);
      if (!filterResult.passed) {
        return this.notDetected(filterResult.reason);
      }
    }

    // Evaluate long entry rules
    const evalCtx: EvaluationContext = {
      bar,
      indicators: indicatorState,
      prevBar: prev,
      prevIndicators: indicatorState, // Simplified - would need history for accurate prev
      supportLevels: indicatorState.nearestSupport ? [indicatorState.nearestSupport] : [],
      resistanceLevels: indicatorState.nearestResistance ? [indicatorState.nearestResistance] : [],
    };

    let totalConfidence = 0;
    let totalWeight = 0;
    const signals: Record<string, unknown> = {};
    const reasons: string[] = [];

    for (const rule of this.dsl.entryRules.long) {
      const result = evaluateSignalRule(rule.conditions, rule.operator, evalCtx);

      if (result.met) {
        const weight = rule.weight;
        totalConfidence += result.confidence * weight;
        totalWeight += weight;
        signals[rule.name] = {
          met: true,
          confidence: result.confidence,
          reasons: result.reasons,
        };
        reasons.push(`${rule.name}: ${result.reasons.join(", ")}`);
      }
    }

    if (totalWeight === 0) {
      return this.notDetected("No entry conditions met");
    }

    const avgConfidence = totalConfidence / totalWeight;

    // Add indicator values to signals
    signals.indicators = indicatorState;
    signals.price = currentPrice;

    return this.detected(avgConfidence, signals, reasons.join(". "));
  }

  async getPlanParameters(symbol: string, ctx: StrategyContext): Promise<StrategyPlanParams> {
    const candles = await this.fetchCandles(ctx, symbol, "4h", 100);
    const currentPrice = this.getCurrentPrice(candles, ctx);

    const atr = this.calculateATR(candles);
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);
    const resistances = this.getResistances(levels, currentPrice);

    const entryPrice = currentPrice;

    // Calculate stop loss
    const stopLoss = this.calculateStopLoss(
      this.dsl.exitRules.stopLoss,
      entryPrice,
      atr.current ?? entryPrice * 0.02,
      supports[0]?.price,
    );

    // Calculate take profits
    const risk = entryPrice - stopLoss;
    const takeProfits = this.calculateTakeProfits(
      this.dsl.exitRules.takeProfit,
      entryPrice,
      risk,
      atr.current ?? entryPrice * 0.02,
      resistances[0]?.price,
    );

    // Calculate average take profit for R:R
    const avgTpPrice = takeProfits.reduce((sum, tp) => sum + tp.price * tp.percentToSell, 0);
    const riskRewardRatio = this.calculateRiskReward(entryPrice, stopLoss, avgTpPrice);

    const notes = [
      `${this.name} setup.`,
      `Stop at $${stopLoss.toFixed(2)}.`,
      `R:R ${riskRewardRatio.toFixed(1)}:1`,
    ];

    if (this.dsl.exitRules.trailingStop?.enabled) {
      notes.push(
        `Trailing stop activates at ${this.dsl.exitRules.trailingStop.activation ?? 2}% profit`,
      );
    }

    return {
      entryPrice,
      stopLoss,
      takeProfits,
      riskRewardRatio,
      notes: notes.join(" "),
    };
  }

  getPromptFragment(): string {
    const dsl = this.dsl;

    const entryRules = dsl.entryRules.long
      .map(
        (r) =>
          `- ${r.name}: ${r.conditions.map((c) => this.conditionToText(c)).join(` ${r.operator} `)}`,
      )
      .join("\n");

    const tpRules = dsl.exitRules.takeProfit
      .map((tp, i) => `- TP${i + 1}: ${this.takeProfitToText(tp)}`)
      .join("\n");

    return `
## ${dsl.name} Strategy Rules

${dsl.description}

### Entry Rules (Long)
${entryRules}

### Stop-Loss Rules
- Type: ${dsl.exitRules.stopLoss.type}
- Value: ${dsl.exitRules.stopLoss.value}${dsl.exitRules.stopLoss.multiplier ? ` (${dsl.exitRules.stopLoss.multiplier}x)` : ""}

### Take-Profit Rules
${tpRules}

### Risk Management
- Risk Level: ${dsl.riskLevel}
- Recommended Timeframes: ${dsl.timeframes.join(", ")}

### Required Indicators
${dsl.requiredIndicators.join(", ")}
`;
  }

  // ============================================================================
  // Backtesting Methods
  // ============================================================================

  override generateSignal(
    bar: OHLC,
    _index: number,
    _data: OHLC[],
    indicators: IndicatorState,
  ): Signal | null {
    const evalCtx: EvaluationContext = {
      bar,
      indicators,
      prevBar: this.prevBar ?? undefined,
      prevIndicators: this.prevIndicators ?? undefined,
      supportLevels: indicators.nearestSupport ? [indicators.nearestSupport] : [],
      resistanceLevels: indicators.nearestResistance ? [indicators.nearestResistance] : [],
    };

    // Check filters
    if (this.dsl.filters) {
      const filterResult = this.checkFilters(bar, indicators);
      if (!filterResult.passed) {
        this.updatePrevState(bar, indicators);
        return null;
      }
    }

    // Check for SELL signal first (exit long)
    // Check if price hits take profit or stop loss levels
    // This is handled by the backtest engine, but we can generate signals
    // for condition-based exits

    // Check for BUY signal (long entry)
    let longSignal = false;
    const longReasons: string[] = [];

    for (const rule of this.dsl.entryRules.long) {
      const result = evaluateSignalRule(rule.conditions, rule.operator, evalCtx);
      if (result.met) {
        longSignal = true;
        longReasons.push(rule.name);
      }
    }

    // Check for SELL signal (short entry) if defined
    let shortSignal = false;
    const shortReasons: string[] = [];

    if (this.dsl.entryRules.short) {
      for (const rule of this.dsl.entryRules.short) {
        const result = evaluateSignalRule(rule.conditions, rule.operator, evalCtx);
        if (result.met) {
          shortSignal = true;
          shortReasons.push(rule.name);
        }
      }
    }

    // Update previous state for next iteration
    this.updatePrevState(bar, indicators);

    if (longSignal) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: `${this.name}: ${longReasons.join(", ")}`,
      };
    }

    if (shortSignal) {
      return {
        type: "SELL",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: `${this.name} short: ${shortReasons.join(", ")}`,
      };
    }

    return null;
  }

  override getRequiredIndicators(): string[] {
    return this.dsl.requiredIndicators;
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  private updatePrevState(bar: OHLC, indicators: IndicatorState): void {
    this.prevBar = { ...bar };
    this.prevIndicators = { ...indicators };
  }

  private checkFilters(bar: OHLC, indicators: IndicatorState): { passed: boolean; reason: string } {
    const filters = this.dsl.filters;
    if (!filters) {
      return { passed: true, reason: "" };
    }

    // Volume filter
    if (filters.minVolume !== undefined) {
      const volumeRatio = indicators.volumeRatio ?? 1;
      if (volumeRatio < filters.minVolume) {
        return {
          passed: false,
          reason: `Volume too low (${volumeRatio.toFixed(1)}x < ${filters.minVolume}x)`,
        };
      }
    }

    // Volatility filter
    if (filters.minVolatility !== undefined || filters.maxVolatility !== undefined) {
      const atr = indicators.atr14 ?? 0;
      const volatilityPct = (atr / bar.close) * 100;

      if (filters.minVolatility !== undefined && volatilityPct < filters.minVolatility) {
        return {
          passed: false,
          reason: `Volatility too low (${volatilityPct.toFixed(1)}% < ${filters.minVolatility}%)`,
        };
      }

      if (filters.maxVolatility !== undefined && volatilityPct > filters.maxVolatility) {
        return {
          passed: false,
          reason: `Volatility too high (${volatilityPct.toFixed(1)}% > ${filters.maxVolatility}%)`,
        };
      }
    }

    // Trend filter
    if (filters.trendFilter && filters.trendFilter !== "any") {
      const sma50 = indicators.sma50 ?? bar.close;
      const sma200 = indicators.sma200 ?? bar.close;

      if (filters.trendFilter === "up" && sma50 < sma200) {
        return { passed: false, reason: "Uptrend filter not met (SMA50 < SMA200)" };
      }

      if (filters.trendFilter === "down" && sma50 > sma200) {
        return { passed: false, reason: "Downtrend filter not met (SMA50 > SMA200)" };
      }
    }

    return { passed: true, reason: "" };
  }

  private calculateStopLoss(
    config: StopLoss,
    entryPrice: number,
    atr: number,
    support?: number,
  ): number {
    switch (config.type) {
      case "atr":
        return entryPrice - atr * (config.multiplier ?? 1.5);

      case "percent":
        return entryPrice * (1 - config.value / 100);

      case "support":
        if (support) {
          return support * (1 - config.value / 100);
        }
        return entryPrice * (1 - config.value / 100);

      case "fixed":
        return entryPrice - config.value;

      default:
        return entryPrice * 0.97; // 3% default
    }
  }

  private calculateTakeProfits(
    configs: TakeProfit[],
    entryPrice: number,
    risk: number,
    atr: number,
    resistance?: number,
  ): TakeProfitLevel[] {
    return configs.map((tp) => {
      let price: number;

      if (typeof tp.target === "number") {
        // R:R based target
        price = entryPrice + risk * tp.target;
      } else if (tp.target === "resistance" && resistance) {
        price = resistance;
      } else if (tp.target === "atr_multiple" && tp.targetValue) {
        price = entryPrice + atr * tp.targetValue;
      } else {
        // Fallback to 2:1 R:R
        price = entryPrice + risk * 2;
      }

      return {
        price,
        percentToSell: tp.percent,
      };
    });
  }

  private buildIndicatorState(
    candles: {
      open: number;
      high: number;
      low: number;
      close: number;
      volume: number;
      openTime?: number;
    }[],
    currentPrice: number,
  ): IndicatorState {
    const state: IndicatorState = {};

    // Calculate common indicators
    const rsi = this.calculateRSI(candles);
    const bb = this.calculateBollingerBands(candles);
    const atr = this.calculateATR(candles);
    const sma20 = this.calculateSMA(candles, 20);
    const sma50 = this.calculateSMA(candles, 50);
    const macd = this.calculateMACD(candles);
    const vwap = this.calculateVWAP(candles);

    state.rsi14 = rsi.current;
    state.bbUpper = bb.current.upper;
    state.bbMiddle = bb.current.middle;
    state.bbLower = bb.current.lower;
    state.bbWidth = bb.current.bandwidth;
    state.atr14 = atr.current;
    state.sma20 = sma20.current;
    state.sma50 = sma50.current;
    state.macdLine = macd.current.macd;
    state.macdSignal = macd.current.signal;
    state.macdHistogram = macd.current.histogram;
    state.vwap = vwap.current;

    // Volume analysis
    const recentVolumes = candles.slice(-20).map((c) => c.volume);
    const avgVolume = recentVolumes.reduce((a, b) => a + b, 0) / recentVolumes.length;
    const lastCandle = candles[candles.length - 1];
    state.volumeAvg20 = avgVolume;
    state.volumeRatio = lastCandle ? lastCandle.volume / avgVolume : 1;

    // Support/Resistance
    const levels = this.detectLevels(candles, currentPrice);
    const supports = this.getSupports(levels, currentPrice);
    const resistances = this.getResistances(levels, currentPrice);

    if (supports.length > 0 && supports[0]) {
      state.nearestSupport = supports[0].price;
      state.supportStrength = supports[0].strength;
    }

    if (resistances.length > 0 && resistances[0]) {
      state.nearestResistance = resistances[0].price;
      state.resistanceStrength = resistances[0].strength;
    }

    return state;
  }

  private extractIndicatorNames(indicators: string[]): string[] {
    // Convert indicator keys to human-readable names
    const nameMap: Record<string, string> = {
      rsi14: "RSI",
      sma20: "SMA",
      sma50: "SMA",
      sma200: "SMA",
      ema12: "EMA",
      ema26: "EMA",
      ema50: "EMA",
      bbUpper: "Bollinger Bands",
      bbMiddle: "Bollinger Bands",
      bbLower: "Bollinger Bands",
      atr14: "ATR",
      macdLine: "MACD",
      macdSignal: "MACD",
      macdHistogram: "MACD",
      vwap: "VWAP",
      volumeRatio: "Volume",
    };

    const names = new Set<string>();
    for (const ind of indicators) {
      const name = nameMap[ind] ?? ind;
      names.add(name);
    }

    return Array.from(names);
  }

  private conditionToText(condition: Condition): string {
    switch (condition.type) {
      case "indicator": {
        const indicator = condition.indicator.toUpperCase();
        const op = condition.comparison.replace("_", " ");
        const value =
          typeof condition.value === "number" ? condition.value.toString() : condition.value;
        return `${indicator} ${op} ${value}`;
      }

      case "price":
        return condition.condition.replace(/_/g, " ");

      case "pattern":
        return `${condition.direction ?? ""} ${condition.pattern}`.trim();

      default:
        return "unknown condition";
    }
  }

  private takeProfitToText(tp: TakeProfit): string {
    const percent = (tp.percent * 100).toFixed(0);

    if (typeof tp.target === "number") {
      return `${tp.target}:1 R:R (sell ${percent}%)`;
    }

    if (tp.target === "resistance") {
      return `At resistance (sell ${percent}%)`;
    }

    if (tp.target === "atr_multiple") {
      return `${tp.targetValue ?? 2}x ATR (sell ${percent}%)`;
    }

    return `Target (sell ${percent}%)`;
  }
}

// ============================================================================
// DSL Strategy Interpreter
// ============================================================================

/**
 * Interpreter that converts DSL definitions to executable strategies
 */
export class DSLStrategyInterpreter {
  /**
   * Interpret a DSL definition into an executable Strategy
   */
  interpret(dsl: StrategyDSL): DSLBasedStrategy {
    // Validate the DSL first
    const validation = this.validate(dsl);
    if (!validation.valid) {
      throw new Error(`Invalid DSL: ${validation.errors?.join(", ")}`);
    }

    return new DSLBasedStrategy(dsl);
  }

  /**
   * Validate a DSL definition
   */
  validate(dsl: unknown): { valid: boolean; errors?: string[] } {
    const result = validateStrategyDSL(dsl);

    if (result.success) {
      // Additional semantic validation
      const errors = this.semanticValidation(result.data!);
      if (errors.length > 0) {
        return { valid: false, errors };
      }
      return { valid: true };
    }

    return { valid: false, errors: result.errors };
  }

  /**
   * Parse and interpret a DSL from JSON string
   */
  parseAndInterpret(json: string): DSLBasedStrategy {
    let parsed: unknown;

    try {
      parsed = JSON.parse(json);
    } catch (e) {
      throw new Error(`Invalid JSON: ${e instanceof Error ? e.message : "parse error"}`);
    }

    const validation = this.validate(parsed);
    if (!validation.valid) {
      throw new Error(`Invalid DSL: ${validation.errors?.join(", ")}`);
    }

    return this.interpret(parsed as StrategyDSL);
  }

  /**
   * Additional semantic validation beyond schema
   */
  private semanticValidation(dsl: StrategyDSL): string[] {
    const errors: string[] = [];

    // Check that take profit percentages sum to ~1
    const tpSum = dsl.exitRules.takeProfit.reduce((sum, tp) => sum + tp.percent, 0);
    if (Math.abs(tpSum - 1) > 0.01) {
      errors.push(`Take profit percentages should sum to 1, got ${tpSum.toFixed(2)}`);
    }

    // Check that required indicators are valid
    const validIndicators = new Set([
      "rsi14",
      "sma20",
      "sma50",
      "sma200",
      "ema9",
      "ema12",
      "ema21",
      "ema26",
      "ema50",
      "bbUpper",
      "bbMiddle",
      "bbLower",
      "bbWidth",
      "atr14",
      "macdLine",
      "macdSignal",
      "macdHistogram",
      "vwap",
      "volumeRatio",
      "volumeAvg20",
      "nearestSupport",
      "nearestResistance",
      "adx",
      "stochK",
      "stochD",
    ]);

    for (const ind of dsl.requiredIndicators) {
      if (!validIndicators.has(ind) && !ind.match(/^(sma|ema|rsi|atr)\d+$/)) {
        // Allow dynamic indicator names like sma100, ema200, etc.
        if (!ind.match(/^[a-z]+\d*$/)) {
          errors.push(`Unknown indicator: ${ind}`);
        }
      }
    }

    // Check trailing stop configuration
    if (dsl.exitRules.trailingStop?.enabled) {
      if (!dsl.exitRules.trailingStop.distance) {
        errors.push("Trailing stop enabled but no distance specified");
      }
    }

    return errors;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a DSL strategy interpreter instance
 */
export function createInterpreter(): DSLStrategyInterpreter {
  return new DSLStrategyInterpreter();
}

/**
 * Quick function to interpret a DSL into a strategy
 */
export function interpretDSL(dsl: StrategyDSL): DSLBasedStrategy {
  const interpreter = new DSLStrategyInterpreter();
  return interpreter.interpret(dsl);
}

/**
 * Parse JSON and create strategy
 */
export function parseStrategy(json: string): DSLBasedStrategy {
  const interpreter = new DSLStrategyInterpreter();
  return interpreter.parseAndInterpret(json);
}
