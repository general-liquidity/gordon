/**
 * Stream Event Processing
 *
 * Extracted from orchestrator.ts — handles processing of individual stream chunks
 * including tool-call validation, agent switching, and event emission.
 */

import { emitEvent } from "../../../events/index.ts";
import { createModuleLogger } from "../../logger/index.ts";
import {
  formatRecoveryGuidance,
  getExecutionReadiness,
  optimizeToolResultForContext,
  recordToolCallFingerprint,
  registerPlanningArtifactFromResult,
  resetLoopSignals,
} from "../harness/runtimeHarness.ts";
import { recordToolCallForFriction } from "../harness/toolFrictionTracker.ts";
import { runLifecycleHooks } from "../harness/lifecycleHooks.ts";
import { compileSubagentProfiles, isToolAllowedForAgent } from "../harness/subagentProfiles.ts";
import { defaultHandoffCoordinator } from "./HandoffCoordinator.ts";
import { getDynamicToolAgentMap } from "../../runtime/routing/manager.ts";
import { checkToolSecurity } from "./guardrailEvaluator.ts";
import { tryRecover } from "../wiring/runtimeRecoveryWiring.ts";
import {
  getAgentForTool,
  buildDefaultExecutorHandoffBudget,
  isPlanningArtifactTool,
  requiresPlanningArtifact,
  TOOL_AGENT_MAP,
} from "./toolAgentMap.ts";
import type { StreamEvent } from "./types.ts";
import type { GordonContext } from "../types.ts";
import {
  BackgroundDispatchManager,
  type CompletedBackgroundTask,
} from "../background/backgroundDispatch.ts";
import { isCostHalted } from "../../platform/costTracker.ts";

const logger = createModuleLogger("orchestrator-stream");

// ============================================================================
// Stream Chunk Types (internal Mastra representation)
// ============================================================================

export interface StreamChunk {
  type: string;
  payload?: {
    agentId?: string;
    toolName?: string;
    /** Mastra/AI-SDK supplies the tool call id on tool-call and tool-result chunks. */
    toolCallId?: string;
    text?: string;
    args?: Record<string, unknown>;
    result?: unknown;
  };
}

// ============================================================================
// Compiled Subagent Profiles Helper
// ============================================================================

export function getCompiledSubagentProfiles() {
  return compileSubagentProfiles(
    TOOL_AGENT_MAP,
    defaultHandoffCoordinator.getValidHandoffRules(),
    getDynamicToolAgentMap(),
  );
}

// ============================================================================
// Stream Processing Context
// ============================================================================

/**
 * Mutable state passed through stream event processing.
 * Tracks the current active agent and accumulated text.
 *
 * `pendingToolCalls` (FW1 emitter): tracks tool-call ids the model has
 * emitted into the message array but for which a tool-result chunk has
 * not yet arrived. On stream cancellation or error, the orchestrator
 * iterates this map and emits `reportToolCallInterruption(id, reason)`
 * so the next turn's reconciler can synthesize matching tool_result
 * blocks. Cleared at construction; entries added in `processToolCallChunk`
 * and removed in `processToolResult`.
 */
export interface StreamProcessingState {
  currentAgent: string | undefined;
  fullText: string;
  lastSubAgentToolResult: {
    toolName: string;
    result: unknown;
    agent: string | undefined;
  } | null;
  pendingToolCalls: Map<
    string,
    { toolName: string; startedAt: number; agent: string | undefined }
  >;
  /**
   * In-loop background tool dispatch manager. Optional + lazily created via
   * `getBackgroundManager(state)` so existing `StreamProcessingState` literals
   * (e.g. in the orchestrator) need no change. Holds in-flight
   * `backgroundEligible` tool tasks; when one completes, its result is
   * re-injected into the conversation via `drainBackgroundResults` so the loop
   * continues and the model can react (Mastra "streamUntilIdle" pattern).
   * Execution/money tools are never placed here — the deny-list in
   * backgroundDispatch.ts forces them foreground.
   */
  background?: BackgroundDispatchManager;
}

/**
 * Lazily get (and cache) the background-dispatch manager for a stream. Keeping
 * it lazy means callers that never background a tool pay nothing, and
 * pre-existing state literals stay valid without a `background` field.
 */
export function getBackgroundManager(state: StreamProcessingState): BackgroundDispatchManager {
  if (!state.background) {
    state.background = new BackgroundDispatchManager();
  }
  return state.background;
}

// ============================================================================
// Tool-Call Validation
// ============================================================================

export interface ToolCallValidationResult {
  allowed: boolean;
  event?: StreamEvent;
  shouldReturn?: boolean;
}

/**
 * Validate a tool call against loop detection, subagent profiles, security,
 * and planning artifact requirements.
 *
 * Returns { allowed: true } if the call is permitted, or { allowed: false, event, shouldReturn }
 * with the error event to yield and whether to abort the stream.
 */
export async function validateToolCall(
  toolName: string,
  toolArgs: Record<string, unknown> | undefined,
  detectedAgent: string | undefined,
  currentAgent: string | undefined,
  context: GordonContext,
): Promise<ToolCallValidationResult> {
  // 0. Cost-budget halt — block all tool dispatch when the session/daily
  // LLM cost budget has been exceeded (action="halt"). Checked before loop
  // detection so a halted session stops spending immediately.
  if (isCostHalted()) {
    return {
      allowed: false,
      shouldReturn: true,
      event: {
        type: "error",
        error: formatRecoveryGuidance({
          category: "policy_block",
          title: "Cost budget halted",
          detail: "Daily/session LLM cost budget exceeded",
          nextSteps: ["/cost reset to resume"],
        }),
      },
    };
  }

  // 1. Loop detection
  const loopState = recordToolCallFingerprint(context, toolName, toolArgs ?? {});
  // Per-turn tool-friction telemetry — distinct from loop detection:
  // counts *different* tool calls in the same turn so the operator can
  // see which questions cost too many tools. Fires once per turn when
  // the threshold (default 5) is crossed.
  try {
    recordToolCallForFriction(context, toolName);
  } catch {
    // Telemetry must never block tool dispatch.
  }
  if (loopState.blocked) {
    resetLoopSignals(context);
    // Recovery-tier escalation: Notify → Redirect → ForceStop.
    const recoveryDecision = tryRecover({
      fingerprint: loopState.fingerprint ?? `${toolName}:${JSON.stringify(toolArgs ?? {})}`,
      toolName,
    });
    if (recoveryDecision.action === "notify") {
      // Notify only — return an informational event but don't block.
      return {
        allowed: true,
        event: {
          type: "text_delta",
          content: `[recovery:notify] ${recoveryDecision.reminder ?? `Possible loop on ${toolName}.`}`,
          agentName: currentAgent,
        },
      };
    }
    if (recoveryDecision.action === "redirect") {
      return {
        allowed: false,
        shouldReturn: true,
        event: {
          type: "error",
          error: formatRecoveryGuidance({
            category: "policy_block",
            title: "Tool loop — redirect tier",
            detail: recoveryDecision.reminder ?? `${toolName} repeated; redirecting.`,
            nextSteps: [
              "Try a different approach to the same question — same tool with same args won't help.",
              "Consider asking the user for clarification rather than re-querying.",
            ],
          }),
        },
      };
    }
    // ForceStop (default tier-3 block when recovery wiring is disabled).
    return {
      allowed: false,
      shouldReturn: true,
      event: {
        type: "error",
        error: formatRecoveryGuidance({
          category: "policy_block",
          title: "Repeated tool loop blocked",
          detail: `${toolName} was invoked ${loopState.count} times with the same arguments in a short window.`,
          nextSteps: [
            "Revise the request or narrow the scope before retrying.",
            "Check whether the active venue or provider is causing the repeated fallback loop.",
          ],
        }),
      },
    };
  }

  // 2. Subagent profile isolation
  const compiledProfiles = getCompiledSubagentProfiles();
  if (detectedAgent && !isToolAllowedForAgent(compiledProfiles, detectedAgent, toolName)) {
    return {
      allowed: false,
      shouldReturn: true,
      event: {
        type: "error",
        error: formatRecoveryGuidance({
          category: "policy_block",
          title: "Tool blocked by subagent profile",
          detail: `${toolName} is not allowed for the compiled ${detectedAgent} tool profile.`,
          nextSteps: [
            "Retry with a narrower request or a different task scope.",
            "If this is a real capability gap, update the routed tool map rather than bypassing profile isolation.",
          ],
        }),
      },
    };
  }

  // 3. Security check
  const securityCheck = await checkToolSecurity(
    detectedAgent || currentAgent || "Gordon",
    toolName,
    context,
  );
  if (!securityCheck.allowed) {
    const reason = securityCheck.error || `Blocked tool call: ${toolName}`;
    await emitEvent("guardrail:blocked", {
      guardrailType: "input",
      reason,
      pattern: toolName,
      length: 0,
    });
    return {
      allowed: false,
      shouldReturn: true,
      event: { type: "error", error: reason },
    };
  }

  // 4. Planning artifact gate
  if (requiresPlanningArtifact(toolName)) {
    const symbol = typeof toolArgs?.symbol === "string" ? toolArgs.symbol : undefined;
    const readiness = getExecutionReadiness(context, symbol);
    if (!readiness.ready) {
      return {
        allowed: false,
        shouldReturn: true,
        event: {
          type: "error",
          error: formatRecoveryGuidance({
            category: "approval_required",
            title: "Execution phase blocked",
            detail: readiness.reason ?? "Execution requires a recent plan or preview.",
            nextSteps: [
              "Run a plan or preview step first in this thread.",
              "Then retry the live execution step once the plan is explicit.",
            ],
          }),
        },
      };
    }
  }

  return { allowed: true };
}

// ============================================================================
// Agent Handoff Processing
// ============================================================================

/**
 * Handle agent switch detection and lifecycle hook emission.
 * Returns the yielded StreamEvent (agent_switch) or null if no switch occurred.
 */
export async function handleAgentSwitch(
  detectedAgent: string,
  state: StreamProcessingState,
  context: GordonContext,
  toolName?: string,
  toolArgs?: Record<string, unknown>,
  eventType?: string,
): Promise<StreamEvent | null> {
  if (detectedAgent === state.currentAgent) {
    return null;
  }

  const previousAgent = state.currentAgent || "Gordon";
  state.currentAgent = detectedAgent;

  // Track the handoff
  await defaultHandoffCoordinator.track(previousAgent, state.currentAgent, {
    toolName,
    toolArgs,
    handoffBudget:
      state.currentAgent === "Executor"
        ? buildDefaultExecutorHandoffBudget(context)
        : undefined,
    eventType,
    mode: context.config?.permissionMode,
  });

  await runLifecycleHooks("agent_switch", context, {
    threadId: context.threadId,
    agentName: state.currentAgent,
    payload: {
      fromAgent: previousAgent,
      toAgent: state.currentAgent,
    },
  });

  await runLifecycleHooks("subagent_stop", context, {
    threadId: context.threadId,
    subagentName: previousAgent,
    subagentType: previousAgent,
    payload: { eventType: "subagent_stop" },
  });

  await runLifecycleHooks("subagent_start", context, {
    threadId: context.threadId,
    subagentName: state.currentAgent,
    subagentType: state.currentAgent,
    payload: { eventType: "subagent_start" },
  });

  return {
    type: "agent_switch",
    agentName: state.currentAgent,
  };
}

// ============================================================================
// Tool Result Processing
// ============================================================================

/**
 * Process a tool result: register planning artifacts, optimize for context, run hooks.
 * Returns the StreamEvent to yield.
 */
export async function processToolResult(
  toolName: string | undefined,
  toolResult: unknown,
  state: StreamProcessingState,
  context: GordonContext,
): Promise<StreamEvent> {
  if (isPlanningArtifactTool(toolName)) {
    registerPlanningArtifactFromResult(context, toolName ?? "tool", toolResult);
  }

  const optimizedToolResult = await optimizeToolResultForContext(
    context,
    toolName ?? "tool",
    toolResult,
  );

  // Wire: track tool result in conversation-wide budget
  try {
    const { getConversationBudget } = await import("../../context/budgeting/conversationBudget.ts");
    const resultStr = typeof optimizedToolResult.result === "string"
      ? optimizedToolResult.result
      : JSON.stringify(optimizedToolResult.result);
    getConversationBudget().add(toolName ?? "unknown", `tc_${Date.now()}`, resultStr, 0);
  } catch { /* non-critical */ }

  await runLifecycleHooks("tool_call_end", context, {
    threadId: context.threadId,
    agentName: state.currentAgent,
    toolName,
    payload: {
      optimized: optimizedToolResult.offloaded,
      scratchFile: optimizedToolResult.scratchFile,
    },
  });

  // Capture for synthesis if stream ends without text
  if (toolResult) {
    state.lastSubAgentToolResult = {
      toolName: toolName || "unknown",
      result: optimizedToolResult.result,
      agent: state.currentAgent,
    };
  }

  return {
    type: "tool_call_end",
    toolName,
    toolResult: optimizedToolResult.result,
    agentName: state.currentAgent,
  };
}

// ============================================================================
// Background Tool Result Re-injection
// ============================================================================

/**
 * Re-inject one completed background tool result into the conversation by
 * routing it through the SAME `processToolResult` path a synchronous tool
 * result takes — so it lands in the conversation budget, registers any
 * planning artifact, fires `tool_call_end` lifecycle hooks, and is captured in
 * `state.lastSubAgentToolResult`. The returned `tool_call_end` event carries
 * the (offloaded) result, which is what the loop injects into the message list.
 *
 * A failed background task is surfaced as `{ error }` so the model still gets
 * attribution rather than a silently-dropped call.
 */
async function reinjectBackgroundResult(
  task: CompletedBackgroundTask,
  state: StreamProcessingState,
  context: GordonContext,
): Promise<StreamEvent> {
  const payload = task.error ? { error: task.error } : task.result;
  return processToolResult(task.toolName, payload, state, context);
}

/**
 * Drain all *already-completed* background tasks and yield their re-injection
 * events, WITHOUT awaiting any still-in-flight task. The orchestrator loop
 * calls this between stream chunks: each yielded `tool_call_end` injects the
 * background result into the message list, and the trailing `text_delta`
 * continuation marker re-engages the model so it can react to the new result
 * (the "streamUntilIdle" pattern). No-op (yields nothing) when there is no
 * manager or nothing has completed, so the hot path stays free.
 */
export async function* drainBackgroundResults(
  state: StreamProcessingState,
  context: GordonContext,
): AsyncGenerator<StreamEvent, void> {
  const manager = state.background;
  if (!manager || !manager.hasCompleted()) return;

  for (const task of manager.takeCompleted()) {
    logger.info("Re-injecting background tool result", {
      toolName: task.toolName,
      id: task.id,
      durationMs: task.completedAt - task.startedAt,
      failed: Boolean(task.error),
    });
    yield await reinjectBackgroundResult(task, state, context);
    // Continuation marker — tells subscribers (and prompts the loop) that a
    // background result just arrived and the agent should respond to it.
    yield {
      type: "text_delta",
      content: `\n[background:${task.toolName} complete — re-engaging]\n`,
      agentName: state.currentAgent,
    };
  }
}

/**
 * Turn-end drain: await every in-flight background task, then re-inject all
 * results. Called once before the stream closes so no backgrounded result is
 * lost when the model's own output finishes first. No-op without a manager.
 */
export async function* settleBackgroundResults(
  state: StreamProcessingState,
  context: GordonContext,
): AsyncGenerator<StreamEvent, void> {
  const manager = state.background;
  if (!manager) return;

  const tasks = await manager.settleAll();
  for (const task of tasks) {
    logger.info("Re-injecting background tool result at turn end", {
      toolName: task.toolName,
      id: task.id,
      failed: Boolean(task.error),
    });
    yield await reinjectBackgroundResult(task, state, context);
  }
}
