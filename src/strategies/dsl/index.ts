/**
 * Strategy DSL Module
 *
 * Provides a schema-based Domain Specific Language (DSL) for defining
 * trading strategies that can be AI-generated, validated, and executed.
 *
 * @module strategies/dsl
 *
 * @example
 * ```ts
 * import {
 *   StrategyDSLSchema,
 *   interpretDSL,
 *   saveStrategy,
 *   loadStrategy,
 * } from "./strategies/dsl/index.ts";
 *
 * // Define a strategy using the DSL
 * const myStrategy = {
 *   id: "my_custom_strategy",
 *   name: "My Custom Strategy",
 *   description: "A custom strategy using the DSL",
 *   // ... rest of DSL definition
 * };
 *
 * // Validate and interpret
 * const strategy = interpretDSL(myStrategy);
 *
 * // Save to storage
 * await saveStrategy(myStrategy);
 *
 * // Load from storage
 * const loaded = await loadStrategy("my_custom_strategy");
 * ```
 */

// ============================================================================
// Schema Exports
// ============================================================================

export {
  // Condition schemas
  IndicatorConditionSchema,
  PriceConditionSchema,
  PatternConditionSchema,
  ConditionSchema,

  // Rule schemas
  SignalRuleSchema,

  // Exit rule schemas
  StopLossSchema,
  TakeProfitSchema,
  TrailingStopSchema,

  // Filter and metadata schemas
  FiltersSchema,
  MetadataSchema,

  // Main strategy schema
  StrategyDSLSchema,

  // Validation helpers
  validateStrategyDSL,
  createStrategyDSL,

  // Example templates
  EXAMPLE_RSI_BOUNCE_DSL,
  EXAMPLE_MACD_CROSSOVER_DSL,
} from "./schema.ts";

// Schema types
export type {
  IndicatorCondition,
  PriceCondition,
  PatternCondition,
  Condition,
  SignalRule,
  StopLoss,
  TakeProfit,
  TrailingStop,
  Filters,
  Metadata,
  StrategyDSL,
} from "./schema.ts";

// ============================================================================
// Condition Evaluator Exports
// ============================================================================

export {
  // Main evaluation functions
  evaluateCondition,
  evaluateConditionWithResult,

  // Specific evaluators
  evaluateIndicatorCondition,
  evaluatePriceCondition,
  evaluatePatternCondition,

  // Rule evaluation
  evaluateSignalRule,
} from "./conditions.ts";

export type {
  EvaluationContext,
  EvaluationResult,
} from "./conditions.ts";

// ============================================================================
// Interpreter Exports
// ============================================================================

export {
  // Strategy class
  DSLBasedStrategy,

  // Interpreter class
  DSLStrategyInterpreter,

  // Factory functions
  createInterpreter,
  interpretDSL,
  parseStrategy,
} from "./interpreter.ts";

// ============================================================================
// Adapter Exports (for Backtest Engine)
// ============================================================================

export {
  DSLStrategyAdapter,
  createStrategyFromDSL,
} from "./adapter.ts";

// ============================================================================
// Storage Exports
// ============================================================================

export {
  // Path helpers
  getGordonDir,
  getStrategiesDir,
  getGeneratedStrategiesDir,
  storageExists,

  // CRUD operations
  saveStrategy,
  loadStrategy,
  listStrategies,
  deleteStrategy,
  strategyExists,

  // Bulk operations
  saveStrategies,
  deleteStrategies,
  clearAllStrategies,

  // Search and filter
  listStrategiesFiltered,
  searchStrategies,

  // Import/Export
  exportStrategies,
  importStrategies,

  // Metadata operations
  updateStrategyMetadata,
  addBacktestResults,
  addTags,
  removeTags,

  // Statistics
  getStorageStats,
} from "./storage.ts";

// ============================================================================
// Re-export for Convenience
// ============================================================================

/**
 * Create and save a new DSL strategy
 */
export async function createAndSaveStrategy(
  dsl: import("./schema.ts").StrategyDSL
): Promise<import("./interpreter.ts").DSLBasedStrategy> {
  const { saveStrategy: save } = await import("./storage.ts");
  const { interpretDSL: interpret } = await import("./interpreter.ts");

  // Save to storage
  await save(dsl);

  // Return executable strategy
  return interpret(dsl);
}

/**
 * Load and interpret a strategy from storage
 */
export async function loadAndInterpret(
  id: string
): Promise<import("./interpreter.ts").DSLBasedStrategy | null> {
  const { loadStrategy: load } = await import("./storage.ts");
  const { interpretDSL: interpret } = await import("./interpreter.ts");

  const dsl = await load(id);
  if (!dsl) {
    return null;
  }

  return interpret(dsl);
}

/**
 * Load all generated strategies as executable Strategy objects
 */
export async function loadAllAsStrategies(): Promise<
  import("./interpreter.ts").DSLBasedStrategy[]
> {
  const { listStrategies: list } = await import("./storage.ts");
  const { interpretDSL: interpret } = await import("./interpreter.ts");

  const dsls = await list();
  return dsls.map((dsl) => interpret(dsl));
}
