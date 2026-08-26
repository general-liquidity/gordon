/**
 * Walk-Forward Testing Module
 *
 * Implements walk-forward analysis for strategy validation.
 * Divides data into train/test periods, optimizes on train data,
 * and validates on out-of-sample test data.
 */

import type { Strategy } from "../../strategies/types.ts";
import type {
  OHLC,
  BacktestMetrics,
  BacktestEngineResult,
  ParameterSet,
  BacktestParams,
} from "../types.ts";
import { DEFAULT_BACKTEST_PARAMS } from "../types.ts";
import { runBacktest } from "../engine.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import {
  mean as statsMean,
  median as statsMedian,
  sampleStd as statsSampleStd,
} from "../../core/stats/index.ts";

const logger = createModuleLogger("walk-forward");

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for walk-forward testing
 */
export interface WalkForwardConfig {
  /** Percentage of data to use for training (0-1), e.g., 0.7 for 70% */
  trainRatio: number;

  /** Number of walk-forward windows to run */
  numWindows: number;

  /** Parameter ranges for optimization during training */
  parameterRanges: Record<string, number[]>;

  /** Metric to optimize during training phase */
  optimizeFor: keyof BacktestMetrics;

  /** Backtest parameters */
  backtestParams?: Partial<BacktestParams>;

  /**
   * Purge bars (López de Prado): label horizon / forward-return lookahead.
   * Drops the last `purgeBars` observations from each TRAIN window — the ones
   * whose forward-return label overlaps the immediately-following test window,
   * preventing label leakage from train into test. Default 0 (no purge).
   */
  purgeBars?: number;

  /**
   * Embargo bars (López de Prado): a gap of bars skipped immediately AFTER
   * each test window before subsequent observations may be reused, blocking
   * serial-correlation leakage from test back into the next train window.
   * Default 0 (no embargo).
   */
  embargoBars?: number;

  /**
   * Train-window geometry.
   *   "rolling"   (default) — fixed-size train window that slides forward with
   *               each fold (unchanged legacy behavior).
   *   "expanding" — anchored walk-forward: trainStart is pinned at 0 and the
   *               train window grows each fold as the test window steps forward,
   *               so every fold trains on all history up to the (purged) test
   *               boundary. Test-window stepping + purge/embargo are unchanged.
   * Default "rolling".
   */
  mode?: "rolling" | "expanding";

  /** Optional callback for progress updates */
  onProgress?: (progress: WalkForwardProgress) => void;
}

/**
 * Default walk-forward configuration
 */
export const DEFAULT_WALK_FORWARD_CONFIG: Omit<WalkForwardConfig, "parameterRanges"> = {
  trainRatio: 0.7,
  numWindows: 3,
  optimizeFor: "sharpeRatio",
  purgeBars: 0,
  embargoBars: 0,
  mode: "rolling",
};

/**
 * Progress information for walk-forward testing
 */
export interface WalkForwardProgress {
  /** Current window number (1-indexed) */
  currentWindow: number;

  /** Total number of windows */
  totalWindows: number;

  /** Current phase */
  phase: "training" | "testing";

  /** Progress percentage (0-100) */
  progressPercent: number;

  /** Estimated remaining time in milliseconds */
  estimatedRemainingMs?: number;
}

/**
 * Result from a single walk-forward window
 */
export interface WalkForwardWindow {
  /** Window number (1-indexed) */
  windowNumber: number;

  /** Training period start timestamp */
  trainStart: number;

  /** Training period end timestamp */
  trainEnd: number;

  /** Test period start timestamp */
  testStart: number;

  /** Test period end timestamp */
  testEnd: number;

  /** Best parameters found during training */
  optimizedParams: ParameterSet;

  /** Training performance metrics */
  trainMetrics: BacktestMetrics;

  /** Out-of-sample test performance metrics */
  testMetrics: BacktestMetrics;

  /** Number of trades during test period */
  testTrades: number;

  /** Overfitting indicator (train/test performance ratio) */
  overfitRatio: number;
}

/**
 * Complete walk-forward test result
 */
export interface WalkForwardResult {
  /** Strategy ID */
  strategyId: string;

  /** Strategy name */
  strategyName: string;

  /** Configuration used */
  config: WalkForwardConfig;

  /** Individual window results */
  windows: WalkForwardWindow[];

  /** Aggregated out-of-sample metrics */
  aggregatedMetrics: {
    /** Average out-of-sample return */
    avgReturn: number;

    /** Median out-of-sample return */
    medianReturn: number;

    /** Out-of-sample Sharpe ratio (weighted average) */
    avgSharpeRatio: number;

    /** Average out-of-sample win rate */
    avgWinRate: number;

    /** Maximum out-of-sample drawdown across all windows */
    maxDrawdown: number;

    /** Total out-of-sample trades */
    totalTrades: number;

    /** Average overfit ratio */
    avgOverfitRatio: number;

    /** Percentage of profitable windows */
    profitableWindowsPercent: number;
  };

  /** Overall stability assessment */
  stability: {
    /** Consistency score (0-100) - how consistent are results across windows */
    consistencyScore: number;

    /** Robustness score (0-100) - how well does optimization generalize */
    robustnessScore: number;

    /** Overall verdict */
    verdict: "excellent" | "good" | "fair" | "poor" | "unreliable";

    /** Warnings and observations */
    warnings: string[];
  };

  /** Data coverage */
  dataCoverage: {
    /** Total data points used */
    totalDataPoints: number;

    /** Start date of entire dataset */
    startDate: string;

    /** End date of entire dataset */
    endDate: string;

    /** Total period in days */
    totalDays: number;
  };

  /** Execution statistics */
  executionTime: number;
  createdAt: string;
}

// ============================================================================
// Walk-Forward Implementation
// ============================================================================

/**
 * Perform walk-forward analysis on a strategy.
 *
 * Walk-forward testing divides data into multiple train/test windows,
 * optimizes strategy parameters on the training portion, and validates
 * on the out-of-sample test portion. This helps detect overfitting
 * and assess strategy robustness.
 *
 * @param strategy - Strategy to test
 * @param data - Full OHLC dataset
 * @param config - Walk-forward configuration
 * @returns Walk-forward test results
 *
 * @example
 * ```typescript
 * const result = await walkForwardTest(myStrategy, ohlcData, {
 *   trainRatio: 0.7,
 *   numWindows: 5,
 *   parameterRanges: {
 *     rsiPeriod: [10, 14, 20],
 *     rsiOversold: [25, 30, 35],
 *   },
 *   optimizeFor: 'sharpeRatio',
 * });
 * ```
 */
export async function walkForwardTest(
  strategy: Strategy,
  data: OHLC[],
  config: WalkForwardConfig
): Promise<WalkForwardResult> {
  const startTime = Date.now();
  const fullConfig = {
    ...DEFAULT_WALK_FORWARD_CONFIG,
    ...config,
  };

  logger.info("Starting walk-forward test", {
    strategy: strategy.id,
    windows: String(fullConfig.numWindows),
    trainRatio: String(fullConfig.trainRatio),
    dataPoints: String(data.length),
  });

  if (data.length < 100) {
    throw new Error("Insufficient data for walk-forward testing. Need at least 100 data points.");
  }

  if (fullConfig.numWindows < 1) {
    throw new Error("Number of windows must be at least 1.");
  }

  if (fullConfig.trainRatio <= 0 || fullConfig.trainRatio >= 1) {
    throw new Error("Train ratio must be between 0 and 1 (exclusive).");
  }

  // Calculate window sizes
  const totalPoints = data.length;
  const windowSize = Math.floor(totalPoints / fullConfig.numWindows);
  const trainSize = Math.floor(windowSize * fullConfig.trainRatio);
  const testSize = windowSize - trainSize;

  if (trainSize < 50 || testSize < 20) {
    throw new Error(
      `Window sizes too small. Train: ${trainSize}, Test: ${testSize}. ` +
      "Increase data or reduce number of windows."
    );
  }

  const purgeBars = Math.max(0, Math.floor(fullConfig.purgeBars ?? 0));
  const embargoBars = Math.max(0, Math.floor(fullConfig.embargoBars ?? 0));

  if (purgeBars >= trainSize) {
    throw new Error(
      `purgeBars (${purgeBars}) must be smaller than the train window size (${trainSize}).`
    );
  }

  const windows: WalkForwardWindow[] = [];
  const warnings: string[] = [];
  const backtestParams = {
    ...DEFAULT_BACKTEST_PARAMS,
    ...fullConfig.backtestParams,
  };

  // Process each walk-forward window. Each window is shifted forward by a
  // cumulative embargo offset so window i begins `embargoBars` after the
  // previous test window ends (López de Prado embargo).
  for (let i = 0; i < fullConfig.numWindows; i++) {
    const windowStart = i * windowSize + i * embargoBars;
    const trainEnd = windowStart + trainSize;
    const testStart = trainEnd;
    const testEnd = Math.min(windowStart + windowSize, totalPoints);
    // Anchored / expanding mode pins the train window at 0 so it grows each
    // fold; rolling mode keeps the fixed-size sliding window. Test-window
    // stepping and purge/embargo are identical in both modes.
    const trainStart = fullConfig.mode === "expanding" ? 0 : windowStart;

    // Purge: drop the last `purgeBars` observations from the train window —
    // their forward-return labels overlap the test window.
    const purgedTrainEnd = trainEnd - purgeBars;

    if (testStart >= totalPoints || testEnd <= testStart) {
      // Embargo offset pushed this window past the available data.
      break;
    }

    // Report progress
    if (fullConfig.onProgress) {
      fullConfig.onProgress({
        currentWindow: i + 1,
        totalWindows: fullConfig.numWindows,
        phase: "training",
        progressPercent: (i / fullConfig.numWindows) * 100,
      });
    }

    logger.debug("Processing window", {
      window: String(i + 1),
      trainStart: String(trainStart),
      trainEnd: String(purgedTrainEnd),
      purgeBars: String(purgeBars),
      embargoBars: String(embargoBars),
      testStart: String(testStart),
      testEnd: String(testEnd),
    });

    // Extract train and test data (train is purged of the last `purgeBars`)
    const trainData = data.slice(trainStart, purgedTrainEnd);
    const testData = data.slice(testStart, testEnd);

    // Optimize on training data
    const { bestParams, trainMetrics } = optimizeOnTrainData(
      strategy,
      trainData,
      fullConfig.parameterRanges,
      fullConfig.optimizeFor,
      backtestParams
    );

    // Report progress
    if (fullConfig.onProgress) {
      fullConfig.onProgress({
        currentWindow: i + 1,
        totalWindows: fullConfig.numWindows,
        phase: "testing",
        progressPercent: ((i + 0.5) / fullConfig.numWindows) * 100,
      });
    }

    // Validate on test data with optimized parameters
    const testResult = runBacktest(strategy, testData, backtestParams, bestParams);
    const testMetrics = testResult.metrics;

    // Calculate overfit ratio
    const trainValue = getMetricValue(trainMetrics, fullConfig.optimizeFor);
    const testValue = getMetricValue(testMetrics, fullConfig.optimizeFor);
    const overfitRatio = computeOverfitRatio(
      trainValue,
      testValue,
      fullConfig.optimizeFor,
    );

    // Check for concerning overfit
    if (overfitRatio > 2) {
      warnings.push(
        `Window ${i + 1}: High overfit ratio (${overfitRatio.toFixed(2)}). ` +
        `Train ${fullConfig.optimizeFor}: ${trainValue.toFixed(2)}, ` +
        `Test: ${testValue.toFixed(2)}`
      );
    }

    windows.push({
      windowNumber: i + 1,
      trainStart: trainData[0]?.timestamp ?? 0,
      trainEnd: trainData[trainData.length - 1]?.timestamp ?? 0,
      testStart: testData[0]?.timestamp ?? 0,
      testEnd: testData[testData.length - 1]?.timestamp ?? 0,
      optimizedParams: bestParams,
      trainMetrics,
      testMetrics,
      testTrades: testResult.trades.length,
      overfitRatio: Number.isFinite(overfitRatio) ? overfitRatio : 10,
    });
  }

  // Calculate aggregated metrics
  const aggregatedMetrics = calculateAggregatedMetrics(windows);

  // Assess stability
  const stability = assessStability(windows, aggregatedMetrics, warnings);

  // Build data coverage info
  const dataCoverage = {
    totalDataPoints: data.length,
    startDate: new Date(data[0]?.timestamp ?? 0).toISOString(),
    endDate: new Date(data[data.length - 1]?.timestamp ?? 0).toISOString(),
    totalDays: Math.round(
      ((data[data.length - 1]?.timestamp ?? 0) - (data[0]?.timestamp ?? 0)) /
      (1000 * 60 * 60 * 24)
    ),
  };

  const result: WalkForwardResult = {
    strategyId: strategy.id,
    strategyName: strategy.name,
    config: fullConfig,
    windows,
    aggregatedMetrics,
    stability,
    dataCoverage,
    executionTime: Date.now() - startTime,
    createdAt: new Date().toISOString(),
  };

  logger.info("Walk-forward test completed", {
    strategy: strategy.id,
    verdict: stability.verdict,
    avgReturn: String(aggregatedMetrics.avgReturn.toFixed(2)),
    executionTime: String(result.executionTime),
  });

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * In-sample over out-of-sample performance, always >= 0, higher = worse.
 *
 * A plain `train / test` on SIGNED scores rewards exactly the case the metric
 * exists to catch: train Sharpe +2.0 against test -1.0 gives -2, which clears
 * every `> 2` threshold and then averages into `avgOverfitRatio` pulling the
 * robustness score UP. Two collapses of a strategy under a losing train and a
 * worse test (-1 over -2) scored 0.5, indistinguishable from a perfect hold.
 *
 * The repair is to treat sign, not just magnitude, as information:
 *   - out-of-sample score gone (<= 0) while in-sample had one: Infinity, the
 *     total-degradation case
 *   - no in-sample score to begin with: 1, an edge failure rather than an
 *     overfit, and not this metric's business
 * `maxDrawdown` is inverted because for it lower is better.
 */
export function computeOverfitRatio(
  trainValue: number,
  testValue: number,
  optimizeFor: keyof BacktestMetrics,
): number {
  if (optimizeFor === "maxDrawdown") {
    if (trainValue <= 0) return testValue > 0 ? Number.POSITIVE_INFINITY : 1;
    return testValue / trainValue;
  }
  if (trainValue <= 0) return 1;
  if (testValue <= 0) return Number.POSITIVE_INFINITY;
  return trainValue / testValue;
}

/**
 * Optimize strategy parameters on training data.
 */
function optimizeOnTrainData(
  strategy: Strategy,
  trainData: OHLC[],
  parameterRanges: Record<string, number[]>,
  optimizeFor: keyof BacktestMetrics,
  backtestParams: BacktestParams
): { bestParams: ParameterSet; trainMetrics: BacktestMetrics } {
  const paramNames = Object.keys(parameterRanges);

  // Generate all parameter combinations
  const combinations: ParameterSet[] = [];

  function generateCombinations(index: number, current: ParameterSet) {
    if (index === paramNames.length) {
      combinations.push({ ...current });
      return;
    }
    const paramName = paramNames[index]!;
    const values = parameterRanges[paramName]!;
    for (const value of values) {
      current[paramName] = value;
      generateCombinations(index + 1, current);
    }
  }

  generateCombinations(0, {});

  // If no parameters to optimize, run with defaults
  if (combinations.length === 0) {
    combinations.push({});
  }

  // Test each combination
  let bestParams: ParameterSet = {};
  let bestMetrics: BacktestMetrics | null = null;
  let bestValue = -Infinity;

  for (const params of combinations) {
    const result = runBacktest(strategy, trainData, backtestParams, params);
    const metricValue = getMetricValue(result.metrics, optimizeFor);

    // For drawdown, lower is better
    const adjustedValue = optimizeFor === "maxDrawdown" ? -metricValue : metricValue;

    if (adjustedValue > bestValue) {
      bestValue = adjustedValue;
      bestParams = params;
      bestMetrics = result.metrics;
    }
  }

  return {
    bestParams,
    trainMetrics: bestMetrics ?? createEmptyMetrics(),
  };
}

/**
 * Get numeric value of a metric.
 */
function getMetricValue(metrics: BacktestMetrics, key: keyof BacktestMetrics): number {
  const value = metrics[key];
  return typeof value === "number" ? value : 0;
}

/**
 * Calculate aggregated metrics across all windows.
 */
function calculateAggregatedMetrics(
  windows: WalkForwardWindow[]
): WalkForwardResult["aggregatedMetrics"] {
  if (windows.length === 0) {
    return {
      avgReturn: 0,
      medianReturn: 0,
      avgSharpeRatio: 0,
      avgWinRate: 0,
      maxDrawdown: 0,
      totalTrades: 0,
      avgOverfitRatio: 0,
      profitableWindowsPercent: 0,
    };
  }

  const returns = windows.map((w) => w.testMetrics.totalReturn);
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const sharpeRatios = windows.map((w) => w.testMetrics.sharpeRatio);
  const winRates = windows.map((w) => w.testMetrics.winRate);
  const drawdowns = windows.map((w) => w.testMetrics.maxDrawdown);
  const overfitRatios = windows.map((w) => w.overfitRatio);
  const trades = windows.map((w) => w.testTrades);
  const profitableCount = returns.filter((r) => r > 0).length;

  return {
    avgReturn: average(returns),
    medianReturn: median(sortedReturns),
    avgSharpeRatio: average(sharpeRatios),
    avgWinRate: average(winRates),
    maxDrawdown: Math.max(...drawdowns),
    totalTrades: trades.reduce((sum, t) => sum + t, 0),
    avgOverfitRatio: average(overfitRatios.filter((r) => Number.isFinite(r))),
    profitableWindowsPercent: (profitableCount / windows.length) * 100,
  };
}

/**
 * Assess the stability and robustness of walk-forward results.
 */
function assessStability(
  windows: WalkForwardWindow[],
  aggregatedMetrics: WalkForwardResult["aggregatedMetrics"],
  existingWarnings: string[]
): WalkForwardResult["stability"] {
  const warnings = [...existingWarnings];

  // Calculate consistency score (how consistent are test returns across windows)
  const returns = windows.map((w) => w.testMetrics.totalReturn);
  const returnStdDev = standardDeviation(returns);
  const returnMean = average(returns);

  // Coefficient of variation (lower is more consistent)
  const cv = returnMean !== 0 ? Math.abs(returnStdDev / returnMean) : Infinity;
  let consistencyScore = Math.max(0, 100 - cv * 50);
  consistencyScore = Math.min(100, consistencyScore);

  // Calculate robustness score (how well does training generalize to testing)
  const avgOverfit = aggregatedMetrics.avgOverfitRatio;
  let robustnessScore = 100;

  if (avgOverfit > 3) {
    robustnessScore = 20;
    warnings.push("Severe overfitting detected: average train/test ratio > 3");
  } else if (avgOverfit > 2) {
    robustnessScore = 50;
    warnings.push("Moderate overfitting detected: average train/test ratio > 2");
  } else if (avgOverfit > 1.5) {
    robustnessScore = 70;
  } else if (avgOverfit < 0.8 && avgOverfit > 0) {
    // Test outperforming train can indicate luck or data snooping
    robustnessScore = 60;
    warnings.push("Test outperforming training - verify data integrity");
  }

  // Adjust for profitability
  const profitablePercent = aggregatedMetrics.profitableWindowsPercent;
  if (profitablePercent < 50) {
    robustnessScore = Math.min(robustnessScore, 40);
    warnings.push(`Only ${profitablePercent.toFixed(0)}% of windows were profitable`);
  }

  // Adjust for trade count
  if (aggregatedMetrics.totalTrades < windows.length * 3) {
    consistencyScore = Math.min(consistencyScore, 50);
    warnings.push("Low trade count may indicate insufficient statistical significance");
  }

  // Determine verdict
  const overallScore = (consistencyScore + robustnessScore) / 2;
  let verdict: WalkForwardResult["stability"]["verdict"];

  if (overallScore >= 80 && profitablePercent >= 80) {
    verdict = "excellent";
  } else if (overallScore >= 65 && profitablePercent >= 60) {
    verdict = "good";
  } else if (overallScore >= 50 && profitablePercent >= 50) {
    verdict = "fair";
  } else if (overallScore >= 35) {
    verdict = "poor";
  } else {
    verdict = "unreliable";
  }

  // Add general warnings
  if (aggregatedMetrics.avgReturn < 0) {
    warnings.push("Strategy has negative average out-of-sample return");
  }

  if (aggregatedMetrics.maxDrawdown > 30) {
    warnings.push(`High maximum drawdown: ${aggregatedMetrics.maxDrawdown.toFixed(1)}%`);
  }

  return {
    consistencyScore,
    robustnessScore,
    verdict,
    warnings,
  };
}

/**
 * Create empty metrics for fallback.
 */
function createEmptyMetrics(): BacktestMetrics {
  return {
    totalReturn: 0,
    annualizedReturn: 0,
    cagr: 0,
    maxDrawdown: 0,
    sharpeRatio: 0,
    sortinoRatio: 0,
    volatility: 0,
    calmarRatio: 0,
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    winRate: 0,
    profitFactor: 0,
    averageTrade: 0,
    averageWin: 0,
    averageLoss: 0,
    expectancy: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    initialValue: 0,
    finalValue: 0,
    totalPnl: 0,
    netProfit: 0,
    totalFees: 0,
    avgTradeDuration: 0,
    maxDrawdownDuration: 0,
  };
}

// ============================================================================
// Statistical Utilities
// ============================================================================

const average = statsMean;
const median = statsMedian;
const standardDeviation = statsSampleStd;
