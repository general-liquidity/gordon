/**
 * Strategy Library Index
 *
 * Central export point for all strategies and registry.
 * Strategies are automatically registered on import.
 *
 * Usage:
 *   import { strategyRegistry, STRATEGY_IDS } from "./strategies/index.ts";
 *
 *   // List all strategies
 *   const strategies = strategyRegistry.listStrategies();
 *
 *   // Get a specific strategy
 *   const strategy = strategyRegistry.get("support_bounce");
 */

// ============================================================================
// Type Exports
// ============================================================================

export type {
  Strategy,
  StrategyDefinition,
  StrategyId,
  StrategyContext,
  StrategyDetectionResult,
  StrategyPlanParams,
  StrategySignals,
  TakeProfitLevel,
} from "./types.ts";

export { STRATEGY_IDS, STRATEGY_TIERS } from "./types.ts";

// ============================================================================
// Registry Export
// ============================================================================

export { strategyRegistry, StrategyRegistry } from "./registry.ts";
export type { FormattedStrategy, FormattedStrategyList } from "./registry.ts";

// ============================================================================
// Base Class Export
// ============================================================================

export { BaseStrategy } from "./base-strategy.ts";

// ============================================================================
// Ensemble Exports
// ============================================================================

export {
  runEnsemble,
  runQuickEnsemble,
  scanWithEnsemble,
} from "./ensemble.ts";

export type {
  EnsembleResult,
  EnsembleStrategyResult,
  EnsembleOptions,
} from "./ensemble.ts";

// ============================================================================
// Strategy Imports (Auto-registration)
// ============================================================================

// Tier 1 - Beginner Strategies
import { supportBounceStrategy } from "./tier-1/support-bounce.ts";
import { bollingerBounceStrategy } from "./tier-1/bollinger-bounce.ts";
import { smaCrossoverStrategy } from "./tier-1/sma-crossover.ts";
import { volumeSurgeStrategy } from "./tier-1/volume-surge.ts";
import { vwapBounceStrategy } from "./tier-1/vwap-bounce.ts";

// Tier 2 - Intermediate Strategies
import { consolidationPopStrategy } from "./tier-2/consolidation-pop.ts";
import { adxTrendStrategy } from "./tier-2/adx-trend.ts";
import { emaRsiCrossoverStrategy } from "./tier-2/ema-rsi-crossover.ts";
import { relativeStrengthStrategy } from "./tier-2/relative-strength.ts";
import { engulfingPatternStrategy } from "./tier-2/engulfing-pattern.ts";

// ============================================================================
// Strategy Registration
// ============================================================================

import { strategyRegistry } from "./registry.ts";

// Register Tier 1 strategies
strategyRegistry.register(supportBounceStrategy);
strategyRegistry.register(bollingerBounceStrategy);
strategyRegistry.register(smaCrossoverStrategy);
strategyRegistry.register(volumeSurgeStrategy);
strategyRegistry.register(vwapBounceStrategy);

// Register Tier 2 strategies
strategyRegistry.register(consolidationPopStrategy);
strategyRegistry.register(adxTrendStrategy);
strategyRegistry.register(emaRsiCrossoverStrategy);
strategyRegistry.register(relativeStrengthStrategy);
strategyRegistry.register(engulfingPatternStrategy);

// ============================================================================
// Re-export Individual Strategies
// ============================================================================

export { supportBounceStrategy } from "./tier-1/support-bounce.ts";
export { bollingerBounceStrategy } from "./tier-1/bollinger-bounce.ts";
export { smaCrossoverStrategy } from "./tier-1/sma-crossover.ts";
export { volumeSurgeStrategy } from "./tier-1/volume-surge.ts";
export { vwapBounceStrategy } from "./tier-1/vwap-bounce.ts";
export { consolidationPopStrategy } from "./tier-2/consolidation-pop.ts";
export { adxTrendStrategy } from "./tier-2/adx-trend.ts";
export { emaRsiCrossoverStrategy } from "./tier-2/ema-rsi-crossover.ts";
export { relativeStrengthStrategy } from "./tier-2/relative-strength.ts";
export { engulfingPatternStrategy } from "./tier-2/engulfing-pattern.ts";
