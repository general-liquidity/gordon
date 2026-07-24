/**
 * Decision Trace — structured reasoning record for audited actions.
 *
 * The audit log's `metadata` field is a free-form Record<string, unknown>.
 * A DecisionTrace is a conventional SHAPE within that field that captures
 * *why* an action happened: which agent chain made the call, what tools
 * were involved, what the LLM's reasoning summary was, and the upstream
 * plan (if any) that sanctioned it.
 *
 * Use case: when reviewing audit history to understand a specific trade,
 * a decision trace lets you reconstruct the reasoning path without
 * re-running the session.
 *
 * This file defines the shape + a builder utility. Integration into
 * specific audit callsites is per-callsite — callers merge the trace
 * into their `metadata` via `withDecisionTrace(existingMetadata, trace)`.
 */

/**
 * One step in the agent chain that led to an action. Agents may
 * hand off to each other; each handoff creates a new step.
 */
export interface AgentChainStep {
  /** Agent name, matching `AgentAffinity` (Gordon, Executor, Planner, …). */
  agent: string;
  /** ISO 8601 timestamp when this agent took control. */
  at: string;
  /** Optional reason for handoff to this agent. */
  reason?: string;
}

/**
 * One tool invocation that contributed to the decision. Captures the
 * tool name + a hash of the arguments (not the full args — those can
 * be huge and sensitive). Result summary is a short string.
 */
export interface ToolCallRef {
  /** Tool ID (e.g. "get_candles", "place_market_order"). */
  toolName: string;
  /** ISO 8601 timestamp when the tool was called. */
  at: string;
  /** Short MD5 fingerprint of JSON-serialized arguments, for correlation. */
  argsFingerprint?: string;
  /** Outcome bucket. */
  outcome: "success" | "failure" | "blocked";
  /** One-line result summary. */
  resultSummary?: string;
}

/**
 * Full trace attached to an action's audit entry.
 */
export interface DecisionTrace {
  /** Version marker so future schema changes can be detected. */
  traceVersion: 1;
  /** Ordered agent-chain steps leading to the action. */
  agentChain: AgentChainStep[];
  /** Tool invocations relevant to the decision. */
  toolCalls: ToolCallRef[];
  /**
   * One-paragraph summary of the LLM's reasoning — NOT the full thinking
   * trace. Use the thinking phase's final critique or a distilled
   * rationale. Keep under ~500 chars for audit storage.
   */
  reasoningSummary?: string;
  /** Plan ID if this action was executed under a plan. */
  planId?: string;
  /** LLM-expressed confidence score (0–1) if available. */
  confidence?: number;
  /** Model identifier that produced the final decision. */
  model?: string;
  /** Provider identifier (anthropic, openai, google, xai, …). */
  provider?: string;
  /** ISO 8601 timestamp when the trace was finalized. */
  builtAt: string;
}

export interface DecisionTraceInput {
  agentChain?: AgentChainStep[];
  toolCalls?: ToolCallRef[];
  reasoningSummary?: string;
  planId?: string;
  confidence?: number;
  model?: string;
  provider?: string;
}

/**
 * Build a DecisionTrace from its parts. Validates invariants (agent chain
 * non-empty, reasoning summary length cap) and fills in defaults.
 */
export function buildDecisionTrace(input: DecisionTraceInput): DecisionTrace {
  const reasoning = input.reasoningSummary
    ? input.reasoningSummary.length > 500
      ? `${input.reasoningSummary.slice(0, 500)}…`
      : input.reasoningSummary
    : undefined;

  return {
    traceVersion: 1,
    agentChain: input.agentChain ?? [],
    toolCalls: input.toolCalls ?? [],
    reasoningSummary: reasoning,
    planId: input.planId,
    confidence: input.confidence,
    model: input.model,
    provider: input.provider,
    builtAt: new Date().toISOString(),
  };
}

/**
 * Merge a DecisionTrace into an existing audit metadata record.
 * The trace lives under the `decisionTrace` key so downstream query code
 * can extract it without type-gymnastics.
 */
export function withDecisionTrace(
  existing: Record<string, unknown> | undefined,
  trace: DecisionTrace,
): Record<string, unknown> {
  return {
    ...(existing ?? {}),
    decisionTrace: trace,
  };
}

/**
 * Type guard + safe extractor for code that reads audit metadata and
 * wants to work with a typed DecisionTrace instead of `unknown`.
 */
export function readDecisionTrace(
  metadata: Record<string, unknown> | undefined,
): DecisionTrace | null {
  if (!metadata) return null;
  const raw = metadata.decisionTrace;
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as Partial<DecisionTrace>;
  if (candidate.traceVersion !== 1) return null;
  return candidate as DecisionTrace;
}
