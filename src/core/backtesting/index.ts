/**
 * Playbook Backtesting Module
 *
 * Barrel exports for the playbook backtesting system.
 * Provides types, engine, simulator, storage, and formatting.
 */

// Types & Schemas
export {
  PlaybookBacktestConfigSchema,
  PlaybookBacktestTradeSchema,
  PlaybookBacktestResultSchema,
  type PlaybookBacktestConfig,
  type PlaybookBacktestTrade,
  type PlaybookBacktestResult,
  type Candle,
} from "./types.ts";

// Rule Engine
export { PlaybookRuleEngine } from "./rule-engine.ts";
export type { EntrySignal, ExitSignal } from "./rule-engine.ts";

// Simulator
export { BacktestSimulator } from "./simulator.ts";

// Storage
export {
  initPlaybookBacktestTable,
  savePlaybookBacktestResult,
  loadPlaybookBacktestResult,
  listPlaybookBacktestResults,
  getLatestPlaybookBacktest,
  cleanupPlaybookBacktests,
  type PlaybookBacktestQuery,
  type PlaybookBacktestSummary,
} from "./store.ts";

// Formatter
export {
  formatBacktestSummary,
  formatTradeList,
  formatEquityCurve,
  formatBacktestComparison,
} from "./formatter.ts";
