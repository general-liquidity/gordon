/**
 * Audit Chain Types
 *
 * Decision traceability types for the Agent Audit Chain.
 * Every decision from event trigger -> agent reasoning -> tool calls -> outcome
 * is captured in an AuditTrace, modelled after distributed tracing (spans).
 */

import { z } from "zod";

// ============================================================================
// Audit Trace Schema
// ============================================================================

/**
 * Durability tiering for a stored payload.
 *
 *   "boundary"   — cross-agent handoff payloads (dispatch-in, child deliverable,
 *                  absorption): the one record you most need to resume a
 *                  handed-off unit. Stored LOSSLESS, exempt from offload
 *                  truncation.
 *   "bestEffort" — process chatter / routine logs, truncatable like any log line.
 *
 * Left OPTIONAL and treated as "bestEffort" when absent so existing (unclassified)
 * records are unaffected and their tamper-chain hashes stay identical. See
 * durability.ts for the truncation-exemption logic.
 */
export const DurabilityClassSchema = z.enum(["boundary", "bestEffort"]);
export type DurabilityClass = z.infer<typeof DurabilityClassSchema>;

/**
 * A single tool invocation within an agent step.
 */
export const AuditToolCallSchema = z.object({
  tool_name: z.string(),
  input_summary: z.string(),
  output_summary: z.string(),
  duration_ms: z.number(),
  success: z.boolean(),
  error: z.string().optional(),
  durability_class: DurabilityClassSchema.optional(),
});

export type AuditToolCall = z.infer<typeof AuditToolCallSchema>;

/**
 * A single agent execution step within a trace.
 */
export const AuditAgentStepSchema = z.object({
  step_id: z.string().uuid(),
  agent_id: z.string(),
  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),

  reasoning_summary: z.string(),

  tool_calls: z.array(AuditToolCallSchema),

  handed_off_to: z.string().optional(),
  handoff_reason: z.string().optional(),

  // Durability tier for this step's handoff payload. "boundary" marks a
  // dispatch-in / child-deliverable step whose reasoning + tool summaries must
  // survive lossless. Absent => bestEffort. HMAC-safe: undefined is dropped
  // from the canonical hash, so unclassified steps hash identically.
  durability_class: DurabilityClassSchema.optional(),
});

export type AuditAgentStep = z.infer<typeof AuditAgentStepSchema>;

/**
 * What triggered a decision chain.
 */
export const AuditTriggerSchema = z.object({
  type: z.enum([
    "user_message",
    "market_event",
    "scheduled",
    "agent_handoff",
    "system",
  ]),
  event_type: z.string().optional(),
  source: z.string(),
  payload_summary: z.string(),
});

export type AuditTrigger = z.infer<typeof AuditTriggerSchema>;

/**
 * The outcome of the decision chain.
 */
export const AuditOutcomeSchema = z.object({
  type: z.enum([
    "trade_executed",
    "trade_rejected",
    "analysis_complete",
    "alert_generated",
    "no_action",
    "error",
  ]),
  position_id: z.string().optional(),
  details: z.string(),
});

export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

/**
 * Whether the parent actually took up a child's returned result.
 *
 *   "observed" — parent saw the child deliverable land in its context.
 *   "absorbed" — parent incorporated it into its own reasoning/decision.
 *   "dropped"  — deliverable arrived but was NOT taken up (silently discarded).
 *
 * The distinction matters on resume: without it you cannot tell an absorbed
 * child result from one that was silently dropped.
 */
export const AbsorptionStatusSchema = z.enum(["observed", "absorbed", "dropped"]);
export type AbsorptionStatus = z.infer<typeof AbsorptionStatusSchema>;

/**
 * Explicit link from a parent step to the child trace it delegated, recording
 * whether the child's result was absorbed vs dropped.
 *
 * This is a boundary-durability payload (reuses the "absorption" handoff kind →
 * DurabilityClass "boundary"; see durability.ts) so it is stored lossless. It is
 * carried on the trace OUTSIDE the signed content (see SIGNING_FIELDS in
 * signing.ts): it is a post-hoc annotation, added when the parent resumes, so it
 * must never disturb the tamper-evidence hash of the already-signed trace.
 */
export const ParentAbsorptionRecordSchema = z.object({
  parent_step_id: z.string(),
  child_trace_id: z.string(),
  status: AbsorptionStatusSchema,
  durability_class: DurabilityClassSchema,
  note: z.string().optional(),
  recorded_at: z.string().datetime(),
});
export type ParentAbsorptionRecord = z.infer<typeof ParentAbsorptionRecordSchema>;

/**
 * A complete decision trace — one end-to-end flow from trigger to outcome.
 */
export const AuditTraceSchema = z.object({
  trace_id: z.string().uuid(),
  parent_trace_id: z.string().uuid().optional(),

  trigger: AuditTriggerSchema,
  agent_steps: z.array(AuditAgentStepSchema),
  outcome: AuditOutcomeSchema,

  started_at: z.string().datetime(),
  ended_at: z.string().datetime().optional(),
  duration_ms: z.number().optional(),

  risk_check_id: z.string().optional(),

  // Parent-absorption records: parent step → child trace, absorbed vs dropped.
  // ADDITIVE and UNSIGNED — listed in SIGNING_FIELDS so it is excluded from the
  // content hash. A trace hashes identically whether this field is absent or
  // populated, so annotating a signed trace with absorption never breaks the
  // tamper chain. See signing.ts.
  absorptions: z.array(ParentAbsorptionRecordSchema).optional(),

  // Tamper-evidence chain (see signing.ts). Optional so traces recorded
  // before signing shipped still parse — verification treats them as broken.
  content_hash: z.string().optional(),
  prev_signature: z.string().optional(),
  signature: z.string().optional(),
});

export type AuditTrace = z.infer<typeof AuditTraceSchema>;

// ============================================================================
// Builder Interfaces
// ============================================================================

/**
 * Incrementally builds a trace during execution.
 */
export interface TraceBuilder {
  readonly traceId: string;
  startTrace(trigger: AuditTrigger): void;
  addAgentStep(agentId: string): StepBuilder;
  setOutcome(outcome: AuditOutcome): void;
  setParentTraceId(parentId: string): void;
  setRiskCheckId(riskCheckId: string): void;
  finish(): AuditTrace;
}

/**
 * Incrementally builds an agent step within a trace.
 */
export interface StepBuilder {
  readonly stepId: string;
  addToolCall(call: AuditToolCall): void;
  setReasoning(summary: string): void;
  setHandoff(to: string, reason: string): void;
  finish(): void;
}

// ============================================================================
// Query Interfaces
// ============================================================================

/**
 * Filters for querying the audit trail.
 */
export interface AuditQueryFilters {
  agentId?: string;
  outcomeType?: AuditOutcome["type"];
  triggerType?: AuditTrigger["type"];
  positionId?: string;
  from?: Date;
  to?: Date;
  limit?: number;
}

/**
 * Summary statistics for the audit trail.
 */
export interface AuditStats {
  total: number;
  byAgent: Record<string, number>;
  byOutcome: Record<string, number>;
  byTrigger: Record<string, number>;
  avgDurationMs: number;
}
