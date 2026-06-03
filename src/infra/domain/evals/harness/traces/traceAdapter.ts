/**
 * Trace adapter (Phase 1).
 *
 * Bridges Gordon's existing decision-trace substrate (the signed audit
 * chain, `core/audit`) into the eval harness. A captured AuditTrace becomes:
 *   - a NormalizedTrace (ordered tool-call sequence) for process checks, and
 *   - an EvalTrajectory (text messages) for the LLM judge, and
 *   - optionally a frozen EvalScenario (silver→gold promotion) so a real
 *     failure mode the specs never imagined becomes a permanent regression
 *     test alongside the generated synthetic suite.
 *
 * This is the SOTA "production traces → evals" loop, fed from REAL runs
 * (paper-mode captures) rather than LLM-simulated users — which the 2026
 * "Lost in Simulation" result shows are unreliable proxies.
 */

import type { AuditTrace } from "../../../../../core/audit/types.ts";
import type { EvalCategory, EvalScenario, EvalTrajectory } from "../types.ts";
import type { NormalizedTrace, NormalizedToolCall } from "../process/processChecks.ts";
import { GORDON_SYSTEM_PROMPT } from "../generator/prompts.ts";

/** Flatten an AuditTrace's stepped tool calls into a single ordered sequence. */
export function auditTraceToNormalized(trace: AuditTrace): NormalizedTrace {
  const toolCalls: NormalizedToolCall[] = [];
  let order = 0;
  for (const step of trace.agent_steps) {
    for (const tc of step.tool_calls) {
      toolCalls.push({
        name: tc.tool_name,
        ok: tc.success,
        order: order++,
        agentId: step.agent_id,
        inputSummary: tc.input_summary,
        outputSummary: tc.output_summary,
      });
    }
  }
  return {
    toolCalls,
    ...(trace.risk_check_id !== undefined && { riskCheckId: trace.risk_check_id }),
    outcomeType: trace.outcome.type,
    ...(trace.agent_steps[0]?.agent_id !== undefined && { agentId: trace.agent_steps[0].agent_id }),
  };
}

/**
 * Build the judge-facing trajectory. Tool calls don't fit the content-only
 * Message shape, so the assistant turn summarizes the agent's reasoning +
 * outcome, and the tool-call sequence is preserved in metadata (and via the
 * NormalizedTrace for process checks).
 */
export function auditTraceToTrajectory(
  trace: AuditTrace,
  variantLabel?: string,
): EvalTrajectory {
  const reasoning = trace.agent_steps
    .map((s) => s.reasoning_summary)
    .filter((r) => r && r.length > 0)
    .join("\n");
  const assistant = [reasoning, `Outcome: ${trace.outcome.type} — ${trace.outcome.details}`]
    .filter((s) => s.length > 0)
    .join("\n\n");
  const toolNames = trace.agent_steps.flatMap((s) => s.tool_calls.map((t) => t.tool_name));

  return {
    id: variantLabel ?? trace.trace_id,
    messages: [
      {
        role: "system",
        content: `Captured decision trace (${trace.trigger.type} from ${trace.trigger.source}).`,
      },
      { role: "user", content: trace.trigger.payload_summary },
      { role: "assistant", content: assistant || "[no reasoning recorded]" },
    ],
    metadata: {
      traceId: trace.trace_id,
      outcomeType: trace.outcome.type,
      agentId: trace.agent_steps[0]?.agent_id ?? "unknown",
      toolCalls: toolNames.join(","),
    },
  };
}

function inferCategory(trace: AuditTrace): EvalCategory {
  switch (trace.outcome.type) {
    case "trade_executed":
    case "trade_rejected":
      return "execution";
    case "analysis_complete":
      return "analysis";
    case "alert_generated":
      return "scan";
    case "error":
      return "recovery";
    default:
      return "analysis";
  }
}

export interface PromoteOptions {
  /** Why this trace is worth freezing (shows up in notes). */
  reason: string;
  category?: EvalCategory;
  tags?: ReadonlyArray<string>;
  /** Rubric describing the behavior the promoted scenario should NOT repeat. */
  extraRubric?: string;
}

/**
 * Freeze a captured trace as a permanent EvalScenario. The userInput is the
 * real trigger that produced the (flagged) behavior; provenance is the trace
 * id so the promoted scenario is auditable back to the run it came from.
 */
export function promoteTraceToScenario(
  trace: AuditTrace,
  opts: PromoteOptions,
): EvalScenario {
  const shortId = trace.trace_id.slice(0, 8);
  const category = opts.category ?? inferCategory(trace);
  return {
    id: `gen-trace-${shortId}`,
    tags: ["trace", "promoted", ...(opts.tags ?? [])],
    category,
    systemPrompt: GORDON_SYSTEM_PROMPT,
    userInput: trace.trigger.payload_summary,
    derivedFrom: `trace:${trace.trace_id}`,
    notes: `Promoted from captured trace ${shortId} (outcome: ${trace.outcome.type}). ${opts.reason}`,
    extraRubric:
      opts.extraRubric ??
      [
        "This scenario was promoted from a real captured run that was flagged for review.",
        `Reason: ${opts.reason}`,
        "Heavily penalize any trajectory that repeats the flagged behavior; reward the corrected path.",
      ].join(" "),
  };
}
