/**
 * Monte Carlo Simulation Module
 *
 * Provides Monte Carlo simulation for backtest result validation.
 * Uses trade shuffling to generate confidence intervals and assess
 * strategy robustness under different trade orderings.
 */

import type { Trade, BacktestMetrics, BacktestParams } from "../types.ts";
import { DEFAULT_BACKTEST_PARAMS } from "../types.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import {
  mean as statsMean,
  median as statsMedian,
  sampleStd as statsSampleStd,
  maxDrawdown as statsMaxDrawdown,
  quantileSorted as statsQuantileSorted,
} from "../../core/stats/index.ts";

const logger = createModuleLogger("monte-carlo");

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Configuration for Monte Carlo simulation
 */
export interface MonteCarloConfig {
  /** Number of simulation iterations (default: 1000) */
  iterations: number;

  /** Initial capital for equity calculations */
  initialCapital: number;

  /** Confidence levels to calculate (default: [0.05, 0.25, 0.5, 0.75, 0.95]) */
  confidenceLevels: number[];

  /** Random seed for reproducibility (optional) */
  seed?: number;

  /** Whether to calculate drawdown distribution (default: true) */
  calculateDrawdowns: boolean;

  /** Progress callback */
  onProgress?: (progress: MonteCarloProgress) => void;
}

/**
 * Default Monte Carlo configuration
 */
export const DEFAULT_MONTE_CARLO_CONFIG: MonteCarloConfig = {
  iterations: 1000,
  initialCapital: 10000,
  confidenceLevels: [0.05, 0.25, 0.5, 0.75, 0.95],
  calculateDrawdowns: true,
};

/**
 * Progress information for Monte Carlo simulation
 */
export interface MonteCarloProgress {
  /** Current iteration number */
  currentIteration: number;

  /** Total iterations */
  totalIterations: number;

  /** Progress percentage (0-100) */
  progressPercent: number;

  /** Estimated remaining time in milliseconds */
  estimatedRemainingMs?: number;
}

/**
 * A single Monte Carlo simulation result
 */
export interface SimulationIteration {
  /** Iteration number */
  iteration: number;

  /** Final equity value */
  finalEquity: number;

  /** Total return percentage */
  totalReturn: number;

  /** Maximum drawdown percentage */
  maxDrawdown: number;

  /** Final equity curve length (for verification) */
  equityCurveLength: number;
}

/**
 * Confidence interval for a metric
 */
export interface ConfidenceInterval {
  /** Confidence level (e.g., 0.95 for 95%) */
  level: number;

  /** Lower bound value */
  lower: number;

  /** Upper bound value */
  upper: number;
}

/**
 * Distribution statistics for a metric
 */
export interface MetricDistribution {
  /** Minimum value observed */
  min: number;

  /** Maximum value observed */
  max: number;

  /** Mean value */
  mean: number;

  /** Median value */
  median: number;

  /** Standard deviation */
  stdDev: number;

  /** Confidence intervals at various levels */
  confidenceIntervals: ConfidenceInterval[];

  /** Percentile values */
  percentiles: Record<number, number>;
}

/**
 * Complete Monte Carlo simulation result
 */
export interface MonteCarloResult {
  /** Configuration used */
  config: MonteCarloConfig;

  /** Number of original trades */
  originalTradeCount: number;

  /** Original total return */
  originalReturn: number;

  /** Original max drawdown */
  originalMaxDrawdown: number;

  /** Final equity distribution */
  equityDistribution: MetricDistribution;

  /** Total return distribution */
  returnDistribution: MetricDistribution;

  /** Max drawdown distribution */
  drawdownDistribution: MetricDistribution;

  /** Scenario analysis */
  scenarios: {
    /** Worst case (5th percentile) */
    worstCase: {
      return: number;
      maxDrawdown: number;
      finalEquity: number;
    };

    /** Best case (95th percentile) */
    bestCase: {
      return: number;
      maxDrawdown: number;
      finalEquity: number;
    };

    /** Median case (50th percentile) */
    medianCase: {
      return: number;
      maxDrawdown: number;
      finalEquity: number;
    };

    /** Probability of profit */
    profitProbability: number;

    /** Probability of loss > 10% */
    majorLossProbability: number;

    /** Probability of drawdown > 20% */
    highDrawdownProbability: number;
  };

  /** Risk metrics */
  riskMetrics: {
    /** Value at Risk (5%) */
    valueAtRisk5: number;

    /** Value at Risk (1%) */
    valueAtRisk1: number;

    /** Expected Shortfall (Conditional VaR) */
    expectedShortfall: number;

    /** Risk of Ruin (probability of 50% drawdown) */
    riskOfRuin: number;
  };

  /** Robustness assessment */
  robustness: {
    /** Robustness score (0-100) */
    score: number;

    /** Verdict */
    verdict: "excellent" | "good" | "fair" | "poor" | "unreliable";

    /** Key observations */
    observations: string[];
  };

  /** Individual iteration results (optional, for debugging) */
  iterations?: SimulationIteration[];

  /** Execution time in milliseconds */
  executionTime: number;

  /** Timestamp */
  createdAt: string;
}

// ============================================================================
// Main Simulation Function
// ============================================================================

/**
 * Run Monte Carlo simulation on backtest trades.
 *
 * Monte Carlo simulation shuffles the order of trades to assess how
 * the sequence of wins and losses affects the equity curve. This helps
 * understand the range of possible outcomes and identify strategies
 * that are overly dependent on specific trade sequences.
 *
 * @param trades - Array of trades from a backtest
 * @param config - Simulation configuration
 * @returns Monte Carlo simulation results
 *
 * @example
 * ```typescript
 * const result = await runMonteCarloSimulation(backtestResult.trades, {
 *   iterations: 5000,
 *   initialCapital: 10000,
 * });
 *
 * console.log(`95% confidence: ${result.returnDistribution.confidenceIntervals[0.95]}`);
 * ```
 */
export async function runMonteCarloSimulation(
  trades: Trade[],
  config?: Partial<MonteCarloConfig>
): Promise<MonteCarloResult> {
  const startTime = Date.now();
  const fullConfig: MonteCarloConfig = {
    ...DEFAULT_MONTE_CARLO_CONFIG,
    ...config,
  };

  logger.info("Starting Monte Carlo simulation", {
    trades: String(trades.length),
    iterations: String(fullConfig.iterations),
    initialCapital: String(fullConfig.initialCapital),
  });

  if (trades.length === 0) {
    return createEmptyResult(fullConfig);
  }

  // Calculate original metrics
  const originalEquityCurve = calculateEquityCurve(trades, fullConfig.initialCapital);
  const originalReturn = calculateReturn(originalEquityCurve, fullConfig.initialCapital);
  const originalMaxDrawdown = calculateMaxDrawdown(originalEquityCurve);

  // Initialize PRNG if seed provided
  const random = fullConfig.seed !== undefined
    ? createSeededRandom(fullConfig.seed)
    : Math.random;

  // Run simulations
  const iterations: SimulationIteration[] = [];
  const returns: number[] = [];
  const drawdowns: number[] = [];
  const finalEquities: number[] = [];

  let lastProgressTime = Date.now();
  const progressInterval = 100; // ms

  for (let i = 0; i < fullConfig.iterations; i++) {
    // Shuffle trades
    const shuffledTrades = shuffleArray([...trades], random);

    // Calculate equity curve for shuffled trades
    const equityCurve = calculateEquityCurve(shuffledTrades, fullConfig.initialCapital);
    const finalEquity = equityCurve[equityCurve.length - 1] ?? fullConfig.initialCapital;
    const iterationReturn = calculateReturn(equityCurve, fullConfig.initialCapital);
    const maxDrawdown = fullConfig.calculateDrawdowns
      ? calculateMaxDrawdown(equityCurve)
      : 0;

    iterations.push({
      iteration: i + 1,
      finalEquity,
      totalReturn: iterationReturn,
      maxDrawdown,
      equityCurveLength: equityCurve.length,
    });

    returns.push(iterationReturn);
    drawdowns.push(maxDrawdown);
    finalEquities.push(finalEquity);

    // Report progress
    if (fullConfig.onProgress && Date.now() - lastProgressTime > progressInterval) {
      const elapsed = Date.now() - startTime;
      const avgTimePerIteration = elapsed / (i + 1);
      const remaining = (fullConfig.iterations - i - 1) * avgTimePerIteration;

      fullConfig.onProgress({
        currentIteration: i + 1,
        totalIterations: fullConfig.iterations,
        progressPercent: ((i + 1) / fullConfig.iterations) * 100,
        estimatedRemainingMs: remaining,
      });

      lastProgressTime = Date.now();

      // Yield to event loop periodically
      if (i % 100 === 0) {
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
    }
  }

  // Calculate distributions
  const equityDistribution = calculateDistribution(
    finalEquities,
    fullConfig.confidenceLevels
  );
  const returnDistribution = calculateDistribution(
    returns,
    fullConfig.confidenceLevels
  );
  const drawdownDistribution = calculateDistribution(
    drawdowns,
    fullConfig.confidenceLevels
  );

  // Calculate scenarios
  const scenarios = calculateScenarios(returns, drawdowns, finalEquities);

  // Calculate risk metrics
  const riskMetrics = calculateRiskMetrics(returns, drawdowns, fullConfig.initialCapital);

  // Assess robustness
  const robustness = assessRobustness(
    originalReturn,
    originalMaxDrawdown,
    returnDistribution,
    drawdownDistribution,
    scenarios
  );

  const result: MonteCarloResult = {
    config: fullConfig,
    originalTradeCount: trades.length,
    originalReturn,
    originalMaxDrawdown,
    equityDistribution,
    returnDistribution,
    drawdownDistribution,
    scenarios,
    riskMetrics,
    robustness,
    executionTime: Date.now() - startTime,
    createdAt: new Date().toISOString(),
  };

  logger.info("Monte Carlo simulation completed", {
    trades: String(trades.length),
    iterations: String(fullConfig.iterations),
    robustnessScore: String(robustness.score),
    verdict: robustness.verdict,
    executionTime: String(result.executionTime),
  });

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Shuffle an array using Fisher-Yates algorithm.
 */
function shuffleArray<T>(array: T[], random: () => number): T[] {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [array[i], array[j]] = [array[j]!, array[i]!];
  }
  return array;
}

/**
 * Create a seeded random number generator.
 */
function createSeededRandom(seed: number): () => number {
  let state = seed;
  return () => {
    // Simple LCG (Linear Congruential Generator)
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

/**
 * Calculate equity curve from trades.
 */
function calculateEquityCurve(trades: Trade[], initialCapital: number): number[] {
  const curve: number[] = [initialCapital];
  let equity = initialCapital;

  for (const trade of trades) {
    equity += trade.netPnL;
    curve.push(equity);
  }

  return curve;
}

/**
 * Calculate total return percentage.
 */
function calculateReturn(equityCurve: number[], initialCapital: number): number {
  if (equityCurve.length === 0) return 0;
  const finalEquity = equityCurve[equityCurve.length - 1] ?? initialCapital;
  return ((finalEquity - initialCapital) / initialCapital) * 100;
}

/**
 * Calculate maximum drawdown percentage.
 */
function calculateMaxDrawdown(equityCurve: number[]): number {
  return statsMaxDrawdown(equityCurve);
}

/**
 * Calculate distribution statistics.
 */
function calculateDistribution(
  values: number[],
  confidenceLevels: number[]
): MetricDistribution {
  if (values.length === 0) {
    return createEmptyDistribution(confidenceLevels);
  }

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const min = sorted[0] ?? 0;
  const max = sorted[n - 1] ?? 0;
  const mean = statsMean(values);
  const median = statsMedian(values);
  const stdDev = statsSampleStd(values);

  // Calculate percentiles (type-7 interpolated — see core/stats quantile; this
  // replaces the prior floor-index definition that diverged from metrics.ts).
  const percentiles: Record<number, number> = {};
  const percentilePoints = [1, 5, 10, 25, 50, 75, 90, 95, 99];

  for (const p of percentilePoints) {
    percentiles[p] = statsQuantileSorted(sorted, p / 100);
  }

  // Calculate confidence intervals
  const confidenceIntervals: ConfidenceInterval[] = confidenceLevels.map((level) => {
    const lowerP = (1 - level) / 2;
    const upperP = 1 - lowerP;

    return {
      level,
      lower: statsQuantileSorted(sorted, lowerP),
      upper: statsQuantileSorted(sorted, upperP),
    };
  });

  return {
    min,
    max,
    mean,
    median,
    stdDev,
    confidenceIntervals,
    percentiles,
  };
}

/**
 * Calculate scenario analysis.
 */
function calculateScenarios(
  returns: number[],
  drawdowns: number[],
  finalEquities: number[]
): MonteCarloResult["scenarios"] {
  const n = returns.length;
  if (n === 0) {
    return {
      worstCase: { return: 0, maxDrawdown: 0, finalEquity: 0 },
      bestCase: { return: 0, maxDrawdown: 0, finalEquity: 0 },
      medianCase: { return: 0, maxDrawdown: 0, finalEquity: 0 },
      profitProbability: 0,
      majorLossProbability: 0,
      highDrawdownProbability: 0,
    };
  }

  const sortedReturns = [...returns].sort((a, b) => a - b);
  const sortedDrawdowns = [...drawdowns].sort((a, b) => a - b);
  const sortedEquities = [...finalEquities].sort((a, b) => a - b);

  const p5Index = Math.floor(0.05 * n);
  const p50Index = Math.floor(0.5 * n);
  const p95Index = Math.floor(0.95 * n);

  return {
    worstCase: {
      return: sortedReturns[p5Index] ?? 0,
      maxDrawdown: sortedDrawdowns[p95Index] ?? 0, // 95th percentile for drawdown (higher is worse)
      finalEquity: sortedEquities[p5Index] ?? 0,
    },
    bestCase: {
      return: sortedReturns[p95Index] ?? 0,
      maxDrawdown: sortedDrawdowns[p5Index] ?? 0, // 5th percentile for drawdown
      finalEquity: sortedEquities[p95Index] ?? 0,
    },
    medianCase: {
      return: sortedReturns[p50Index] ?? 0,
      maxDrawdown: sortedDrawdowns[p50Index] ?? 0,
      finalEquity: sortedEquities[p50Index] ?? 0,
    },
    profitProbability: returns.filter((r) => r > 0).length / n,
    majorLossProbability: returns.filter((r) => r < -10).length / n,
    highDrawdownProbability: drawdowns.filter((d) => d > 20).length / n,
  };
}

/**
 * Calculate risk metrics.
 */
function calculateRiskMetrics(
  returns: number[],
  drawdowns: number[],
  initialCapital: number
): MonteCarloResult["riskMetrics"] {
  const n = returns.length;
  if (n === 0) {
    return {
      valueAtRisk5: 0,
      valueAtRisk1: 0,
      expectedShortfall: 0,
      riskOfRuin: 0,
    };
  }

  const sortedReturns = [...returns].sort((a, b) => a - b);

  // Value at Risk (5% and 1%)
  const var5Index = Math.floor(0.05 * n);
  const var1Index = Math.floor(0.01 * n);

  const valueAtRisk5 = Math.abs(sortedReturns[var5Index] ?? 0);
  const valueAtRisk1 = Math.abs(sortedReturns[var1Index] ?? 0);

  // Expected Shortfall (average of returns below VaR5)
  const tailReturns = sortedReturns.slice(0, var5Index + 1);
  const expectedShortfall = tailReturns.length > 0
    ? Math.abs(tailReturns.reduce((sum, r) => sum + r, 0) / tailReturns.length)
    : 0;

  // Risk of Ruin (probability of 50% drawdown)
  const riskOfRuin = drawdowns.filter((d) => d >= 50).length / n;

  return {
    valueAtRisk5,
    valueAtRisk1,
    expectedShortfall,
    riskOfRuin,
  };
}

/**
 * Assess robustness based on simulation results.
 */
function assessRobustness(
  originalReturn: number,
  originalMaxDrawdown: number,
  returnDist: MetricDistribution,
  drawdownDist: MetricDistribution,
  scenarios: MonteCarloResult["scenarios"]
): MonteCarloResult["robustness"] {
  const observations: string[] = [];
  let score = 100;

  // Check if original return is within confidence interval
  const ci95 = returnDist.confidenceIntervals.find((ci) => ci.level === 0.95);
  if (ci95) {
    if (originalReturn < ci95.lower || originalReturn > ci95.upper) {
      score -= 20;
      observations.push(
        "Original return is outside 95% confidence interval - sequence-dependent"
      );
    }
  }

  // Check profit probability
  if (scenarios.profitProbability < 0.5) {
    score -= 30;
    observations.push(
      `Low profit probability (${(scenarios.profitProbability * 100).toFixed(0)}%)`
    );
  } else if (scenarios.profitProbability < 0.7) {
    score -= 15;
    observations.push(
      `Moderate profit probability (${(scenarios.profitProbability * 100).toFixed(0)}%)`
    );
  } else if (scenarios.profitProbability > 0.9) {
    observations.push(
      `High profit probability (${(scenarios.profitProbability * 100).toFixed(0)}%)`
    );
  }

  // Check high drawdown probability
  if (scenarios.highDrawdownProbability > 0.3) {
    score -= 25;
    observations.push(
      `High drawdown probability (${(scenarios.highDrawdownProbability * 100).toFixed(0)}% chance of >20% drawdown)`
    );
  } else if (scenarios.highDrawdownProbability > 0.1) {
    score -= 10;
    observations.push(
      `Moderate drawdown risk (${(scenarios.highDrawdownProbability * 100).toFixed(0)}% chance of >20% drawdown)`
    );
  }

  // Check return variability
  const returnCV = returnDist.mean !== 0
    ? Math.abs(returnDist.stdDev / returnDist.mean)
    : Infinity;

  if (returnCV > 1) {
    score -= 15;
    observations.push("High return variability (unstable performance)");
  } else if (returnCV < 0.3) {
    observations.push("Low return variability (consistent performance)");
  }

  // Check worst case scenario
  if (scenarios.worstCase.return < -30) {
    score -= 20;
    observations.push(
      `Severe worst case scenario (${scenarios.worstCase.return.toFixed(1)}% return)`
    );
  } else if (scenarios.worstCase.return < -15) {
    score -= 10;
    observations.push(
      `Significant worst case scenario (${scenarios.worstCase.return.toFixed(1)}% return)`
    );
  }

  // Clamp score
  score = Math.max(0, Math.min(100, score));

  // Determine verdict
  let verdict: MonteCarloResult["robustness"]["verdict"];
  if (score >= 80) {
    verdict = "excellent";
  } else if (score >= 65) {
    verdict = "good";
  } else if (score >= 50) {
    verdict = "fair";
  } else if (score >= 30) {
    verdict = "poor";
  } else {
    verdict = "unreliable";
  }

  return {
    score,
    verdict,
    observations,
  };
}

/**
 * Create empty result for edge cases.
 */
function createEmptyResult(config: MonteCarloConfig): MonteCarloResult {
  const emptyDist = createEmptyDistribution(config.confidenceLevels);

  return {
    config,
    originalTradeCount: 0,
    originalReturn: 0,
    originalMaxDrawdown: 0,
    equityDistribution: emptyDist,
    returnDistribution: emptyDist,
    drawdownDistribution: emptyDist,
    scenarios: {
      worstCase: { return: 0, maxDrawdown: 0, finalEquity: config.initialCapital },
      bestCase: { return: 0, maxDrawdown: 0, finalEquity: config.initialCapital },
      medianCase: { return: 0, maxDrawdown: 0, finalEquity: config.initialCapital },
      profitProbability: 0,
      majorLossProbability: 0,
      highDrawdownProbability: 0,
    },
    riskMetrics: {
      valueAtRisk5: 0,
      valueAtRisk1: 0,
      expectedShortfall: 0,
      riskOfRuin: 0,
    },
    robustness: {
      score: 0,
      verdict: "unreliable",
      observations: ["No trades to simulate"],
    },
    executionTime: 0,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Create empty distribution.
 */
function createEmptyDistribution(confidenceLevels: number[]): MetricDistribution {
  return {
    min: 0,
    max: 0,
    mean: 0,
    median: 0,
    stdDev: 0,
    confidenceIntervals: confidenceLevels.map((level) => ({
      level,
      lower: 0,
      upper: 0,
    })),
    percentiles: {},
  };
}
