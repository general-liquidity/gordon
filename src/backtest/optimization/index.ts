/**
 * Backtest Optimization Module
 *
 * Provides parameter optimization algorithms for strategy backtesting:
 *
 * - GridSearchOptimizer: Exhaustive search through all parameter combinations
 * - RandomSearchOptimizer: Stochastic sampling for large parameter spaces
 *
 * @example
 * ```typescript
 * import {
 *   GridSearchOptimizer,
 *   RandomSearchOptimizer,
 *   type ParameterRanges,
 *   type ParameterDistributions
 * } from './';
 *
 * // Grid search for small parameter spaces
 * const gridOptimizer = new GridSearchOptimizer(engine, strategy, data);
 * const gridResult = gridOptimizer.optimize(
 *   { ema: { min: 10, max: 50, step: 5 } },
 *   'sharpeRatio'
 * );
 *
 * // Random search for large parameter spaces
 * const randomOptimizer = new RandomSearchOptimizer(engine, strategy, data);
 * const randomResult = randomOptimizer.optimize(
 *   { ema: { type: 'uniform', min: 10, max: 50, integer: true } },
 *   100,
 *   'sharpeRatio'
 * );
 * ```
 */

// ============================================================================
// Grid Search Exports
// ============================================================================

export {
  GridSearchOptimizer,
  type BacktestEngine,
  type BacktestMetrics,
  type BacktestResult,
  type ParameterRange,
  type ParameterRanges,
  type ParameterSet,
  type ConstraintFn,
  type ProgressInfo,
  type ProgressCallback,
  type GridSearchOptions,
  type OptimizationResult,
  buildRobustSelectionReport,
  collectRobustSample,
  periodReturnsFromResult,
  type RobustCandidateEvidence,
  type RobustSample,
  type RobustSelectionOptions,
  type RobustSelectionReport,
} from "./grid-search.ts";

// ============================================================================
// Random Search Exports
// ============================================================================

export {
  RandomSearchOptimizer,
  type DistributionType,
  type ParameterDistribution,
  type ParameterDistributions,
  type RandomSearchOptions,
} from "./random-search.ts";

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
} from "./overfitting.ts";
