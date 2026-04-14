// ============================================================================
// Platform — Core infrastructure services
//
// Storage, caching, logging, observability, resilience, telemetry, audit.
// These are foundational services used by all other modules.
// ============================================================================

export * from "../storage/index.ts";
export * from "./cache/index.ts";
export * from "../logger/index.ts";
export * from "./observability/index.ts";
export * from "./resilience/index.ts";
export {
  init,
  shutdown,
  isEnabled,
  enable,
  disable,
  getStatus,
  record,
  recordSessionStart,
  recordSessionEnd,
  recordCommand,
  recordAgentRoute,
  recordError as recordTelemetryError,
  recordFeature,
  flush,
  isResearchEnabled,
  enableResearch,
  disableResearch,
  getResearchStatus,
  collectTrade,
  collectBacktest,
  collectAnalysis,
  collectStrategyGeneration,
  uploadResearchData,
  clearResearchData,
} from "./telemetry/index.ts";
export type {
  TelemetryEvent,
  TelemetryEventName,
  TelemetryProperties,
  AnonymizedTrade,
  AnonymizedBacktest,
  AnonymizedAnalysis,
  AnonymizedMarketContext,
  AnonymizedStrategyGeneration,
} from "./telemetry/index.ts";
export * from "./audit/index.ts";
