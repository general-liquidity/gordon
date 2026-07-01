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
  DurabilityClassSchema,
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
  DurabilityClass,
} from "./types.ts";

// Durability tiering (boundary payloads stored lossless)
export {
  DEFAULT_OFFLOAD_LIMIT,
  classifyHandoffPayload,
  isLossless,
  resolveDurabilityClass,
  applyDurabilityTruncation,
} from "./durability.ts";
export type { BoundaryHandoffKind } from "./durability.ts";

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
  verifyStoredAuditChain,
} from "./store.ts";

// Signing (tamper-evidence — see signing.ts for scope)
export {
  computeTraceContentHash,
  signTrace,
  verifyAuditChain,
  resolveAuditHmacKey,
  GENESIS_SIGNATURE,
  AUDIT_HMAC_KEY_ENV,
  AUDIT_HMAC_KEY_PATH_ENV,
} from "./signing.ts";
export type {
  AuditChainVerification,
  AuditChainBreak,
  AuditChainBreakReason,
} from "./signing.ts";

// Chain (singleton facade)
export { AuditChain } from "./chain.ts";
