/**
 * Grid Search Optimizer
 *
 * Exhaustive parameter optimization using grid search.
 * Generates all combinations of parameter values and runs
 * backtests to find the optimal configuration.
 */

import type { OHLC } from "../types.ts";
import type { Strategy } from "../../strategies/types.ts";

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * BacktestEngine interface for running strategy backtests.
 * The actual implementation should be injected.
 */
export interface BacktestEngine {
  /**
   * Run a backtest with the given strategy and data.
   * @param strategy - Strategy to test
   * @param data - OHLC price data
   * @param params - Optional strategy parameters to override
   * @returns Backtest result with metrics
   */
  run(strategy: Strategy, data: OHLC[], params?: ParameterSet): BacktestResult;
}

/**
 * Key metrics from backtest results.
 */
export interface BacktestMetrics {
  /** Initial portfolio value */
  initialValue: number;

  /** Final portfolio value */
  finalValue: number;

  /** Total return as percentage */
  totalReturn: number;

  /** Sharpe ratio (risk-adjusted return) */
  sharpeRatio: number;

  /** Maximum drawdown as percentage */
  maxDrawdown: number;

  /** Total number of trades executed */
  numTrades: number;

  /** Win rate as percentage */
  winRate: number;

  /** Average trade PnL */
  avgTrade?: number;

  /** Profit factor (gross profit / gross loss) */
  profitFactor?: number;

  /** Maximum consecutive losing trades */
  maxConsecutiveLosses?: number;

  /** Sortino ratio (downside risk-adjusted return) */
  sortinoRatio?: number;

  /** Calmar ratio (return / max drawdown) */
  calmarRatio?: number;

  /** Allow additional custom metrics */
  [key: string]: number | undefined;
}

/**
 * Result from a single backtest run.
 */
export interface BacktestResult {
  /** Strategy name */
  strategyName: string;

  /** Backtest metrics */
  metrics: BacktestMetrics;

  /** Parameters used for this backtest */
  params?: ParameterSet;

  /** Execution time in milliseconds */
  executionTimeMs: number;
}

/**
 * Single parameter range definition.
 */
export interface ParameterRange {
  /** Minimum value */
  min: number;

  /** Maximum value */
  max: number;

  /** Step size between values */
  step: number;
}

/**
 * Parameter ranges for optimization.
 * Each key is a parameter name, value is either a range or explicit list.
 */
export interface ParameterRanges {
  [paramName: string]: ParameterRange | number[];
}

/**
 * A specific set of parameter values.
 */
export interface ParameterSet {
  [paramName: string]: number;
}

/**
 * Constraint function to filter invalid parameter combinations.
 */
export type ConstraintFn = (params: ParameterSet) => boolean;

/**
 * Progress callback for tracking optimization progress.
 */
export interface ProgressInfo {
  /** Total combinations to test */
  totalCombinations: number;

  /** Combinations completed so far */
  completed: number;

  /** Progress percentage (0-100) */
  progressPercent: number;

  /** Estimated remaining time in milliseconds */
  estimatedRemainingMs: number;

  /** Current best result so far */
  currentBest?: {
    params: ParameterSet;
    metrics: BacktestMetrics;
  };
}

export type ProgressCallback = (info: ProgressInfo) => void;

/**
 * Options for the GridSearchOptimizer.
 */
export interface GridSearchOptions {
  /** Constraint function to filter invalid combinations */
  constraint?: ConstraintFn;

  /** Progress callback for UI updates */
  onProgress?: ProgressCallback;

  /** How often to call progress callback (default: every combination) */
  progressInterval?: number;
}

/**
 * Result from optimization.
 */
export interface OptimizationResult {
  /** Best parameters found */
  bestParams: ParameterSet;

  /** Metrics for the best parameters */
  bestMetrics: BacktestMetrics;

  /** All tested combinations with their results */
  allResults: Array<{
    params: ParameterSet;
    metrics: BacktestMetrics;
  }>;

  /** Total combinations tested */
  totalCombinations: number;

  /** Total execution time in milliseconds */
  executionTimeMs: number;
}

// ============================================================================
// GridSearchOptimizer Class
// ============================================================================

/**
 * Grid Search Optimizer for exhaustive parameter search.
 *
 * Generates the cartesian product of all parameter combinations,
 * runs a backtest for each, and returns results sorted by the
 * specified metric.
 *
 * @example
 * ```typescript
 * const optimizer = new GridSearchOptimizer(engine, strategy, data);
 *
 * const result = optimizer.optimize(
 *   {
 *     shortEMA: { min: 5, max: 20, step: 5 },
 *     longEMA: { min: 20, max: 100, step: 10 },
 *     rsiThreshold: [30, 35, 40]
 *   },
 *   'sharpeRatio',
 *   {
 *     constraint: (p) => p.shortEMA < p.longEMA,
 *     onProgress: (info) => console.log(`${info.progressPercent}% complete`)
 *   }
 * );
 * ```
 */
export class GridSearchOptimizer {
  private engine: BacktestEngine;
  private strategy: Strategy;
  private data: OHLC[];

  /**
   * Create a new GridSearchOptimizer.
   *
   * @param engine - BacktestEngine to run backtests
   * @param strategy - Strategy to optimize
   * @param data - OHLC price data for backtesting
   */
  constructor(engine: BacktestEngine, strategy: Strategy, data: OHLC[]) {
    this.engine = engine;
    this.strategy = strategy;
    this.data = data;
  }

  /**
   * Run grid search optimization.
   *
   * @param paramRanges - Parameter ranges to search
   * @param metric - Metric to optimize (maximize)
   * @param options - Optional constraint and progress callback
   * @returns Optimization result with best params and all results
   */
  optimize(
    paramRanges: ParameterRanges,
    metric: keyof BacktestMetrics,
    options: GridSearchOptions = {}
  ): OptimizationResult {
    const startTime = Date.now();
    const { constraint, onProgress, progressInterval = 1 } = options;

    // Generate all parameter combinations
    const allCombinations = this.generateCombinations(paramRanges);

    // Filter by constraint if provided
    const validCombinations = constraint
      ? allCombinations.filter(constraint)
      : allCombinations;

    const totalCombinations = validCombinations.length;

    if (totalCombinations === 0) {
      throw new Error(
        "No valid parameter combinations after applying constraints"
      );
    }

    const allResults: Array<{ params: ParameterSet; metrics: BacktestMetrics }> =
      [];
    let bestParams: ParameterSet | null = null;
    let bestMetrics: BacktestMetrics | null = null;
    let bestMetricValue = -Infinity;

    // Track timing for ETA calculation
    let completedCount = 0;
    const timings: number[] = [];

    for (const params of validCombinations) {
      const iterationStart = Date.now();

      // Run backtest with these parameters
      const result = this.runWithParams(params);
      const metricValue = result.metrics[metric] as number;

      allResults.push({
        params,
        metrics: result.metrics,
      });

      // Track best result
      if (metricValue !== undefined && metricValue > bestMetricValue) {
        bestMetricValue = metricValue;
        bestParams = params;
        bestMetrics = result.metrics;
      }

      completedCount++;

      // Track iteration timing for ETA
      const iterationTime = Date.now() - iterationStart;
      timings.push(iterationTime);
      if (timings.length > 10) {
        timings.shift(); // Keep only recent timings
      }

      // Call progress callback
      if (onProgress && completedCount % progressInterval === 0) {
        const avgIterationTime =
          timings.reduce((a, b) => a + b, 0) / timings.length;
        const remainingIterations = totalCombinations - completedCount;
        const estimatedRemainingMs = avgIterationTime * remainingIterations;

        onProgress({
          totalCombinations,
          completed: completedCount,
          progressPercent: (completedCount / totalCombinations) * 100,
          estimatedRemainingMs,
          currentBest:
            bestParams && bestMetrics
              ? { params: bestParams, metrics: bestMetrics }
              : undefined,
        });
      }
    }

    // Sort results by metric (descending)
    allResults.sort((a, b) => {
      const aVal = a.metrics[metric] as number;
      const bVal = b.metrics[metric] as number;
      return (bVal ?? -Infinity) - (aVal ?? -Infinity);
    });

    const executionTimeMs = Date.now() - startTime;

    // Ensure we have a valid result
    if (!bestParams || !bestMetrics) {
      throw new Error("No valid results found during optimization");
    }

    return {
      bestParams,
      bestMetrics,
      allResults,
      totalCombinations,
      executionTimeMs,
    };
  }

  /**
   * Generate all parameter combinations from ranges.
   * Creates the cartesian product of all parameter values.
   *
   * @param ranges - Parameter ranges
   * @returns Array of all parameter combinations
   */
  private generateCombinations(ranges: ParameterRanges): ParameterSet[] {
    const paramNames = Object.keys(ranges);
    if (paramNames.length === 0) {
      return [{}];
    }

    // Generate value arrays for each parameter
    const paramValues: Map<string, number[]> = new Map();

    for (const [name, range] of Object.entries(ranges)) {
      if (Array.isArray(range)) {
        // Explicit list of values
        paramValues.set(name, range);
      } else {
        // Range with min/max/step
        const values: number[] = [];
        for (let val = range.min; val <= range.max; val += range.step) {
          // Round to avoid floating point precision issues
          values.push(Math.round(val * 1e10) / 1e10);
        }
        paramValues.set(name, values);
      }
    }

    // Generate cartesian product
    return this.cartesianProduct(paramNames, paramValues);
  }

  /**
   * Generate cartesian product of parameter values.
   *
   * @param paramNames - Parameter names in order
   * @param paramValues - Map of parameter name to value array
   * @returns Array of all parameter combinations
   */
  private cartesianProduct(
    paramNames: string[],
    paramValues: Map<string, number[]>
  ): ParameterSet[] {
    if (paramNames.length === 0) {
      return [{}];
    }

    const firstName = paramNames[0];
    const restNames = paramNames.slice(1);

    if (firstName === undefined) {
      return [{}];
    }

    const firstValues = paramValues.get(firstName) ?? [];

    if (restNames.length === 0) {
      // Base case: single parameter
      return firstValues.map((value) => ({ [firstName]: value }));
    }

    // Recursive case: combine with rest
    const restCombinations = this.cartesianProduct(restNames, paramValues);
    const result: ParameterSet[] = [];

    for (const value of firstValues) {
      for (const restCombination of restCombinations) {
        result.push({
          [firstName]: value,
          ...restCombination,
        });
      }
    }

    return result;
  }

  /**
   * Run a single backtest with specified parameters.
   *
   * @param params - Parameter values for the backtest
   * @returns Backtest result
   */
  private runWithParams(params: ParameterSet): BacktestResult {
    return this.engine.run(this.strategy, this.data, params);
  }
}
