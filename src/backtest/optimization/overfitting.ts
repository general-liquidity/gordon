/**
 * Overfitting Detection Module
 *
 * Provides tools to detect and quantify overfitting in strategy optimization.
 * Uses various heuristics including best/median performance ratios,
 * parameter sensitivity analysis, and out-of-sample degradation metrics.
 */

import type { BacktestMetrics, ParameterSet } from "../types.ts";
import { createModuleLogger } from "../../infra/logger/index.ts";
import {
  mean as statsMean,
  median as statsMedian,
  sampleStd as statsSampleStd,
} from "../../core/stats/index.ts";

const logger = createModuleLogger("overfitting-detection");

// ============================================================================
// Type Definitions
// ============================================================================

/**
 * Optimization result entry for overfitting analysis
 */
export interface OptimizationEntry {
  /** Parameters used */
  parameters: ParameterSet;

  /** Resulting metrics */
  metrics: BacktestMetrics;

  /** The optimization metric value */
  score: number;
}

/**
 * Overfitting detection result
 */
export interface OverfittingResult {
  /** Primary overfitting score (best / median ratio) */
  overfitScore: number;

  /** Whether overfitting is likely (score > 2.0) */
  isLikelyOverfit: boolean;

  /** Severity level */
  severity: "none" | "low" | "moderate" | "high" | "severe";

  /** Detailed breakdown of metrics */
  analysis: {
    /** Best performing parameter score */
    bestScore: number;

    /** Median parameter score */
    medianScore: number;

    /** Average parameter score */
    meanScore: number;

    /** Worst performing parameter score */
    worstScore: number;

    /** Standard deviation of scores */
    scoreStdDev: number;

    /** Coefficient of variation */
    coefficientOfVariation: number;

    /** Number of parameter combinations tested */
    combinationsTested: number;

    /** Percentage of combinations that are profitable */
    profitablePercent: number;
  };

  /** Parameter sensitivity analysis */
  parameterSensitivity: Record<string, {
    /** Sensitivity score (0-100) - higher means more sensitive */
    sensitivityScore: number;

    /** Best value for this parameter */
    bestValue: number;

    /** Average performance at each value */
    valuePerformance: Record<number, number>;
  }>;

  /** Warning messages */
  warnings: string[];

  /** Recommendations */
  recommendations: string[];
}

/**
 * Options for overfitting detection
 */
export interface OverfittingDetectionOptions {
  /** The metric to analyze (used for extracting scores if not provided) */
  metric?: keyof BacktestMetrics;

  /** Threshold for best/median ratio to flag as overfit (default: 2.0) */
  overfitThreshold?: number;

  /** Whether to perform parameter sensitivity analysis (default: true) */
  analyzeParameterSensitivity?: boolean;
}

// ============================================================================
// Main Detection Function
// ============================================================================

/**
 * Detect overfitting in optimization results.
 *
 * Analyzes the distribution of optimization scores to identify potential
 * overfitting. The primary indicator is the ratio between the best performing
 * parameter set and the median performance.
 *
 * A ratio > 2.0 typically indicates that the best parameters are outliers
 * and may not generalize well to unseen data.
 *
 * @param results - Array of optimization results to analyze
 * @param options - Detection options
 * @returns Overfitting analysis result
 *
 * @example
 * ```typescript
 * const overfitResult = detectOverfitting(optimizationResults, {
 *   metric: 'sharpeRatio',
 *   overfitThreshold: 2.0,
 * });
 *
 * if (overfitResult.isLikelyOverfit) {
 *   console.warn('Strategy may be overfit!');
 * }
 * ```
 */
export function detectOverfitting(
  results: OptimizationEntry[],
  options: OverfittingDetectionOptions = {}
): OverfittingResult {
  const {
    metric = "sharpeRatio",
    overfitThreshold = 2.0,
    analyzeParameterSensitivity = true,
  } = options;

  logger.debug("Detecting overfitting", {
    resultCount: String(results.length),
    metric,
    threshold: String(overfitThreshold),
  });

  if (results.length === 0) {
    return createEmptyResult();
  }

  // Extract scores
  const scores = results.map((r) => r.score);

  // Sort scores for percentile calculations
  const sortedScores = [...scores].sort((a, b) => a - b);

  // Calculate statistics
  const bestScore = Math.max(...scores);
  const worstScore = Math.min(...scores);
  const medianScore = calculateMedian(sortedScores);
  const meanScore = calculateMean(scores);
  const scoreStdDev = calculateStdDev(scores);

  // Calculate coefficient of variation
  const coefficientOfVariation = meanScore !== 0
    ? Math.abs(scoreStdDev / meanScore)
    : 0;

  // Calculate overfitting score (best / median ratio)
  const overfitScore = medianScore !== 0 && medianScore > 0
    ? bestScore / medianScore
    : bestScore > 0 ? Infinity : 1;

  // Determine if overfitting is likely
  const isLikelyOverfit = overfitScore > overfitThreshold;

  // Determine severity
  const severity = determineSeverity(overfitScore);

  // Calculate profitable percentage
  const profitableCount = results.filter((r) => {
    const returnVal = r.metrics.totalReturn ?? 0;
    return returnVal > 0;
  }).length;
  const profitablePercent = (profitableCount / results.length) * 100;

  // Analyze parameter sensitivity if enabled
  const parameterSensitivity = analyzeParameterSensitivity
    ? analyzeParameters(results)
    : {};

  // Generate warnings and recommendations
  const { warnings, recommendations } = generateInsights(
    overfitScore,
    severity,
    coefficientOfVariation,
    profitablePercent,
    parameterSensitivity
  );

  const result: OverfittingResult = {
    overfitScore: Number.isFinite(overfitScore) ? overfitScore : 10,
    isLikelyOverfit,
    severity,
    analysis: {
      bestScore,
      medianScore,
      meanScore,
      worstScore,
      scoreStdDev,
      coefficientOfVariation,
      combinationsTested: results.length,
      profitablePercent,
    },
    parameterSensitivity,
    warnings,
    recommendations,
  };

  logger.info("Overfitting detection complete", {
    overfitScore: String(result.overfitScore.toFixed(2)),
    severity,
    isLikelyOverfit: String(isLikelyOverfit),
  });

  return result;
}

// ============================================================================
// Helper Functions
// ============================================================================

const calculateMedian = statsMedian;
const calculateMean = statsMean;
const calculateStdDev = statsSampleStd;

/**
 * Determine severity level from overfit score.
 */
function determineSeverity(
  overfitScore: number
): OverfittingResult["severity"] {
  if (!Number.isFinite(overfitScore) || overfitScore > 5) {
    return "severe";
  }
  if (overfitScore > 3) {
    return "high";
  }
  if (overfitScore > 2) {
    return "moderate";
  }
  if (overfitScore > 1.5) {
    return "low";
  }
  return "none";
}

/**
 * Analyze parameter sensitivity.
 */
function analyzeParameters(
  results: OptimizationEntry[]
): OverfittingResult["parameterSensitivity"] {
  if (results.length === 0) return {};

  // Get all parameter names from first result
  const firstParams = results[0]?.parameters ?? {};
  const paramNames = Object.keys(firstParams);

  if (paramNames.length === 0) return {};

  const sensitivity: OverfittingResult["parameterSensitivity"] = {};

  for (const paramName of paramNames) {
    // Group results by parameter value
    const valueGroups = new Map<number, number[]>();

    for (const result of results) {
      const value = result.parameters[paramName];
      if (typeof value === "number") {
        const existing = valueGroups.get(value) ?? [];
        existing.push(result.score);
        valueGroups.set(value, existing);
      }
    }

    // Calculate average performance for each value
    const valuePerformance: Record<number, number> = {};
    let bestValue = 0;
    let bestAvg = -Infinity;

    for (const [value, scores] of valueGroups) {
      const avg = calculateMean(scores);
      valuePerformance[value] = avg;

      if (avg > bestAvg) {
        bestAvg = avg;
        bestValue = value;
      }
    }

    // Calculate sensitivity score
    // High sensitivity = big variance in performance across parameter values
    const avgPerformances = Object.values(valuePerformance);
    const performanceStdDev = calculateStdDev(avgPerformances);
    const performanceMean = calculateMean(avgPerformances);

    let sensitivityScore = 0;
    if (performanceMean !== 0) {
      // Coefficient of variation as sensitivity indicator
      const cv = Math.abs(performanceStdDev / performanceMean);
      sensitivityScore = Math.min(100, cv * 100);
    }

    sensitivity[paramName] = {
      sensitivityScore,
      bestValue,
      valuePerformance,
    };
  }

  return sensitivity;
}

/**
 * Generate warnings and recommendations based on analysis.
 */
function generateInsights(
  overfitScore: number,
  severity: OverfittingResult["severity"],
  coefficientOfVariation: number,
  profitablePercent: number,
  parameterSensitivity: OverfittingResult["parameterSensitivity"]
): { warnings: string[]; recommendations: string[] } {
  const warnings: string[] = [];
  const recommendations: string[] = [];

  // Overfitting warnings
  if (severity === "severe") {
    warnings.push(
      `Severe overfitting detected (score: ${overfitScore.toFixed(2)}). ` +
      "Best parameters are extreme outliers."
    );
    recommendations.push("Use walk-forward testing to validate strategy robustness.");
    recommendations.push("Consider reducing the number of optimized parameters.");
    recommendations.push("Use out-of-sample data to verify performance.");
  } else if (severity === "high") {
    warnings.push(
      `High overfitting risk (score: ${overfitScore.toFixed(2)}). ` +
      "Best parameters significantly outperform median."
    );
    recommendations.push("Verify results with walk-forward analysis.");
    recommendations.push("Consider using Monte Carlo simulation to assess stability.");
  } else if (severity === "moderate") {
    warnings.push(
      `Moderate overfitting risk (score: ${overfitScore.toFixed(2)}). ` +
      "Exercise caution with these parameters."
    );
    recommendations.push("Consider validating on additional out-of-sample data.");
  }

  // Coefficient of variation warnings
  if (coefficientOfVariation > 1) {
    warnings.push(
      "High variance in optimization results. Strategy performance is unstable."
    );
    recommendations.push("Look for more robust parameter combinations.");
  }

  // Profitable percentage warnings
  if (profitablePercent < 30) {
    warnings.push(
      `Only ${profitablePercent.toFixed(0)}% of parameter combinations are profitable.`
    );
    recommendations.push("Strategy may not be viable. Consider alternative approaches.");
  } else if (profitablePercent < 50) {
    warnings.push(
      `${profitablePercent.toFixed(0)}% of combinations are profitable (below 50%).`
    );
  }

  // Parameter sensitivity warnings
  const highSensitivityParams = Object.entries(parameterSensitivity)
    .filter(([_, info]) => info.sensitivityScore > 50)
    .map(([name]) => name);

  if (highSensitivityParams.length > 0) {
    warnings.push(
      `High sensitivity parameters: ${highSensitivityParams.join(", ")}. ` +
      "Small changes significantly affect performance."
    );
    recommendations.push(
      "Use wider parameter ranges or consider fixing high-sensitivity parameters."
    );
  }

  // Add general recommendation if no specific ones
  if (recommendations.length === 0 && severity !== "none") {
    recommendations.push("Consider using a portion of data as hold-out validation set.");
  }

  return { warnings, recommendations };
}

/**
 * Create empty result for edge cases.
 */
function createEmptyResult(): OverfittingResult {
  return {
    overfitScore: 1,
    isLikelyOverfit: false,
    severity: "none",
    analysis: {
      bestScore: 0,
      medianScore: 0,
      meanScore: 0,
      worstScore: 0,
      scoreStdDev: 0,
      coefficientOfVariation: 0,
      combinationsTested: 0,
      profitablePercent: 0,
    },
    parameterSensitivity: {},
    warnings: ["No optimization results to analyze."],
    recommendations: ["Run optimization before checking for overfitting."],
  };
}

// ============================================================================
// Additional Utilities
// ============================================================================

/**
 * Calculate an overfitting-adjusted score.
 *
 * Penalizes optimization scores based on overfitting risk,
 * providing a more realistic estimate of expected performance.
 *
 * @param rawScore - Original optimization score
 * @param overfitScore - Overfitting score from detectOverfitting
 * @returns Adjusted score accounting for overfitting risk
 */
export function adjustForOverfitting(
  rawScore: number,
  overfitScore: number
): number {
  if (overfitScore <= 1) {
    return rawScore;
  }

  // Apply diminishing penalty as overfit score increases
  // At overfitScore = 2, penalty is ~50%
  // At overfitScore = 3, penalty is ~66%
  // At overfitScore = 4, penalty is ~75%
  const penalty = 1 - (1 / overfitScore);
  return rawScore * (1 - penalty * 0.5);
}

/**
 * Calculate the probability that optimization results are due to chance.
 *
 * Uses a simple Monte Carlo approach to estimate p-value.
 *
 * @param results - Optimization results
 * @param iterations - Number of random iterations (default: 1000)
 * @returns Probability (0-1) that best result is due to chance
 */
export function calculateRandomChanceProbability(
  results: OptimizationEntry[],
  iterations: number = 1000
): number {
  if (results.length < 2) return 1;

  const scores = results.map((r) => r.score);
  const bestScore = Math.max(...scores);
  let exceedCount = 0;

  // Simulate random sampling
  for (let i = 0; i < iterations; i++) {
    // Randomly select a score
    const randomIndex = Math.floor(Math.random() * scores.length);
    const randomScore = scores[randomIndex] ?? 0;

    // Check if random pick equals or exceeds best
    if (randomScore >= bestScore) {
      exceedCount++;
    }
  }

  return exceedCount / iterations;
}

/**
 * Suggest optimal number of parameters to avoid overfitting.
 *
 * Based on the rule of thumb that you need ~10-20 data points per parameter.
 *
 * @param dataPoints - Number of data points (trades or bars)
 * @returns Recommended maximum number of parameters
 */
export function suggestMaxParameters(dataPoints: number): number {
  // Conservative estimate: 15 data points per parameter
  return Math.max(1, Math.floor(dataPoints / 15));
}
