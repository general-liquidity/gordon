/**
 * Regime Classifier
 *
 * Core classification engine that takes candle data and returns
 * a MarketRegime classification with confidence and supporting metrics.
 *
 * Classification rules:
 *   trending_up   — ADX > 25, EMA alignment > 0.7, direction > 0
 *   trending_down — ADX > 25, EMA alignment > 0.7, direction < 0
 *   volatile      — ATR percentile > 80, ADX < 25
 *   quiet         — ATR percentile < 20, volume ratio < 0.7
 *   breakout      — ATR percentile jumps from <30 to >60 recently, volume ratio > 1.5
 *   ranging       — default fallback (ADX < 25, normal volatility)
 */

import type { Candle } from "../../types/index.ts";
import type { MarketRegime, RegimeSignal, RegimeMetrics } from "./types.ts";
import {
  calculateADX,
  calculateATR,
  calculateATRPercentile,
  calculateBBWidth,
  calculateEMAAlignment,
  calculateMACD,
  calculateRSI,
  calculateVolumeRatio,
  calculateVolumeTrend,
} from "./indicators.ts";

// ============================================================================
// Classifier
// ============================================================================

export class RegimeClassifier {
  /**
   * Classify the current market regime from candle data.
   *
   * @param candles - OHLCV candle array (most recent last), need >= 30
   * @param symbol  - Trading pair symbol (e.g., "BTCUSDT")
   * @param timeframe - Candle timeframe (e.g., "1h", "4h")
   * @returns RegimeSignal with regime, confidence, and metrics
   */
  classify(candles: Candle[], symbol: string, timeframe: string): RegimeSignal {
    // Compute all indicators
    const adx = calculateADX(candles);
    const { score: emaAlignment, direction: emaDirection } = calculateEMAAlignment(candles);
    const atrPercentile = calculateATRPercentile(candles);
    const _atr = calculateATR(candles);
    const bbWidth = calculateBBWidth(candles);
    const rsi = calculateRSI(candles);
    const volumeRatio = calculateVolumeRatio(candles);
    const volumeTrend = calculateVolumeTrend(candles);
    const macd = calculateMACD(candles);

    // Hourly range (last candle)
    const lastCandle = candles[candles.length - 1];
    const hourlyRangePercent =
      lastCandle && lastCandle.open !== 0
        ? ((lastCandle.high - lastCandle.low) / lastCandle.open) * 100
        : 0;

    const metrics: RegimeMetrics = {
      adx,
      trend_direction: emaDirection,
      ema_alignment: emaAlignment,
      atr_percentile: atrPercentile,
      bollinger_width: bbWidth,
      hourly_range_percent: hourlyRangePercent,
      volume_ratio: volumeRatio,
      volume_trend: volumeTrend,
      rsi,
      macd_histogram: macd.histogram,
    };

    // Detect breakout: ATR jumping from low to high + volume confirmation
    const isBreakout = this.detectBreakout(candles, volumeRatio);

    // Apply classification rules (order matters — more specific first)
    let regime: MarketRegime;
    let confidence: number;

    if (isBreakout) {
      regime = "breakout";
      confidence = this.calcBreakoutConfidence(atrPercentile, volumeRatio, adx);
    } else if (adx > 25 && emaAlignment > 0.7 && emaDirection > 0) {
      regime = "trending_up";
      confidence = this.calcTrendConfidence(adx, emaAlignment);
    } else if (adx > 25 && emaAlignment > 0.7 && emaDirection < 0) {
      regime = "trending_down";
      confidence = this.calcTrendConfidence(adx, emaAlignment);
    } else if (atrPercentile > 80 && adx < 25) {
      regime = "volatile";
      confidence = this.calcVolatileConfidence(atrPercentile, adx);
    } else if (atrPercentile < 20 && volumeRatio < 0.7) {
      regime = "quiet";
      confidence = this.calcQuietConfidence(atrPercentile, volumeRatio);
    } else {
      regime = "ranging";
      confidence = this.calcRangingConfidence(adx, atrPercentile);
    }

    return {
      regime,
      confidence: Math.round(confidence * 100) / 100, // 2 decimal places
      timestamp: new Date().toISOString(),
      metrics,
      symbol,
      timeframe,
    };
  }

  // ---------- Breakout Detection ----------

  /**
   * Detect breakout: ATR percentile recently jumped from below 30 to above 60
   * and volume is elevated.
   */
  private detectBreakout(candles: Candle[], volumeRatio: number): boolean {
    if (candles.length < 30 || volumeRatio < 1.5) return false;

    // Compare ATR percentile of recent candles vs slightly older candles
    const recentSlice = candles.slice(-20);
    const olderSlice = candles.slice(-30, -10);

    const recentATRPct = calculateATRPercentile(recentSlice);
    const olderATRPct = calculateATRPercentile(olderSlice);

    return olderATRPct < 30 && recentATRPct > 60;
  }

  // ---------- Confidence Calculations ----------

  /**
   * Weighted confidence for trending regime.
   * Factors: ADX strength (40%), EMA alignment (40%), RSI confirmation (20%).
   */
  private calcTrendConfidence(adx: number, emaAlignment: number): number {
    // ADX: 25-50 maps to 0.5-1.0
    const adxScore = Math.min(1, Math.max(0, (adx - 25) / 25)) * 0.5 + 0.5;
    // EMA alignment: 0.7-1.0 maps to 0.7-1.0
    const emaScore = emaAlignment;
    return adxScore * 0.4 + emaScore * 0.4 + 0.2; // base 0.2
  }

  /**
   * Confidence for volatile regime.
   * Factors: ATR percentile height (50%), how low ADX is (50%).
   */
  private calcVolatileConfidence(atrPct: number, adx: number): number {
    const atrScore = Math.min(1, (atrPct - 80) / 20) * 0.5 + 0.5;
    const adxScore = Math.min(1, Math.max(0, (25 - adx) / 25));
    return atrScore * 0.5 + adxScore * 0.5;
  }

  /**
   * Confidence for quiet regime.
   * Factors: low ATR percentile (50%), low volume ratio (50%).
   */
  private calcQuietConfidence(atrPct: number, volumeRatio: number): number {
    const atrScore = Math.min(1, Math.max(0, (20 - atrPct) / 20)) * 0.5 + 0.5;
    const volScore = Math.min(1, Math.max(0, (0.7 - volumeRatio) / 0.7));
    return atrScore * 0.5 + volScore * 0.5;
  }

  /**
   * Confidence for ranging regime (default fallback).
   * Lower confidence when ADX is very close to 25 (could be transitioning).
   */
  private calcRangingConfidence(adx: number, atrPct: number): number {
    // The further ADX is below 25, the more confident we are it's ranging
    const adxScore = Math.min(1, Math.max(0, (25 - adx) / 25));
    // Normal ATR (not extreme) increases confidence
    const atrScore = atrPct >= 20 && atrPct <= 80 ? 0.8 : 0.4;
    return adxScore * 0.6 + atrScore * 0.4;
  }

  /**
   * Confidence for breakout regime.
   * Factors: ATR jump magnitude (40%), volume spike (40%), ADX rising (20%).
   */
  private calcBreakoutConfidence(atrPct: number, volumeRatio: number, adx: number): number {
    const atrScore = Math.min(1, (atrPct - 60) / 40);
    const volScore = Math.min(1, (volumeRatio - 1.5) / 1.5);
    const adxBonus = adx > 20 ? 0.15 : 0;
    return Math.min(1, atrScore * 0.4 + volScore * 0.4 + 0.2 + adxBonus);
  }
}
