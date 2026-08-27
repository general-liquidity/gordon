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
import type { EvalCategory, EvalScenario, EvalTrajectory, ScenarioTurn } from "../types.ts";
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

export interface TrajectoryFromTraceOptions {
  /**
   * The real, ordered user turns from the captured multi-turn session. A single
   * AuditTrace carries only one `trigger.payload_summary`; a real
   * progressive-disclosure session (trader clarifies venue / risk budget / keep-BTC
   * across turns) knows the individual messages. When supplied and non-empty,
   * every turn is preserved as its own user message instead of collapsing to the
   * single payload summary. These come from REAL captures, never a simulator.
   */
  userTurns?: ReadonlyArray<string>;
}

/**
 * Build the judge-facing trajectory. Tool calls don't fit the content-only
 * Message shape, so the assistant turn summarizes the agent's reasoning +
 * outcome, and the tool-call sequence is preserved in metadata (and via the
 * NormalizedTrace for process checks).
 *
 * Multi-turn: when `opts.userTurns` is supplied, each turn is preserved as its
 * own user message (progressive-disclosure preservation) rather than collapsing
 * to `trigger.payload_summary`. Absent => single user turn (existing behavior).
 */
export function auditTraceToTrajectory(
  trace: AuditTrace,
  variantLabel?: string,
  opts: TrajectoryFromTraceOptions = {},
): EvalTrajectory {
  const reasoning = trace.agent_steps
    .map((s) => s.reasoning_summary)
    .filter((r) => r && r.length > 0)
    .join("\n");
  const assistant = [reasoning, `Outcome: ${trace.outcome.type} — ${trace.outcome.details}`]
    .filter((s) => s.length > 0)
    .join("\n\n");
  const toolNames = trace.agent_steps.flatMap((s) => s.tool_calls.map((t) => t.tool_name));

  const userTurns =
    opts.userTurns && opts.userTurns.length > 0 ? opts.userTurns : [trace.trigger.payload_summary];
  const userMessages = userTurns.map((content) => ({ role: "user" as const, content }));

  return {
    id: variantLabel ?? trace.trace_id,
    messages: [
      {
        role: "system",
        content: `Captured decision trace (${trace.trigger.type} from ${trace.trigger.source}).`,
      },
      ...userMessages,
      { role: "assistant", content: assistant || "[no reasoning recorded]" },
    ],
    metadata: {
      traceId: trace.trace_id,
      outcomeType: trace.outcome.type,
      agentId: trace.agent_steps[0]?.agent_id ?? "unknown",
      toolCalls: toolNames.join(","),
      turnCount: userTurns.length,
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
  /**
   * The real, ordered user turns from the captured session. When supplied
   * (non-empty), the promoted scenario becomes multi-turn: `turns` carries the
   * sequence and `userInput` is the first turn. Absent => single-turn scenario
   * whose `userInput` is `trigger.payload_summary` (existing behavior).
   */
  turns?: ReadonlyArray<ScenarioTurn>;
}

/**
 * Freeze a captured trace as a permanent EvalScenario. The userInput is the
 * real trigger that produced the (flagged) behavior; provenance is the trace
 * id so the promoted scenario is auditable back to the run it came from.
 */
export function promoteTraceToScenario(trace: AuditTrace, opts: PromoteOptions): EvalScenario {
  const shortId = trace.trace_id.slice(0, 8);
  const category = opts.category ?? inferCategory(trace);
  const hasTurns = opts.turns !== undefined && opts.turns.length > 0;
  const userInput = hasTurns ? opts.turns![0]!.user : trace.trigger.payload_summary;
  return {
    id: `gen-trace-${shortId}`,
    tags: ["trace", "promoted", ...(opts.tags ?? [])],
    category,
    systemPrompt: GORDON_SYSTEM_PROMPT,
    userInput,
    ...(hasTurns && { turns: opts.turns }),
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
