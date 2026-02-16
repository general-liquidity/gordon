/**
 * Audit Chain — Barrel Exports
 *
 * Decision traceability system for Gordon CLI.
 * Records every agent decision from trigger -> reasoning -> tool calls -> outcome.
 */

// Types
export {
  AuditTraceSchema,
  AuditAgentStepSchema,
  AuditToolCallSchema,
  AuditTriggerSchema,
  AuditOutcomeSchema,
} from "./types.ts";
export type {
  AuditTrace,
  AuditAgentStep,
  AuditToolCall,
  AuditTrigger,
  AuditOutcome,
  TraceBuilder,
  StepBuilder,
  AuditQueryFilters,
  AuditStats,
} from "./types.ts";

// Builder
export { createTraceBuilder } from "./builder.ts";

// Store
export {
  initAuditTables,
  saveTrace,
  getTrace,
  getTracesByPosition,
  getTracesByAgent,
  getTracesByTimeRange,
  getTracesByOutcomeType,
  getRecentTraces,
  getTraceStats,
  pruneOldTraces,
} from "./store.ts";

// Chain (singleton facade)
export { AuditChain } from "./chain.ts";
