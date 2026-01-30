/**
 * Base Strategy Class
 *
 * Abstract base class providing common functionality for all strategies.
 * Strategies extend this class to inherit helper methods for indicator
 * calculations, candle fetching, and level detection.
 */

import type { Candle } from "../core/indicators/types.ts";
import type {
  Strategy,
  StrategyId,
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  TakeProfitLevel,
} from "./types.ts";
import {
  calculateRSI,
  calculateEMA,
  calculateSMA,
  calculateMACD,
  calculateATR,
  calculateBollingerBands,
  calculateVWAP,
  calculateStochasticRSI,
  type RSIResult,
  type MACDResult,
  type ATRResult,
  type BollingerResult,
  type VWAPResult,
  type StochasticRSIResult,
} from "../core/indicators/index.ts";
import { detectLevels } from "../indicators/index.ts";
import type { Level } from "../types/index.ts";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_CANDLE_LIMIT = 100;
const DEFAULT_TIMEFRAME = "4h";

// ============================================================================
// Base Strategy Class
// ============================================================================

/**
 * Abstract base class for all strategies.
 * Provides common helper methods and enforces the Strategy interface.
 */
export abstract class BaseStrategy implements Strategy {
  // Strategy metadata (must be set by subclass)
  abstract readonly id: StrategyId;
  abstract readonly name: string;
  abstract readonly tier: 1 | 2;
  abstract readonly description: string;
  abstract readonly indicators: string[];
  abstract readonly timeframes: string[];
  abstract readonly riskLevel: "low" | "medium" | "high";

  // Abstract methods (must be implemented by subclass)
  abstract detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult>;

  abstract getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams>;

  abstract getPromptFragment(): string;

  // ============================================================================
  // Helper Methods for Subclasses
  // ============================================================================

  /**
   * Fetch candles from Binance.
   * Uses cached candles from context if available.
   */
  protected async fetchCandles(
    ctx: StrategyContext,
    symbol: string,
    timeframe: string = DEFAULT_TIMEFRAME,
    limit: number = DEFAULT_CANDLE_LIMIT
  ): Promise<Candle[]> {
    // Use cached candles if available and match the request
    if (ctx.candles && ctx.candles.length >= limit) {
      return ctx.candles;
    }

    return ctx.binance.getCandles(symbol, timeframe, limit);
  }

  /**
   * Get current price from candles or context.
   */
  protected getCurrentPrice(candles: Candle[], ctx: StrategyContext): number {
    if (ctx.currentPrice) {
      return ctx.currentPrice;
    }
    const lastCandle = candles[candles.length - 1];
    return lastCandle?.close ?? 0;
  }

  /**
   * Extract close prices from candles.
   */
  protected extractPrices(candles: Candle[]): number[] {
    return candles.map((c) => c.close);
  }

  /**
   * Calculate RSI with default period of 14.
   */
  protected calculateRSI(candles: Candle[], period: number = 14): RSIResult {
    const prices = this.extractPrices(candles);
    return calculateRSI(prices, period);
  }

  /**
   * Calculate EMA.
   */
  protected calculateEMA(
    candles: Candle[],
    period: number
  ): { values: (number | null)[]; current: number | null; period: number } {
    const prices = this.extractPrices(candles);
    return calculateEMA(prices, period);
  }

  /**
   * Calculate SMA.
   */
  protected calculateSMA(
    candles: Candle[],
    period: number
  ): { values: (number | null)[]; current: number | null } {
    const prices = this.extractPrices(candles);
    const values = calculateSMA(prices, period);
    return {
      values,
      current: values[values.length - 1] ?? null,
    };
  }

  /**
   * Calculate MACD with standard periods.
   */
  protected calculateMACD(
    candles: Candle[],
    fastPeriod: number = 12,
    slowPeriod: number = 26,
    signalPeriod: number = 9
  ): MACDResult {
    const prices = this.extractPrices(candles);
    return calculateMACD(prices, fastPeriod, slowPeriod, signalPeriod);
  }

  /**
   * Calculate ATR for volatility and stop-loss.
   */
  protected calculateATR(
    candles: Candle[],
    period: number = 14,
    multiplier: number = 2
  ): ATRResult {
    const currentPrice = candles[candles.length - 1]?.close ?? 0;
    return calculateATR(candles, period, multiplier, currentPrice);
  }

  /**
   * Calculate Bollinger Bands.
   */
  protected calculateBollingerBands(
    candles: Candle[],
    period: number = 20,
    stdDev: number = 2
  ): BollingerResult {
    const prices = this.extractPrices(candles);
    return calculateBollingerBands(prices, period, stdDev);
  }

  /**
   * Calculate VWAP.
   */
  protected calculateVWAP(candles: Candle[]): VWAPResult {
    const currentPrice = candles[candles.length - 1]?.close ?? 0;
    return calculateVWAP(candles, currentPrice);
  }

  /**
   * Calculate Stochastic RSI.
   */
  protected calculateStochasticRSI(
    candles: Candle[],
    rsiPeriod: number = 14,
    stochPeriod: number = 14,
    kPeriod: number = 3,
    dPeriod: number = 3
  ): StochasticRSIResult {
    const prices = this.extractPrices(candles);
    return calculateStochasticRSI(prices, rsiPeriod, stochPeriod, kPeriod, dPeriod);
  }

  /**
   * Detect support and resistance levels.
   */
  protected detectLevels(candles: Candle[], currentPrice: number): Level[] {
    // Convert Candle to the format expected by detectLevels
    const compatibleCandles = candles.map((c) => ({
      openTime: c.openTime ?? 0,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      closeTime: c.closeTime ?? 0,
    }));
    return detectLevels(compatibleCandles, currentPrice);
  }

  /**
   * Get supports sorted by proximity to current price.
   */
  protected getSupports(levels: Level[], currentPrice: number): Level[] {
    return levels
      .filter((l) => l.type === "support")
      .sort(
        (a, b) =>
          Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
      );
  }

  /**
   * Get resistances sorted by proximity to current price.
   */
  protected getResistances(levels: Level[], currentPrice: number): Level[] {
    return levels
      .filter((l) => l.type === "resistance")
      .sort(
        (a, b) =>
          Math.abs(a.price - currentPrice) - Math.abs(b.price - currentPrice)
      );
  }

  /**
   * Calculate distance to a price level as percentage.
   */
  protected calculateDistancePercent(
    currentPrice: number,
    targetPrice: number
  ): number {
    if (currentPrice === 0) return 0;
    return ((currentPrice - targetPrice) / currentPrice) * 100;
  }

  /**
   * Calculate risk-reward ratio.
   */
  protected calculateRiskReward(
    entryPrice: number,
    stopLoss: number,
    takeProfit: number
  ): number {
    const risk = Math.abs(entryPrice - stopLoss);
    const reward = Math.abs(takeProfit - entryPrice);
    if (risk === 0) return 0;
    return reward / risk;
  }

  /**
   * Create take-profit levels with standard distribution.
   * Default: 40% at TP1, 40% at TP2, 20% at TP3
   */
  protected createTakeProfitLevels(
    entryPrice: number,
    stopLoss: number,
    rrTargets: number[] = [1.5, 2.5, 4.0]
  ): TakeProfitLevel[] {
    const risk = Math.abs(entryPrice - stopLoss);
    const distribution = [0.4, 0.4, 0.2];

    return rrTargets.map((rr, i) => ({
      price: entryPrice + risk * rr,
      percentToSell: distribution[i] ?? 0.2,
    }));
  }

  /**
   * Analyze volume trend.
   */
  protected analyzeVolumeTrend(
    candles: Candle[],
    recentPeriods: number = 10,
    olderPeriods: number = 20
  ): "rising" | "falling" | "stable" {
    if (candles.length < recentPeriods + olderPeriods) {
      return "stable";
    }

    const recentCandles = candles.slice(-recentPeriods);
    const recentAvg =
      recentCandles.reduce((sum, c) => sum + c.volume, 0) / recentPeriods;

    const olderCandles = candles.slice(
      -(recentPeriods + olderPeriods),
      -recentPeriods
    );
    const olderAvg =
      olderCandles.reduce((sum, c) => sum + c.volume, 0) / olderPeriods;

    if (olderAvg === 0) return "stable";

    const changeRatio = (recentAvg - olderAvg) / olderAvg;

    if (changeRatio > 0.1) return "rising";
    if (changeRatio < -0.1) return "falling";
    return "stable";
  }

  /**
   * Create a "not detected" result with reasoning.
   */
  protected notDetected(reasoning: string): StrategyDetectionResult {
    return {
      detected: false,
      confidence: 0,
      signals: {},
      reasoning,
    };
  }

  /**
   * Create a "detected" result with signals and reasoning.
   */
  protected detected(
    confidence: number,
    signals: Record<string, unknown>,
    reasoning: string
  ): StrategyDetectionResult {
    return {
      detected: true,
      confidence: Math.max(0, Math.min(1, confidence)),
      signals,
      reasoning,
    };
  }
}
