/**
 * Strategy Ensemble
 *
 * Combines multiple strategy signals for more robust trading decisions.
 * Uses a voting mechanism where confidence is weighted by strategy agreement.
 *
 * Usage:
 *   import { runEnsemble, runQuickEnsemble } from "./ensemble.ts";
 *
 *   // Run all strategies
 *   const result = await runEnsemble(symbol, timeframe, ctx);
 *
 *   // Quick check with top 3 strategies
 *   const quick = await runQuickEnsemble(symbol, timeframe, ctx);
 */

import { strategyRegistry } from "./registry.ts";
import type { Strategy, StrategyContext, StrategyId } from "./types.ts";

// ============================================================================
// Types
// ============================================================================

/**
 * Result from a single strategy in the ensemble
 */
export interface EnsembleStrategyResult {
  id: string;
  detected: boolean;
  confidence: number;
  reasoning: string;
}

/**
 * Combined result from running multiple strategies
 */
export interface EnsembleResult {
  /** Symbol analyzed */
  symbol: string;

  /** Timeframe used */
  timeframe: string;

  /** Whether ensemble detected a setup (based on agreement threshold) */
  detected: boolean;

  /** Combined confidence (0-1) weighted by agreement */
  confidence: number;

  /** Individual strategy results */
  strategies: EnsembleStrategyResult[];

  /** Human-readable combined reasoning */
  combinedReasoning: string;

  /** Strategy with strongest signal, or null if none detected */
  recommendedStrategy: string | null;

  /** Percentage of strategies that detected a setup */
  agreementPercent: number;

  /** Number of strategies that detected a setup */
  bullishCount: number;

  /** Total strategies run */
  totalCount: number;
}

/**
 * Options for running the ensemble
 */
export interface EnsembleOptions {
  /** Specific strategy IDs to run (omit for all registered strategies) */
  strategies?: string[];

  /** Minimum percentage of strategies that must agree (default: 0.5) */
  minAgreement?: number;

  /** Only run strategies from a specific tier */
  tierFilter?: 1 | 2;

  /** Minimum confidence threshold for individual strategies (default: 0.4) */
  minStrategyConfidence?: number;
}

// ============================================================================
// Default Top Strategies
// ============================================================================

/**
 * Default strategies for quick ensemble checks.
 * These are selected for reliability and complementary signals.
 */
const DEFAULT_QUICK_STRATEGIES: StrategyId[] = [
  "support_bounce",
  "bollinger_bounce",
  "ema_rsi_crossover",
];

// ============================================================================
// Ensemble Functions
// ============================================================================

/**
 * Run multiple strategies and combine their signals.
 *
 * The ensemble works by:
 * 1. Running all specified strategies in parallel
 * 2. Counting how many detected a setup
 * 3. Calculating combined confidence based on agreement
 * 4. Identifying the strongest signal
 *
 * @param symbol - Trading pair (e.g., "BTCUSDT")
 * @param timeframe - Timeframe to analyze (e.g., "4h")
 * @param ctx - Strategy context with Binance client
 * @param options - Ensemble configuration options
 * @returns Combined ensemble result
 */
export async function runEnsemble(
  symbol: string,
  timeframe: string,
  ctx: StrategyContext,
  options?: EnsembleOptions
): Promise<EnsembleResult> {
  const minAgreement = options?.minAgreement ?? 0.5;
  const minStrategyConfidence = options?.minStrategyConfidence ?? 0.4;

  // Determine which strategies to run
  const strategies = getStrategiesToRun(options);

  if (strategies.length === 0) {
    return createEmptyResult(symbol, timeframe, "No strategies available to run");
  }

  // Run all strategies in parallel
  const results = await Promise.all(
    strategies.map((strategy) => runSingleStrategy(strategy, symbol, timeframe, ctx))
  );

  // Filter to only strategies that detected with sufficient confidence
  const detected = results.filter(
    (r) => r.detected && r.confidence >= minStrategyConfidence
  );

  // Calculate ensemble metrics
  const agreementPercent = results.length > 0 ? detected.length / results.length : 0;
  const avgConfidence = calculateAverageConfidence(detected);

  // Find strongest signal
  const sorted = [...detected].sort((a, b) => b.confidence - a.confidence);
  const strongest = sorted[0];

  // Combined confidence is average confidence weighted by agreement
  const combinedConfidence = avgConfidence * agreementPercent;

  return {
    symbol,
    timeframe,
    detected: agreementPercent >= minAgreement,
    confidence: combinedConfidence,
    strategies: results,
    combinedReasoning: generateCombinedReasoning(results, detected),
    recommendedStrategy: strongest?.id ?? null,
    agreementPercent,
    bullishCount: detected.length,
    totalCount: results.length,
  };
}

/**
 * Quick ensemble check with top 3 most reliable strategies.
 *
 * Uses support_bounce, bollinger_bounce, and ema_rsi_crossover
 * with a 66% agreement threshold for faster analysis.
 *
 * @param symbol - Trading pair (e.g., "BTCUSDT")
 * @param timeframe - Timeframe to analyze (e.g., "4h")
 * @param ctx - Strategy context with Binance client
 * @returns Combined ensemble result
 */
export async function runQuickEnsemble(
  symbol: string,
  timeframe: string,
  ctx: StrategyContext
): Promise<EnsembleResult> {
  return runEnsemble(symbol, timeframe, ctx, {
    strategies: DEFAULT_QUICK_STRATEGIES,
    minAgreement: 0.66,
  });
}

/**
 * Scan multiple symbols with ensemble detection.
 *
 * @param symbols - Array of trading pairs to scan
 * @param timeframe - Timeframe to analyze
 * @param ctx - Strategy context with Binance client
 * @param options - Ensemble configuration options
 * @returns Array of ensemble results for detected setups
 */
export async function scanWithEnsemble(
  symbols: string[],
  timeframe: string,
  ctx: StrategyContext,
  options?: EnsembleOptions
): Promise<EnsembleResult[]> {
  const results = await Promise.all(
    symbols.map((symbol) => runEnsemble(symbol, timeframe, ctx, options))
  );

  // Return only detected setups, sorted by confidence
  return results
    .filter((r) => r.detected)
    .sort((a, b) => b.confidence - a.confidence);
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Determine which strategies to run based on options.
 */
function getStrategiesToRun(options?: EnsembleOptions): Strategy[] {
  // Specific strategies requested
  if (options?.strategies && options.strategies.length > 0) {
    return options.strategies
      .map((id) => strategyRegistry.get(id as StrategyId))
      .filter((s): s is Strategy => s !== undefined);
  }

  // Filter by tier
  if (options?.tierFilter) {
    return strategyRegistry.getByTier(options.tierFilter);
  }

  // All registered strategies (excluding grid_entry which is special)
  return strategyRegistry.getAll().filter((s) => s.id !== "grid_entry");
}

/**
 * Run a single strategy and capture errors.
 */
async function runSingleStrategy(
  strategy: Strategy,
  symbol: string,
  timeframe: string,
  ctx: StrategyContext
): Promise<EnsembleStrategyResult> {
  try {
    const result = await strategy.detect(symbol, timeframe, ctx);
    return {
      id: strategy.id,
      detected: result.detected,
      confidence: result.confidence,
      reasoning: result.reasoning,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return {
      id: strategy.id,
      detected: false,
      confidence: 0,
      reasoning: `Error: ${message}`,
    };
  }
}

/**
 * Calculate average confidence from detected strategies.
 */
function calculateAverageConfidence(detected: EnsembleStrategyResult[]): number {
  if (detected.length === 0) return 0;
  const sum = detected.reduce((acc, r) => acc + r.confidence, 0);
  return sum / detected.length;
}

/**
 * Generate human-readable combined reasoning.
 */
function generateCombinedReasoning(
  all: EnsembleStrategyResult[],
  detected: EnsembleStrategyResult[]
): string {
  const notDetected = all.filter((r) => !r.detected || r.confidence < 0.4);

  if (detected.length === 0) {
    return "No strategies detected a valid setup.";
  }

  if (notDetected.length === 0) {
    const names = detected.map((r) => r.id).join(", ");
    return `All ${detected.length} strategies agree: ${names}`;
  }

  const bullishNames = detected.map((r) => r.id).join(", ");
  const bearishNames = notDetected.map((r) => r.id).join(", ");

  return (
    `${detected.length}/${all.length} strategies bullish (${bullishNames}). ` +
    `Not detected: ${bearishNames}`
  );
}

/**
 * Create an empty result when no strategies are available.
 */
function createEmptyResult(
  symbol: string,
  timeframe: string,
  reasoning: string
): EnsembleResult {
  return {
    symbol,
    timeframe,
    detected: false,
    confidence: 0,
    strategies: [],
    combinedReasoning: reasoning,
    recommendedStrategy: null,
    agreementPercent: 0,
    bullishCount: 0,
    totalCount: 0,
  };
}
