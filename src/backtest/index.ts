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
 * } from './';
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
// Overfitting Detection Exports
// ============================================================================

export {
  detectOverfitting,
  adjustForOverfitting,
  calculateRandomChanceProbability,
  suggestMaxParameters,
  type OptimizationEntry,
  type OverfittingResult,
  type OverfittingDetectionOptions,
} from "./optimization/overfitting.ts";

// ============================================================================
// Historical Data Exports
// ============================================================================

export * from "./data/historical.ts";

// ============================================================================
// Analysis & Utilities
// ============================================================================

export * from "./analysis/analysis.ts";
export * from "./prerun/filters.ts";
export * from "./analysis/alpha-decay.ts";
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

// ============================================================================
// Walk-Forward Testing Exports
// ============================================================================

export {
  walkForwardTest,
  DEFAULT_WALK_FORWARD_CONFIG,
  type WalkForwardConfig,
  type WalkForwardProgress,
  type WalkForwardWindow,
  type WalkForwardResult,
} from "./analysis/walk-forward.ts";

// ============================================================================
// Monte Carlo Simulation Exports
// ============================================================================

export {
  runMonteCarloSimulation,
  DEFAULT_MONTE_CARLO_CONFIG,
  type MonteCarloConfig,
  type MonteCarloProgress,
  type SimulationIteration,
  type ConfidenceInterval,
  type MetricDistribution,
  type MonteCarloResult,
} from "./analysis/monte-carlo.ts";

// ============================================================================
// Result Storage Exports
// ============================================================================

export {
  initBacktestResultsTable,
  saveBacktestResult,
  loadBacktestResult,
  loadBacktestResultByKey,
  listBacktestHistory,
  countBacktestHistory,
  deleteBacktestResult,
  deleteBacktestResultsByStrategy,
  cleanupOldBacktestResults,
  getBacktestStorageStats,
  type BacktestKey,
  type BacktestQueryOptions,
  type BacktestSummary,
  type StorageOperationResult,
} from "./persistence/storage.ts";
