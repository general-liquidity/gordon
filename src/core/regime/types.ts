/**
 * Market Regime Types
 *
 * Defines the vocabulary for classifying market conditions.
 * Regimes drive playbook selection: a trending market calls for
 * trend-following playbooks, a ranging market for mean-reversion, etc.
 */

import { z } from "zod";

// ============================================================================
// Core Regime Enum
// ============================================================================

export const MarketRegimeSchema = z.enum([
  "trending_up",   // strong bullish trend
  "trending_down", // strong bearish trend
  "ranging",       // sideways, mean-reverting
  "volatile",      // high volatility, no clear direction
  "quiet",         // low volatility, low volume
  "breakout",      // transitioning from quiet/ranging to trending
]);
export type MarketRegime = z.infer<typeof MarketRegimeSchema>;

// ============================================================================
// Regime Signal — a single point-in-time classification
// ============================================================================

export const RegimeMetricsSchema = z.object({
  // Trend strength
  adx: z.number().optional(),
  trend_direction: z.number().optional(),
  ema_alignment: z.number().optional(),

  // Volatility
  atr_percentile: z.number().optional(),
  bollinger_width: z.number().optional(),
  hourly_range_percent: z.number().optional(),

  // Volume
  volume_ratio: z.number().optional(),
  volume_trend: z.enum(["increasing", "decreasing", "stable"]).optional(),

  // Momentum
  rsi: z.number().optional(),
  macd_histogram: z.number().optional(),
});
export type RegimeMetrics = z.infer<typeof RegimeMetricsSchema>;

export const RegimeSignalSchema = z.object({
  regime: MarketRegimeSchema,
  confidence: z.number().min(0).max(1),
  timestamp: z.string().datetime(),

  metrics: RegimeMetricsSchema,

  /** What asset/pair this regime applies to */
  symbol: z.string(),
  /** e.g., "1h", "4h", "1d" */
  timeframe: z.string(),
});
export type RegimeSignal = z.infer<typeof RegimeSignalSchema>;

// ============================================================================
// Regime History — sequence of regime transitions for a symbol
// ============================================================================

export const RegimeSpanSchema = z.object({
  regime: MarketRegimeSchema,
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  duration_hours: z.number(),
  confidence: z.number(),
});
export type RegimeSpan = z.infer<typeof RegimeSpanSchema>;

export const RegimeHistorySchema = z.object({
  symbol: z.string(),
  regimes: z.array(RegimeSpanSchema),
});
export type RegimeHistory = z.infer<typeof RegimeHistorySchema>;

// ============================================================================
// Multi-Timeframe Consensus
// ============================================================================

export const MultiTimeframeRegimeSchema = z.object({
  hourly: RegimeSignalSchema,
  daily: RegimeSignalSchema,
  consensus: MarketRegimeSchema,
  conflicting: z.boolean(),
});
export type MultiTimeframeRegime = z.infer<typeof MultiTimeframeRegimeSchema>;
