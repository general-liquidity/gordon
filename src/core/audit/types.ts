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
 * A single tool invocation within an agent step.
 */
export const AuditToolCallSchema = z.object({
  tool_name: z.string(),
  input_summary: z.string(),
  output_summary: z.string(),
  duration_ms: z.number(),
  success: z.boolean(),
  error: z.string().optional(),
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
