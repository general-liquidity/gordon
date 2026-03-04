/**
 * Audit Trace Builder
 *
 * Fluent API for incrementally constructing AuditTrace objects during
 * agent execution. Generates UUIDs, auto-timestamps, and calculates
 * durations automatically.
 *
 * Multiple builders can be active concurrently — each instance is
 * independent and holds its own state.
 */

import type {
  AuditTrace,
  AuditTrigger,
  AuditOutcome,
  AuditToolCall,
  AuditAgentStep,
  TraceBuilder,
  StepBuilder,
} from "./types.ts";

// ============================================================================
// Step Builder Implementation
// ============================================================================

class StepBuilderImpl implements StepBuilder {
  readonly stepId: string;
  private readonly agentId: string;
  private readonly startedAt: string;
  private endedAt: string | undefined;
  private reasoning: string = "";
  private toolCalls: AuditToolCall[] = [];
  private handedOffTo: string | undefined;
  private handoffReason: string | undefined;
  private finished = false;

  constructor(agentId: string) {
    this.stepId = crypto.randomUUID();
    this.agentId = agentId;
    this.startedAt = new Date().toISOString();
  }

  addToolCall(call: AuditToolCall): void {
    if (this.finished) return;
    this.toolCalls.push(call);
  }

  setReasoning(summary: string): void {
    if (this.finished) return;
    this.reasoning = summary;
  }

  setHandoff(to: string, reason: string): void {
    if (this.finished) return;
    this.handedOffTo = to;
    this.handoffReason = reason;
  }

  finish(): void {
    if (this.finished) return;
    this.finished = true;
    this.endedAt = new Date().toISOString();
  }

  /** Convert to the serializable step shape. */
  toAgentStep(): AuditAgentStep {
    // Auto-finish if the caller forgot
    if (!this.finished) {
      this.finish();
    }
    return {
      step_id: this.stepId,
      agent_id: this.agentId,
      started_at: this.startedAt,
      ended_at: this.endedAt,
      reasoning_summary: this.reasoning,
      tool_calls: [...this.toolCalls],
      handed_off_to: this.handedOffTo,
      handoff_reason: this.handoffReason,
    };
  }
}

// ============================================================================
// Trace Builder Implementation
// ============================================================================

class TraceBuilderImpl implements TraceBuilder {
  readonly traceId: string;
  private trigger: AuditTrigger | null = null;
  private outcome: AuditOutcome | null = null;
  private parentTraceId: string | undefined;
  private riskCheckId: string | undefined;
  private steps: StepBuilderImpl[] = [];
  private startedAt: string;
  private endedAt: string | undefined;
  private finished = false;

  constructor() {
    this.traceId = crypto.randomUUID();
    this.startedAt = new Date().toISOString();
  }

  startTrace(trigger: AuditTrigger): void {
    if (this.finished) return;
    this.trigger = trigger;
    // Re-stamp the start time to the moment the trigger is set
    this.startedAt = new Date().toISOString();
  }

  addAgentStep(agentId: string): StepBuilder {
    if (this.finished) {
      // Return a no-op builder to avoid crashing callers
      return new StepBuilderImpl(agentId);
    }
    const step = new StepBuilderImpl(agentId);
    this.steps.push(step);
    return step;
  }

  setOutcome(outcome: AuditOutcome): void {
    if (this.finished) return;
    this.outcome = outcome;
  }

  setParentTraceId(parentId: string): void {
    if (this.finished) return;
    this.parentTraceId = parentId;
  }

  setRiskCheckId(riskCheckId: string): void {
    if (this.finished) return;
    this.riskCheckId = riskCheckId;
  }

  finish(): AuditTrace {
    if (!this.finished) {
      this.finished = true;
      this.endedAt = new Date().toISOString();
    }

    const endedMs = this.endedAt
      ? new Date(this.endedAt).getTime()
      : Date.now();
    const startedMs = new Date(this.startedAt).getTime();
    const durationMs = Math.max(0, endedMs - startedMs);

    // Build the agent steps, auto-finishing any that weren't explicitly finished
    const agentSteps: AuditAgentStep[] = this.steps.map((s) => s.toAgentStep());

    const trace: AuditTrace = {
      trace_id: this.traceId,
      parent_trace_id: this.parentTraceId,
      trigger: this.trigger ?? {
        type: "system",
        source: "unknown",
        payload_summary: "Trigger not set",
      },
      agent_steps: agentSteps,
      outcome: this.outcome ?? {
        type: "no_action",
        details: "Outcome not set",
      },
      started_at: this.startedAt,
      ended_at: this.endedAt,
      duration_ms: durationMs,
      risk_check_id: this.riskCheckId,
    };

    return trace;
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a new TraceBuilder. Each call returns an independent builder
 * that can be used concurrently with other builders.
 */
export function createTraceBuilder(): TraceBuilder {
  return new TraceBuilderImpl();
}
