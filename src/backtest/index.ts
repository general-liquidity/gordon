/**
 * Backtest Module
 *
 * Exports all backtest-related types, utilities, and formatters.
 *
 * @example
 * ```typescript
 * import {
 *   formatBacktestResult,
 *   formatOptimizationResult,
 *   formatComparisonResult,
 *   calculateAllMetrics,
 *   type BacktestResult,
 *   type OptimizationResult,
 * } from './backtest';
 * ```
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  // Core data types
  OHLC,
  Signal,
  SignalType,
  IndicatorState,
  EquityPoint,
  ClosedTrade,

  // Backtest types
  BacktestMetrics,
  BacktestConfig,
  BacktestTrade,
  BacktestResult,

  // Optimization types
  ParameterRange,
  ParameterSet,
  OptimizationResult,

  // Comparison types
  ComparisonResult,
  StrategyRanking,

  // Engine types
  PositionSizingMode,
  KellyParams,
  BacktestParams,
  Position,
  Trade,
  EquityPointExtended,
  BacktestEngineResult,
  Strategy,
} from "./types.ts";

export { DEFAULT_BACKTEST_CONFIG, DEFAULT_BACKTEST_PARAMS } from "./types.ts";

// ============================================================================
// Metrics Exports
// ============================================================================

export {
  // Return metrics
  calculateTotalReturn,
  calculateAnnualizedReturn,
  calculateCAGR,

  // Risk metrics
  calculateMaxDrawdown,
  calculateVolatility,
  calculateSharpeRatio,
  calculateSortinoRatio,
  calculateCalmarRatio,

  // Trade metrics
  calculateWinRate,
  calculateProfitFactor,
  calculateAverageTrade,
  calculateAverageWin,
  calculateAverageLoss,
  calculateExpectancy,
  calculateMaxConsecutiveWins,
  calculateMaxConsecutiveLosses,

  // Aggregate
  calculateAllMetrics,
  calculateMetricsFromTrades,
} from "./metrics.ts";

// ============================================================================
// Optimization Exports
// ============================================================================

export * from "./optimization/index.ts";

// ============================================================================
// Historical Data Exports
// ============================================================================

export * from "./data/historical.ts";

// ============================================================================
// Analysis & Utilities
// ============================================================================

export * from "./analysis.ts";
export * from "./filters.ts";
export * from "./alpha-decay.ts";
export * from "./plotting.ts";

// ============================================================================
// Reporting Exports
// ============================================================================

export {
  formatBacktestResult,
  formatOptimizationResult,
  formatComparisonResult,
  formatParameters,
  formatBacktestSummary,
} from "./reporting/formatter.ts";

export {
  exportResultsJson,
  exportResultsCsv,
  generateHtmlReport,
} from "./reporting/export.ts";
