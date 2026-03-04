/**
 * Telemetry — public API
 */

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
  recordError,
  recordFeature,
  flush,
} from "./telemetry.ts";

export type { TelemetryEvent, TelemetryEventName, TelemetryProperties } from "./events.ts";

export {
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
} from "./research-data.ts";

export type {
  AnonymizedTrade,
  AnonymizedBacktest,
  AnonymizedAnalysis,
  AnonymizedMarketContext,
  AnonymizedStrategyGeneration,
} from "./research-data.ts";
