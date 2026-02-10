/**
 * Strategy Types
 *
 * Core interfaces for the Strategy Library. Each strategy implements these
 * interfaces to provide consistent detection and plan parameter generation.
 */

import type { Candle } from "../core/indicators/types.ts";
import type { Exchange } from "../infra/exchange/index.ts";
import type { OHLC, Signal, IndicatorState } from "../backtest/types.ts";

// ============================================================================
// Strategy Definition (Static Metadata)
// ============================================================================

/**
 * Static metadata about a strategy.
 * This is what users see when listing available strategies.
 */
export interface StrategyDefinition {
  /** Unique identifier (e.g., "support_bounce") */
  id: StrategyId;

  /** Human-readable name (e.g., "Support Bounce") */
  name: string;

  /** Skill tier: 1 = beginner, 2 = intermediate */
  tier: 1 | 2;

  /** Brief description of the strategy */
  description: string;

  /** Technical indicators used by this strategy */
  indicators: string[];

  /** Recommended timeframes for this strategy */
  timeframes: string[];

  /** Risk level when using this strategy */
  riskLevel: "low" | "medium" | "high";
}

// ============================================================================
// Strategy Detection
// ============================================================================

/**
 * Result from strategy detection.
 * Indicates whether conditions are met and with what confidence.
 */
export interface StrategyDetectionResult {
  /** Whether the strategy setup was detected */
  detected: boolean;

  /** Confidence score from 0 to 1 */
  confidence: number;

  /** Individual signals that contributed to detection */
  signals: StrategySignals;

  /** Human-readable explanation of why setup was/wasn't detected */
  reasoning: string;
}

/**
 * Individual signals from strategy detection.
 * Keys and values depend on the specific strategy.
 */
export interface StrategySignals {
  [key: string]: unknown;
}

// ============================================================================
// Strategy Plan Parameters
// ============================================================================

/**
 * Parameters for creating a trading plan based on strategy rules.
 * These are the calculated entry, stop, and target levels.
 */
export interface StrategyPlanParams {
  /** Recommended entry price */
  entryPrice: number;

  /** Calculated stop-loss price */
  stopLoss: number;

  /** Take-profit targets (multiple levels for scaling out) */
  takeProfits: TakeProfitLevel[];

  /** Risk-to-reward ratio */
  riskRewardRatio: number;

  /** Strategy-specific notes for the plan */
  notes: string;
}

/**
 * Take-profit level with percentage to sell
 */
export interface TakeProfitLevel {
  price: number;
  percentToSell: number;
}

// ============================================================================
// Strategy Context
// ============================================================================

/**
 * Context passed to strategy methods for data access.
 * Strategies should not store state - all data comes from context.
 */
export interface StrategyContext {
  /** Exchange client for fetching market data */
  exchange: Exchange;

  /** Pre-fetched candles (optional, for performance) */
  candles?: Candle[];

  /** Current price (optional, will be fetched if not provided) */
  currentPrice?: number;
}

// ============================================================================
// Strategy Interface
// ============================================================================

/**
 * Full strategy interface combining definition with methods.
 * All strategies must implement this interface.
 */
export interface Strategy extends StrategyDefinition {
  /**
   * Detect if this strategy's conditions are met for a symbol.
   *
   * @param symbol - Trading pair (e.g., "BTCUSDT")
   * @param timeframe - Timeframe to analyze (e.g., "4h")
   * @param ctx - Context with exchange client and optional pre-fetched data
   * @returns Detection result with confidence and signals
   */
  detect(
    symbol: string,
    timeframe: string,
    ctx: StrategyContext
  ): Promise<StrategyDetectionResult>;

  /**
   * Calculate plan parameters based on strategy rules.
   *
   * @param symbol - Trading pair (e.g., "BTCUSDT")
   * @param ctx - Context with exchange client and optional pre-fetched data
   * @returns Plan parameters with entry, stop, and targets
   */
  getPlanParameters(
    symbol: string,
    ctx: StrategyContext
  ): Promise<StrategyPlanParams>;

  /**
   * Get strategy-specific prompt fragment for the Planner agent.
   * This is injected into the planner's instructions when this strategy is used.
   *
   * @returns Markdown-formatted instructions for the planner
   */
  getPromptFragment(): string;

  /**
   * Generate a trading signal for backtesting.
   * This method is called for each bar with pre-calculated indicators.
   *
   * @param bar - Current OHLC bar
   * @param index - Index of the bar in the data array
   * @param data - Full OHLC data array
   * @param indicators - Pre-calculated indicator values for this bar
   * @returns Signal if conditions are met, null otherwise
   */
  generateSignal(
    bar: OHLC,
    index: number,
    data: OHLC[],
    indicators: IndicatorState
  ): Signal | null;

  /**
   * Get the list of indicators required by this strategy.
   * Used by the backtester to pre-calculate indicators before running.
   *
   * @returns Array of indicator names (e.g., ['sma20', 'rsi14', 'atr14'])
   */
  getRequiredIndicators(): string[];
}

// ============================================================================
// Strategy IDs (Enum)
// ============================================================================

/**
 * All available strategy IDs.
 * This is the source of truth - plan.ts strategy enum derives from this.
 */
export type StrategyId =
  // Tier 1 - Beginner
  | "support_bounce"
  | "bollinger_bounce"
  | "sma_crossover"
  | "volume_surge"
  | "vwap_bounce"
  // Tier 2 - Intermediate
  | "consolidation_pop"
  | "adx_trend"
  | "ema_rsi_crossover"
  | "relative_strength"
  | "engulfing_pattern"
  // Tier 2 - Advanced ICT
  | "order_blocks"
  | "fair_value_gaps"
  | "smart_money"
  | "ict_killzones"
  // Tier 2 - Advanced Patterns
  | "trend_range"
  | "squeeze_breakout"
  | "mfi_divergence_confluence"
  | "hidden_divergence"
  | "whale_accumulation"
  | "dca_layering"
  | "exhaustion_gap"
  | "liquidation_momentum"
  | "gap_trading"
  | "liquidity_zones"
  | "sellers_exhaustion"
  | "atr_stepping"
  | "stat_arb"
  // Special
  | "grid_entry";

/**
 * Array of all strategy IDs for validation and iteration
 */
export const STRATEGY_IDS: StrategyId[] = [
  "support_bounce",
  "bollinger_bounce",
  "sma_crossover",
  "volume_surge",
  "vwap_bounce",
  "consolidation_pop",
  "adx_trend",
  "ema_rsi_crossover",
  "relative_strength",
  "engulfing_pattern",
  "order_blocks",
  "fair_value_gaps",
  "smart_money",
  "ict_killzones",
  "trend_range",
  "squeeze_breakout",
  "mfi_divergence_confluence",
  "hidden_divergence",
  "whale_accumulation",
  "dca_layering",
  "exhaustion_gap",
  "liquidation_momentum",
  "gap_trading",
  "liquidity_zones",
  "sellers_exhaustion",
  "atr_stepping",
  "stat_arb",
  "grid_entry",
];

/**
 * Strategy tier mapping
 */
export const STRATEGY_TIERS: Record<StrategyId, 1 | 2> = {
  support_bounce: 1,
  bollinger_bounce: 1,
  sma_crossover: 1,
  volume_surge: 1,
  vwap_bounce: 1,
  consolidation_pop: 2,
  adx_trend: 2,
  ema_rsi_crossover: 2,
  relative_strength: 2,
  engulfing_pattern: 2,
  order_blocks: 2,
  fair_value_gaps: 2,
  smart_money: 2,
  ict_killzones: 2,
  trend_range: 2,
  squeeze_breakout: 2,
  mfi_divergence_confluence: 2,
  hidden_divergence: 2,
  whale_accumulation: 2,
  dca_layering: 2,
  exhaustion_gap: 2,
  liquidation_momentum: 2,
  gap_trading: 2,
  liquidity_zones: 2,
  sellers_exhaustion: 2,
  atr_stepping: 2,
  stat_arb: 2,
  grid_entry: 1, // Grid is a special strategy, keep in tier 1
};
