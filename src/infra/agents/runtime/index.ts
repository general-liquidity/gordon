/**
 * Runtime primitives barrel.
 *
 * Stable import path for harness-runtime helpers that callers wire into
 * their own hot-paths. These are pure-functional building blocks — they
 * never call agents or LLMs directly; the host code does.
 *
 *   - durableStep         — checkpoint-and-replay for deterministic ops
 *   - errorOnlyOutputFilter — back-pressure for noisy tool output
 */

export {
  isDurableStepEnabled,
  defaultDurableStepPath,
  hashInput,
  loadStepRecord,
  loadStepRecords,
  executeStep,
  recordToPayload as durableStepRecordToPayload,
  resetInflightForTesting as resetDurableStepInflightForTesting,
} from "./durableStep.ts";
export type {
  StepRecord,
  ExecuteStepOptions,
  ExecuteStepResult,
} from "./durableStep.ts";

export {
  filterOutput,
  filterOutputForAgent,
  resultToPayload as filterResultToPayload,
  DEFAULT_ERROR_PATTERNS,
} from "./errorOnlyOutputFilter.ts";
export type {
  FilterAction,
  FilterRule,
  FilterOptions,
  FilterResult,
} from "./errorOnlyOutputFilter.ts";

export {
  defaultKvCacheMetricPath,
  recordCacheCall,
  readCacheCalls,
  summarizeHitRate,
  formatHitRateSummary,
  summaryToPayload as kvCacheSummaryToPayload,
} from "./kvCacheHitMetric.ts";
export type {
  CacheCallRecord,
  CacheHitRateSummary,
  RecordCallInput,
} from "./kvCacheHitMetric.ts";

export {
  formatSilent,
  formatSilentPipeline,
  resultToPayload as silentResultToPayload,
} from "./silentToolResultFormatter.ts";
export type {
  SilentFormatInput,
  SilentFormatResult,
} from "./silentToolResultFormatter.ts";
