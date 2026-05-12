/**
 * Strategy Library Index
 *
 * Central export point for all strategies and registry.
 * Strategies are automatically registered on import.
 *
 * Usage:
 *   import { strategyRegistry, STRATEGY_IDS } from "./index.ts";
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

// Tier 2 - Advanced ICT Strategies
import { orderBlocksStrategy } from "./tier-2/order-blocks.ts";
import { fairValueGapsStrategy } from "./tier-2/fair-value-gaps.ts";
import { smartMoneyStrategy } from "./tier-2/smart-money.ts";
import { ictKillzonesStrategy } from "./tier-2/ict-killzones.ts";

// Tier 2 - Advanced Pattern Strategies
import { trendRangeStrategy } from "./tier-2/trend-range.ts";
import { squeezeBreakoutStrategy } from "./tier-2/squeeze-breakout.ts";
import { mfiDivergenceConfluenceStrategy } from "./tier-2/mfi-divergence-confluence.ts";
import { hiddenDivergenceStrategy } from "./tier-2/hidden-divergence.ts";
import { whaleAccumulationStrategy } from "./tier-2/whale-accumulation.ts";
import { dcaLayeringStrategy } from "./tier-2/dca-layering.ts";
import { exhaustionGapStrategy } from "./tier-2/exhaustion-gap.ts";
import { liquidationMomentumStrategy } from "./tier-2/liquidation-momentum.ts";
import { gapTradingStrategy } from "./tier-2/gap-trading.ts";
import { liquidityZonesStrategy } from "./tier-2/liquidity-zones.ts";
import { sellersExhaustionStrategy } from "./tier-2/sellers-exhaustion.ts";
import { atrSteppingStrategy } from "./tier-2/atr-stepping.ts";
import { statArbStrategy } from "./tier-2/stat-arb.ts";

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

// Register Tier 2 ICT strategies
strategyRegistry.register(orderBlocksStrategy);
strategyRegistry.register(fairValueGapsStrategy);
strategyRegistry.register(smartMoneyStrategy);
strategyRegistry.register(ictKillzonesStrategy);

// Register Tier 2 Advanced Pattern strategies
strategyRegistry.register(trendRangeStrategy);
strategyRegistry.register(squeezeBreakoutStrategy);
strategyRegistry.register(mfiDivergenceConfluenceStrategy);
strategyRegistry.register(hiddenDivergenceStrategy);
strategyRegistry.register(whaleAccumulationStrategy);
strategyRegistry.register(dcaLayeringStrategy);
strategyRegistry.register(exhaustionGapStrategy);
strategyRegistry.register(liquidationMomentumStrategy);
strategyRegistry.register(gapTradingStrategy);
strategyRegistry.register(liquidityZonesStrategy);
strategyRegistry.register(sellersExhaustionStrategy);
strategyRegistry.register(atrSteppingStrategy);
strategyRegistry.register(statArbStrategy);

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
export { orderBlocksStrategy } from "./tier-2/order-blocks.ts";
export { fairValueGapsStrategy } from "./tier-2/fair-value-gaps.ts";
export { smartMoneyStrategy } from "./tier-2/smart-money.ts";
export { ictKillzonesStrategy } from "./tier-2/ict-killzones.ts";
export { trendRangeStrategy } from "./tier-2/trend-range.ts";
export { squeezeBreakoutStrategy } from "./tier-2/squeeze-breakout.ts";
export { mfiDivergenceConfluenceStrategy } from "./tier-2/mfi-divergence-confluence.ts";
export { hiddenDivergenceStrategy } from "./tier-2/hidden-divergence.ts";
export { whaleAccumulationStrategy } from "./tier-2/whale-accumulation.ts";
export { dcaLayeringStrategy } from "./tier-2/dca-layering.ts";
export { exhaustionGapStrategy } from "./tier-2/exhaustion-gap.ts";
export { liquidationMomentumStrategy } from "./tier-2/liquidation-momentum.ts";
export { gapTradingStrategy } from "./tier-2/gap-trading.ts";
export { liquidityZonesStrategy } from "./tier-2/liquidity-zones.ts";
export { sellersExhaustionStrategy } from "./tier-2/sellers-exhaustion.ts";
export { atrSteppingStrategy } from "./tier-2/atr-stepping.ts";
export { statArbStrategy } from "./tier-2/stat-arb.ts";

// ============================================================================
// DSL Module Exports
// ============================================================================

export {
  // Schema and validation
  StrategyDSLSchema,
  validateStrategyDSL,
  createStrategyDSL,

  // Condition evaluation
  evaluateCondition,
  evaluateConditionWithResult,
  evaluateSignalRule,

  // Interpreter
  DSLBasedStrategy,
  DSLStrategyInterpreter,
  interpretDSL,
  parseStrategy,

  // Adapter (for Backtest Engine)
  DSLStrategyAdapter,
  createStrategyFromDSL,

  // Storage
  saveStrategy,
  loadStrategy,
  listStrategies as listGeneratedStrategies,
  deleteStrategy,

  // Convenience functions
  createAndSaveStrategy,
  loadAndInterpret,
  loadAllAsStrategies,

  // Example templates
  EXAMPLE_RSI_BOUNCE_DSL,
  EXAMPLE_MACD_CROSSOVER_DSL,
} from "./dsl/index.ts";

export type {
  // DSL Types
  StrategyDSL,
  Condition,
  SignalRule,
  StopLoss,
  TakeProfit,
  IndicatorCondition,
  PriceCondition,
  PatternCondition,
  EvaluationContext,
  EvaluationResult,
} from "./dsl/index.ts";
