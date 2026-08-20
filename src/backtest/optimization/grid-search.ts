/**
 * Grid Search Optimizer
 *
 * Exhaustive parameter optimization using grid search.
 * Generates all combinations of parameter values and runs
 * backtests to find the optimal configuration.
 */

import type { OHLC } from "../types.ts";
import type { Strategy } from "../../strategies/types.ts";
import { selectByBootstrapPercentile } from "../../core/stats/bootstrap-select.ts";

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

  /**
   * Per-period returns, when the engine already computes them. Read only by robust selection,
   * which resamples this series instead of re-running a backtest per bootstrap resample.
   */
  periodReturns?: readonly number[];

  /**
   * Per-period equity samples. The full engine result carries an equity curve, so robust
   * selection can derive a return series from it without the caller passing anything extra.
   */
  equityCurve?: ReadonlyArray<{ equity: number }>;
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

// ============================================================================
// Robust (bootstrap-percentile) Selection
// ============================================================================

/**
 * Opt-in percentile-of-bootstrapped-utility selection, run alongside the ordinary search.
 *
 * Picking the parameter with the best observed metric is an argmax over one draw's noise as much
 * as over any real edge. `selectByBootstrapPercentile` re-ranks the same candidates on a
 * percentile of their utility distribution over dependence-preserving resamples of the observed
 * path, and the distance between the two rankings is the diagnostic worth having.
 *
 * Disabled by default: existing optimization results are a regression baseline, so the winner the
 * search returns is left exactly as it was and the percentile view is reported beside it.
 */
export interface RobustSelectionOptions {
  /** Default false. When false the search behaves exactly as it does without this option. */
  enabled: boolean;

  /**
   * Percentile to select on, 0..1. Defaults to the module default of 0.5, the middle of the
   * 0.3-0.7 band measured to generalize best. A lower percentile is NOT more conservative here:
   * it buys protection against a disaster the sample barely evidences.
   */
  alpha?: number;

  resamples?: number;

  seed?: number;

  /** Mean geometric block length for the stationary bootstrap. */
  meanBlockLength?: number;

  /**
   * Extract the per-period return series for one candidate. Defaults to the result's
   * `periodReturns`, else a series derived from its `equityCurve`.
   */
  returns?: (
    result: BacktestResult,
    params: ParameterSet
  ) => readonly number[] | undefined;

  /**
   * Utility of one resampled return series. Defaults to a function of the search metric. Supply
   * this when the metric being searched is not reconstructible from a return series, or when the
   * property worth resampling is path-dependent (ruin barriers, exposure limits), which an
   * order-invariant utility such as Sharpe cannot express.
   */
  utility?: (periodReturns: readonly number[]) => number;
}

/** Per-candidate evidence behind a robust selection. */
export interface RobustCandidateEvidence {
  params: ParameterSet;

  /** Utility on the observed path in its observed order: what argmax ranks on. */
  pointEstimate: number;

  /** Utility at `alpha` of the bootstrap distribution: what robust selection ranks on. */
  percentileUtility: number;

  /** pointEstimate minus percentileUtility. Large means the observed number was probably luck. */
  overfitGap: number;

  /** p95 minus p05 of the candidate's utility distribution. */
  spread: number;

  /** Resamples that produced a finite utility. */
  evaluations: number;
}

/**
 * Both winners and their disagreement. Never collapsed into a single "best": a disagreement
 * between the observed best and the percentile best is the most useful thing this reports.
 */
export interface RobustSelectionReport {
  /** False when no candidate carried a usable per-period series; see `unavailableReason`. */
  available: boolean;

  unavailableReason: string | null;

  alpha: number;

  resamples: number;

  seed: number;

  /** Observations in each candidate's return series. */
  sampleSize: number;

  /** Name of the utility the candidates were resampled on. */
  utilityMetric: string;

  /** Winner by argmax of the point estimate: the same params the search returns as `bestParams`. */
  argmaxWinner: ParameterSet | null;

  /** Winner by the alpha-th percentile of bootstrapped utility. */
  percentileWinner: ParameterSet | null;

  /** True when the two winners differ: the observed best was probably lucky. */
  disagree: boolean;

  argmaxWinnerOverfitGap: number | null;

  percentileWinnerOverfitGap: number | null;

  candidates: RobustCandidateEvidence[];

  warnings: string[];
}

/** One candidate's per-period series, collected during the search. */
export interface RobustSample {
  params: ParameterSet;
  returns: readonly number[] | undefined;
}

/**
 * Derive a per-period return series from a backtest result, or undefined when the result carries
 * no series. Deriving beats re-running: `selectByBootstrapPercentile` evaluates every candidate
 * once per resample, and a backtest per resample would be thousands of full runs.
 */
export function periodReturnsFromResult(
  result: BacktestResult
): readonly number[] | undefined {
  if (result.periodReturns && result.periodReturns.length > 0) {
    return result.periodReturns;
  }

  const curve = result.equityCurve;
  if (!curve || curve.length < 2) return undefined;

  const returns: number[] = [];
  for (let i = 1; i < curve.length; i++) {
    const prev = curve[i - 1]?.equity;
    const current = curve[i]?.equity;
    if (
      prev === undefined ||
      current === undefined ||
      !Number.isFinite(prev) ||
      !Number.isFinite(current) ||
      prev === 0
    ) {
      return undefined;
    }
    returns.push(current / prev - 1);
  }

  return returns;
}

function sharpeOfReturns(returns: readonly number[]): number {
  if (returns.length < 2) return Number.NaN;
  let sum = 0;
  for (const r of returns) sum += r;
  const mean = sum / returns.length;
  let ss = 0;
  for (const r of returns) ss += (r - mean) * (r - mean);
  const stdDev = Math.sqrt(ss / (returns.length - 1));
  return stdDev === 0 ? Number.NaN : mean / stdDev;
}

function compoundedPercentOfReturns(returns: readonly number[]): number {
  let equity = 1;
  for (const r of returns) equity *= 1 + r;
  return (equity - 1) * 100;
}

function calmarOfReturns(returns: readonly number[]): number {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity *= 1 + r;
    if (equity > peak) peak = equity;
    const drawdown = peak === 0 ? 0 : 1 - equity / peak;
    if (drawdown > maxDrawdown) maxDrawdown = drawdown;
  }
  if (maxDrawdown === 0) return Number.NaN;
  return (equity - 1) / maxDrawdown;
}

function resolveUtility(
  metric: string,
  override: ((returns: readonly number[]) => number) | undefined
): {
  fn: (returns: readonly number[]) => number;
  name: string;
  warning: string | null;
} {
  if (override) return { fn: override, name: `${metric} (custom)`, warning: null };

  switch (metric) {
    case "sharpeRatio":
      return { fn: sharpeOfReturns, name: "sharpeRatio", warning: null };
    case "totalReturn":
      return { fn: compoundedPercentOfReturns, name: "totalReturn", warning: null };
    case "calmarRatio":
      return { fn: calmarOfReturns, name: "calmarRatio", warning: null };
    default:
      return {
        fn: sharpeOfReturns,
        name: "sharpeRatio",
        warning: `metric ${metric} cannot be rebuilt from a return series; candidates were resampled on sharpeRatio instead. Pass robustSelection.utility to score the metric you are actually searching on`,
      };
  }
}

/**
 * Rank collected candidates on a percentile of their bootstrapped utility and report that ranking
 * beside the ordinary argmax one.
 */
export function buildRobustSelectionReport(
  samples: readonly RobustSample[],
  metric: string,
  options: RobustSelectionOptions
): RobustSelectionReport {
  const warnings: string[] = [];

  const unavailable = (reason: string): RobustSelectionReport => ({
    available: false,
    unavailableReason: reason,
    alpha: 0,
    resamples: 0,
    seed: 0,
    sampleSize: 0,
    utilityMetric: metric,
    argmaxWinner: null,
    percentileWinner: null,
    disagree: false,
    argmaxWinnerOverfitGap: null,
    percentileWinnerOverfitGap: null,
    candidates: [],
    warnings,
  });

  const withSeries = samples.filter(
    (s): s is { params: ParameterSet; returns: readonly number[] } =>
      s.returns !== undefined && s.returns.length >= 2
  );

  if (withSeries.length === 0) {
    return unavailable(
      "no candidate backtest carried a per-period return series (periodReturns or equityCurve), and robust selection resamples that series rather than re-running backtests"
    );
  }

  // Indices are drawn once and shared across candidates, so every candidate must be indexable by
  // the same vector. A candidate on a shorter path is dropped rather than padded or truncated.
  const first = withSeries[0];
  if (first === undefined) return unavailable("no usable candidate series");
  const sampleSize = first.returns.length;

  const usable = withSeries.filter((s) => s.returns.length === sampleSize);
  if (usable.length < withSeries.length) {
    warnings.push(
      `${withSeries.length - usable.length} candidate(s) had a return series of a different length than ${sampleSize} and were excluded from robust selection`
    );
  }
  if (samples.length > withSeries.length) {
    warnings.push(
      `${samples.length - withSeries.length} candidate(s) produced no usable per-period return series and were excluded from robust selection`
    );
  }

  const utility = resolveUtility(metric, options.utility);
  if (utility.warning) warnings.push(utility.warning);

  const selection = selectByBootstrapPercentile<{
    params: ParameterSet;
    returns: readonly number[];
  }>({
    candidates: usable,
    sampleSize,
    alpha: options.alpha,
    resamples: options.resamples,
    seed: options.seed,
    meanBlockLength: options.meanBlockLength,
    label: (candidate) => JSON.stringify(candidate.params),
    evaluate: (candidate, indices) => {
      const resampled = new Array<number>(indices.length);
      for (let i = 0; i < indices.length; i++) {
        resampled[i] = candidate.returns[indices[i] ?? 0] ?? 0;
      }
      return utility.fn(resampled);
    },
  });

  warnings.push(...selection.warnings);

  const candidates: RobustCandidateEvidence[] = selection.evidence.map((e) => ({
    params: e.candidate.params,
    pointEstimate: e.pointEstimate,
    percentileUtility: e.percentileUtility,
    overfitGap: e.overfitGap,
    spread: e.spread,
    evaluations: e.evaluations,
  }));

  const argmaxEvidence = candidates[selection.pointEstimateWinnerIndex];
  const percentileEvidence = candidates[selection.selectedIndex];

  return {
    available: true,
    unavailableReason: null,
    alpha: selection.alpha,
    resamples: selection.resamples,
    seed: selection.seed,
    sampleSize: selection.sampleSize,
    utilityMetric: utility.name,
    argmaxWinner: argmaxEvidence?.params ?? null,
    percentileWinner: percentileEvidence?.params ?? null,
    disagree: selection.disagreesWithPointEstimate,
    argmaxWinnerOverfitGap: argmaxEvidence?.overfitGap ?? null,
    percentileWinnerOverfitGap: percentileEvidence?.overfitGap ?? null,
    candidates,
    warnings,
  };
}

/** Collect one candidate's per-period series for robust selection. */
export function collectRobustSample(
  result: BacktestResult,
  params: ParameterSet,
  options: RobustSelectionOptions
): RobustSample {
  return {
    params,
    returns: options.returns
      ? options.returns(result, params)
      : periodReturnsFromResult(result),
  };
}

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

  /** Opt-in bootstrap-percentile selection reported beside the argmax winner. Default off. */
  robustSelection?: RobustSelectionOptions;
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

  /**
   * Present only when robust selection was enabled. `bestParams` above stays the argmax winner
   * either way; this reports the percentile winner beside it, plus whether they disagree.
   */
  robustSelection?: RobustSelectionReport;
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
    const { constraint, onProgress, progressInterval = 1, robustSelection } = options;
    const robustSamples: RobustSample[] = [];

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

      if (robustSelection?.enabled) {
        robustSamples.push(collectRobustSample(result, params, robustSelection));
      }

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
      ...(robustSelection?.enabled
        ? {
            robustSelection: buildRobustSelectionReport(
              robustSamples,
              String(metric),
              robustSelection
            ),
          }
        : {}),
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
