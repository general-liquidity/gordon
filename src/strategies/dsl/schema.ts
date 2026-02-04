/**
 * Strategy DSL Schema
 *
 * Defines Zod schemas for the Strategy Domain Specific Language (DSL).
 * This enables AI-generated strategy definitions that can be validated
 * and interpreted into executable trading strategies.
 */

import { z } from "zod";

// ============================================================================
// Indicator Condition Schema
// ============================================================================

/**
 * Indicator-based condition (e.g., RSI > 70, MACD crosses signal line)
 */
export const IndicatorConditionSchema = z.object({
  type: z.literal("indicator"),
  indicator: z.enum([
    "rsi",
    "macd",
    "sma",
    "ema",
    "bollinger",
    "atr",
    "vwap",
    "stochastic",
    "adx",
    "volume",
  ]),
  /** Indicator parameters (e.g., { period: 14 } for RSI) */
  params: z.record(z.string(), z.number()).optional(),
  /** Comparison operator */
  comparison: z.enum([
    "gt",        // Greater than
    "lt",        // Less than
    "gte",       // Greater than or equal
    "lte",       // Less than or equal
    "eq",        // Equal (with tolerance)
    "cross_above", // Crosses above
    "cross_below", // Crosses below
  ]),
  /** Value to compare against - number or indicator reference like 'sma_20' */
  value: z.union([z.number(), z.string()]),
});

export type IndicatorCondition = z.infer<typeof IndicatorConditionSchema>;

// ============================================================================
// Price Condition Schema
// ============================================================================

/**
 * Price-based condition (e.g., near support, breakout)
 */
export const PriceConditionSchema = z.object({
  type: z.literal("price"),
  condition: z.enum([
    "near_support",     // Price close to support level
    "near_resistance",  // Price close to resistance level
    "breakout_above",   // Price breaks above level
    "breakout_below",   // Price breaks below level
    "in_range",         // Price within a range
  ]),
  /** Percentage threshold for condition (0-20%) */
  threshold: z.number().min(0).max(20).optional(),
});

export type PriceCondition = z.infer<typeof PriceConditionSchema>;

// ============================================================================
// Pattern Condition Schema
// ============================================================================

/**
 * Candlestick pattern condition (e.g., bullish engulfing)
 */
export const PatternConditionSchema = z.object({
  type: z.literal("pattern"),
  pattern: z.enum([
    "engulfing",       // Engulfing pattern
    "doji",            // Doji (indecision)
    "hammer",          // Hammer (bullish reversal)
    "shooting_star",   // Shooting star (bearish reversal)
    "morning_star",    // Morning star (bullish reversal)
    "evening_star",    // Evening star (bearish reversal)
    "three_soldiers",  // Three white soldiers (bullish)
    "three_crows",     // Three black crows (bearish)
  ]),
  /** Direction filter for the pattern */
  direction: z.enum(["bullish", "bearish", "any"]).optional(),
});

export type PatternCondition = z.infer<typeof PatternConditionSchema>;

// ============================================================================
// Combined Condition Schema
// ============================================================================

/**
 * Union of all condition types using discriminated union on 'type'
 */
export const ConditionSchema = z.discriminatedUnion("type", [
  IndicatorConditionSchema,
  PriceConditionSchema,
  PatternConditionSchema,
]);

export type Condition = z.infer<typeof ConditionSchema>;

// ============================================================================
// Signal Rule Schema
// ============================================================================

/**
 * A group of conditions that form a trading signal rule
 */
export const SignalRuleSchema = z.object({
  /** Human-readable name for the rule */
  name: z.string(),
  /** Conditions that must be met */
  conditions: z.array(ConditionSchema).min(1),
  /** How to combine conditions */
  operator: z.enum(["AND", "OR"]).default("AND"),
  /** Weight of this rule (0-1) for confidence calculation */
  weight: z.number().min(0).max(1).default(1),
});

export type SignalRule = z.infer<typeof SignalRuleSchema>;

// ============================================================================
// Stop Loss Schema
// ============================================================================

/**
 * Stop loss configuration
 */
export const StopLossSchema = z.object({
  /** Type of stop loss calculation */
  type: z.enum([
    "atr",      // ATR-based stop
    "percent",  // Fixed percentage
    "support",  // Below support level
    "fixed",    // Fixed price distance
  ]),
  /** Value for calculation (ATR periods, percentage, or price) */
  value: z.number(),
  /** Multiplier for ATR-based stops */
  multiplier: z.number().optional(),
});

export type StopLoss = z.infer<typeof StopLossSchema>;

// ============================================================================
// Take Profit Schema
// ============================================================================

/**
 * Take profit level configuration
 */
export const TakeProfitSchema = z.object({
  /** Target type - number for R:R, or special targets */
  target: z.union([
    z.number(),
    z.enum(["resistance", "atr_multiple"]),
  ]),
  /** Value for special targets (ATR multiple or fixed price) */
  targetValue: z.number().optional(),
  /** Percentage of position to close at this level (0-1) */
  percent: z.number().min(0).max(1),
});

export type TakeProfit = z.infer<typeof TakeProfitSchema>;

// ============================================================================
// Trailing Stop Schema
// ============================================================================

/**
 * Trailing stop configuration
 */
export const TrailingStopSchema = z.object({
  /** Whether trailing stop is enabled */
  enabled: z.boolean(),
  /** Profit percentage required to activate trailing stop */
  activation: z.number().optional(),
  /** Trail distance as percentage */
  distance: z.number().optional(),
});

export type TrailingStop = z.infer<typeof TrailingStopSchema>;

// ============================================================================
// Filters Schema
// ============================================================================

/**
 * Market condition filters
 */
export const FiltersSchema = z.object({
  /** Minimum volume (as ratio to average) */
  minVolume: z.number().optional(),
  /** Minimum volatility (as ATR percentage) */
  minVolatility: z.number().optional(),
  /** Maximum volatility (as ATR percentage) */
  maxVolatility: z.number().optional(),
  /** Trend direction filter */
  trendFilter: z.enum(["up", "down", "any"]).optional(),
});

export type Filters = z.infer<typeof FiltersSchema>;

// ============================================================================
// Metadata Schema
// ============================================================================

/**
 * Strategy metadata for tracking origin and performance
 */
export const MetadataSchema = z.object({
  /** When the strategy was generated */
  generatedAt: z.string().optional(),
  /** Original prompt or description used to generate */
  generatedFrom: z.string().optional(),
  /** Backtest results if available */
  backtestResults: z.record(z.string(), z.unknown()).optional(),
  /** User who created/modified the strategy */
  author: z.string().optional(),
  /** Tags for categorization */
  tags: z.array(z.string()).optional(),
});

export type Metadata = z.infer<typeof MetadataSchema>;

// ============================================================================
// Full Strategy DSL Schema
// ============================================================================

/**
 * Complete Strategy DSL definition
 */
export const StrategyDSLSchema = z.object({
  /** Unique identifier (lowercase, alphanumeric with underscores) */
  id: z.string().regex(/^[a-z][a-z0-9_]*$/, "ID must start with a letter and contain only lowercase letters, numbers, and underscores"),
  /** Human-readable name */
  name: z.string().max(100),
  /** Strategy description */
  description: z.string().max(500),
  /** Version string */
  version: z.string().default("1.0.0"),

  /** Skill tier (1 = beginner, 2 = intermediate) */
  tier: z.enum(["1", "2"]).default("1"),
  /** Risk level classification */
  riskLevel: z.enum(["low", "medium", "high"]),
  /** Recommended timeframes */
  timeframes: z.array(z.string()).min(1),

  /** Entry rules for long and short positions */
  entryRules: z.object({
    long: z.array(SignalRuleSchema).min(1),
    short: z.array(SignalRuleSchema).optional(),
  }),

  /** Exit rules including stops and take profits */
  exitRules: z.object({
    stopLoss: StopLossSchema,
    takeProfit: z.array(TakeProfitSchema).min(1),
    trailingStop: TrailingStopSchema.optional(),
  }),

  /** Market condition filters */
  filters: FiltersSchema.optional(),

  /** List of required indicator names */
  requiredIndicators: z.array(z.string()),

  /** Strategy metadata */
  metadata: MetadataSchema.optional(),
});

export type StrategyDSL = z.infer<typeof StrategyDSLSchema>;

// ============================================================================
// Validation Helpers
// ============================================================================

/**
 * Validate a strategy DSL object
 */
export function validateStrategyDSL(data: unknown): {
  success: boolean;
  data?: StrategyDSL;
  errors?: string[];
} {
  const result = StrategyDSLSchema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data };
  }

  const errors = result.error.issues.map((e) => {
    const path = e.path.join(".");
    return `${path}: ${e.message}`;
  });

  return { success: false, errors };
}

/**
 * Create a partial DSL with defaults applied
 */
export function createStrategyDSL(partial: Partial<StrategyDSL> & {
  id: string;
  name: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  timeframes: string[];
  entryRules: StrategyDSL["entryRules"];
  exitRules: StrategyDSL["exitRules"];
  requiredIndicators: string[];
}): StrategyDSL {
  return {
    version: "1.0.0",
    tier: "1",
    ...partial,
  };
}

// ============================================================================
// Example DSL Templates
// ============================================================================

/**
 * Example: RSI Oversold Bounce Strategy DSL
 */
export const EXAMPLE_RSI_BOUNCE_DSL: StrategyDSL = {
  id: "rsi_oversold_bounce",
  name: "RSI Oversold Bounce",
  description: "Buy when RSI is oversold with price near support",
  version: "1.0.0",
  tier: "1",
  riskLevel: "low",
  timeframes: ["4h", "1d"],

  entryRules: {
    long: [
      {
        name: "RSI Oversold",
        conditions: [
          {
            type: "indicator",
            indicator: "rsi",
            params: { period: 14 },
            comparison: "lt",
            value: 30,
          },
        ],
        operator: "AND",
        weight: 0.6,
      },
      {
        name: "Near Support",
        conditions: [
          {
            type: "price",
            condition: "near_support",
            threshold: 3,
          },
        ],
        operator: "AND",
        weight: 0.4,
      },
    ],
  },

  exitRules: {
    stopLoss: {
      type: "atr",
      value: 14,
      multiplier: 1.5,
    },
    takeProfit: [
      { target: 1.5, percent: 0.4 },
      { target: 2.5, percent: 0.35 },
      { target: 4, percent: 0.25 },
    ],
    trailingStop: {
      enabled: true,
      activation: 2,
      distance: 1,
    },
  },

  filters: {
    minVolume: 1.0,
    trendFilter: "any",
  },

  requiredIndicators: ["rsi14", "atr14", "sma50", "sma200"],

  metadata: {
    generatedFrom: "Example template for RSI oversold strategy",
    tags: ["mean-reversion", "oversold", "beginner"],
  },
};

/**
 * Example: MACD Crossover Strategy DSL
 */
export const EXAMPLE_MACD_CROSSOVER_DSL: StrategyDSL = {
  id: "macd_crossover",
  name: "MACD Crossover",
  description: "Trade MACD line crossing above signal line with trend confirmation",
  version: "1.0.0",
  tier: "2",
  riskLevel: "medium",
  timeframes: ["1h", "4h"],

  entryRules: {
    long: [
      {
        name: "MACD Cross Above Signal",
        conditions: [
          {
            type: "indicator",
            indicator: "macd",
            comparison: "cross_above",
            value: "signal",
          },
        ],
        operator: "AND",
        weight: 0.7,
      },
      {
        name: "Uptrend Filter",
        conditions: [
          {
            type: "indicator",
            indicator: "sma",
            params: { period: 50 },
            comparison: "gt",
            value: "sma_200",
          },
        ],
        operator: "AND",
        weight: 0.3,
      },
    ],
    short: [
      {
        name: "MACD Cross Below Signal",
        conditions: [
          {
            type: "indicator",
            indicator: "macd",
            comparison: "cross_below",
            value: "signal",
          },
        ],
        operator: "AND",
        weight: 0.7,
      },
      {
        name: "Downtrend Filter",
        conditions: [
          {
            type: "indicator",
            indicator: "sma",
            params: { period: 50 },
            comparison: "lt",
            value: "sma_200",
          },
        ],
        operator: "AND",
        weight: 0.3,
      },
    ],
  },

  exitRules: {
    stopLoss: {
      type: "atr",
      value: 14,
      multiplier: 2,
    },
    takeProfit: [
      { target: 2, percent: 0.5 },
      { target: 3, percent: 0.3 },
      { target: 5, percent: 0.2 },
    ],
  },

  filters: {
    minVolume: 1.2,
    minVolatility: 0.5,
    maxVolatility: 5,
  },

  requiredIndicators: ["macdLine", "macdSignal", "macdHistogram", "sma50", "sma200", "atr14"],

  metadata: {
    generatedFrom: "Example template for MACD crossover strategy",
    tags: ["trend-following", "momentum", "intermediate"],
  },
};
