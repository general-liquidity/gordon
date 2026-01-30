/**
 * Random Search Optimizer
 *
 * Stochastic parameter optimization using random sampling.
 * Useful for large parameter spaces where exhaustive grid search
 * is computationally prohibitive.
 */

import type { OHLC } from "../types.ts";
import type { Strategy } from "../../strategies/types.ts";
import type {
  BacktestEngine,
  BacktestMetrics,
  BacktestResult,
  ParameterSet,
  ConstraintFn,
  ProgressCallback,
  ProgressInfo,
  OptimizationResult,
} from "./grid-search.ts";

// ============================================================================
// Random Search Type Definitions
// ============================================================================

/**
 * Distribution type for random sampling.
 */
export type DistributionType = "uniform" | "log-uniform" | "normal";

/**
 * Parameter distribution for random sampling.
 */
export interface ParameterDistribution {
  /** Distribution type */
  type: DistributionType;

  /** Minimum value */
  min: number;

  /** Maximum value */
  max: number;

  /** Mean (for normal distribution) */
  mean?: number;

  /** Standard deviation (for normal distribution) */
  stdDev?: number;

  /** Whether to round to integers */
  integer?: boolean;
}

/**
 * Parameter distributions for random search.
 * Each key is a parameter name, value is either a distribution or explicit list.
 */
export interface ParameterDistributions {
  [paramName: string]: ParameterDistribution | number[];
}

/**
 * Options for the RandomSearchOptimizer.
 */
export interface RandomSearchOptions {
  /** Constraint function to filter invalid combinations */
  constraint?: ConstraintFn;

  /** Progress callback for UI updates */
  onProgress?: ProgressCallback;

  /** How often to call progress callback (default: every iteration) */
  progressInterval?: number;

  /** Random seed for reproducibility (optional) */
  seed?: number;

  /** Maximum attempts to find valid params per iteration (default: 100) */
  maxConstraintAttempts?: number;
}

// ============================================================================
// Simple Seeded Random Number Generator
// ============================================================================

/**
 * Simple seeded random number generator using Mulberry32 algorithm.
 */
class SeededRandom {
  private state: number;

  constructor(seed?: number) {
    // Use current time if no seed provided
    this.state = seed ?? Date.now();
  }

  /**
   * Generate next random number between 0 and 1.
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generate random number in range [min, max).
   */
  range(min: number, max: number): number {
    return min + this.next() * (max - min);
  }

  /**
   * Generate random integer in range [min, max].
   */
  integer(min: number, max: number): number {
    return Math.floor(this.range(min, max + 1));
  }

  /**
   * Pick random element from array.
   */
  choice<T>(array: T[]): T {
    const index = this.integer(0, array.length - 1);
    const element = array[index];
    if (element === undefined) {
      throw new Error("Cannot pick from empty array");
    }
    return element;
  }
}

// ============================================================================
// RandomSearchOptimizer Class
// ============================================================================

/**
 * Random Search Optimizer for stochastic parameter optimization.
 *
 * Randomly samples parameter values from specified distributions,
 * runs backtests, and returns the best result found within the
 * iteration budget.
 *
 * Advantages over grid search:
 * - More efficient for high-dimensional parameter spaces
 * - Better exploration of continuous parameter spaces
 * - Anytime algorithm: can stop early and still have a valid result
 *
 * @example
 * ```typescript
 * const optimizer = new RandomSearchOptimizer(engine, strategy, data);
 *
 * const result = optimizer.optimize(
 *   {
 *     shortEMA: { type: 'uniform', min: 5, max: 20, integer: true },
 *     longEMA: { type: 'uniform', min: 20, max: 100, integer: true },
 *     multiplier: { type: 'log-uniform', min: 0.1, max: 10 }
 *   },
 *   100, // iterations
 *   'sharpeRatio',
 *   {
 *     constraint: (p) => p.shortEMA < p.longEMA,
 *     seed: 42
 *   }
 * );
 * ```
 */
export class RandomSearchOptimizer {
  private engine: BacktestEngine;
  private strategy: Strategy;
  private data: OHLC[];
  private rng: SeededRandom;

  /**
   * Create a new RandomSearchOptimizer.
   *
   * @param engine - BacktestEngine to run backtests
   * @param strategy - Strategy to optimize
   * @param data - OHLC price data for backtesting
   */
  constructor(engine: BacktestEngine, strategy: Strategy, data: OHLC[]) {
    this.engine = engine;
    this.strategy = strategy;
    this.data = data;
    this.rng = new SeededRandom();
  }

  /**
   * Run random search optimization.
   *
   * @param paramDistributions - Parameter distributions to sample from
   * @param nIterations - Number of iterations (samples) to run
   * @param metric - Metric to optimize (maximize)
   * @param options - Optional constraint, progress callback, and seed
   * @returns Optimization result with best params and all results
   */
  optimize(
    paramDistributions: ParameterDistributions,
    nIterations: number,
    metric: keyof BacktestMetrics,
    options: RandomSearchOptions = {}
  ): OptimizationResult {
    const startTime = Date.now();
    const {
      constraint,
      onProgress,
      progressInterval = 1,
      seed,
      maxConstraintAttempts = 100,
    } = options;

    // Initialize RNG with seed if provided
    this.rng = new SeededRandom(seed);

    const allResults: Array<{ params: ParameterSet; metrics: BacktestMetrics }> =
      [];
    let bestParams: ParameterSet | null = null;
    let bestMetrics: BacktestMetrics | null = null;
    let bestMetricValue = -Infinity;

    // Track timing for ETA calculation
    const timings: number[] = [];

    for (let i = 0; i < nIterations; i++) {
      const iterationStart = Date.now();

      // Sample parameters, respecting constraints
      let params: ParameterSet | null = null;
      let attempts = 0;

      while (params === null && attempts < maxConstraintAttempts) {
        const candidate = this.sampleParameters(paramDistributions);
        if (!constraint || constraint(candidate)) {
          params = candidate;
        }
        attempts++;
      }

      if (params === null) {
        // Skip this iteration if we can't find valid params
        continue;
      }

      // Run backtest with sampled parameters
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

      // Track iteration timing for ETA
      const iterationTime = Date.now() - iterationStart;
      timings.push(iterationTime);
      if (timings.length > 10) {
        timings.shift(); // Keep only recent timings
      }

      // Call progress callback
      const completedCount = i + 1;
      if (onProgress && completedCount % progressInterval === 0) {
        const avgIterationTime =
          timings.reduce((a, b) => a + b, 0) / timings.length;
        const remainingIterations = nIterations - completedCount;
        const estimatedRemainingMs = avgIterationTime * remainingIterations;

        onProgress({
          totalCombinations: nIterations,
          completed: completedCount,
          progressPercent: (completedCount / nIterations) * 100,
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
      throw new Error(
        "No valid results found during optimization. " +
          "Constraints may be too restrictive."
      );
    }

    return {
      bestParams,
      bestMetrics,
      allResults,
      totalCombinations: allResults.length,
      executionTimeMs,
    };
  }

  /**
   * Sample a parameter set from distributions.
   *
   * @param distributions - Parameter distributions
   * @returns Sampled parameter set
   */
  private sampleParameters(
    distributions: ParameterDistributions
  ): ParameterSet {
    const params: ParameterSet = {};

    for (const [name, dist] of Object.entries(distributions)) {
      if (Array.isArray(dist)) {
        // Explicit list: pick random value
        params[name] = this.rng.choice(dist);
      } else {
        // Distribution: sample according to type
        params[name] = this.sampleFromDistribution(dist);
      }
    }

    return params;
  }

  /**
   * Sample a single value from a distribution.
   *
   * @param dist - Parameter distribution
   * @returns Sampled value
   */
  private sampleFromDistribution(dist: ParameterDistribution): number {
    let value: number;

    switch (dist.type) {
      case "uniform":
        value = this.rng.range(dist.min, dist.max);
        break;

      case "log-uniform":
        // Sample uniformly in log space
        const logMin = Math.log(dist.min);
        const logMax = Math.log(dist.max);
        value = Math.exp(this.rng.range(logMin, logMax));
        break;

      case "normal": {
        // Box-Muller transform for normal distribution
        const mean = dist.mean ?? (dist.min + dist.max) / 2;
        const stdDev = dist.stdDev ?? (dist.max - dist.min) / 6;

        const u1 = this.rng.next();
        const u2 = this.rng.next();
        const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);

        value = mean + stdDev * z;

        // Clamp to min/max
        value = Math.max(dist.min, Math.min(dist.max, value));
        break;
      }

      default:
        // Default to uniform
        value = this.rng.range(dist.min, dist.max);
    }

    // Round to integer if requested
    if (dist.integer) {
      value = Math.round(value);
    }

    return value;
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

// ============================================================================
// Re-export types from grid-search for convenience
// ============================================================================

export type {
  BacktestEngine,
  BacktestMetrics,
  BacktestResult,
  ParameterSet,
  ConstraintFn,
  ProgressCallback,
  ProgressInfo,
  OptimizationResult,
} from "./grid-search.ts";
