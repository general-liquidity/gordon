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
import { runLifecycleHooks } from "../harness/lifecycleHooks.ts";
import { compileSubagentProfiles, isToolAllowedForAgent } from "../harness/subagentProfiles.ts";
import { defaultHandoffCoordinator } from "./HandoffCoordinator.ts";
import { getDynamicToolAgentMap } from "../../runtime/routing/manager.ts";
import { checkToolSecurity } from "./guardrailEvaluator.ts";
import {
  getAgentForTool,
  buildDefaultExecutorHandoffBudget,
  isPlanningArtifactTool,
  requiresPlanningArtifact,
  TOOL_AGENT_MAP,
} from "./toolAgentMap.ts";
import type { StreamEvent } from "./types.ts";
import type { GordonContext } from "../types.ts";

const logger = createModuleLogger("orchestrator-stream");

// ============================================================================
// Stream Chunk Types (internal Mastra representation)
// ============================================================================

export interface StreamChunk {
  type: string;
  payload?: {
    agentId?: string;
    toolName?: string;
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
 */
export interface StreamProcessingState {
  currentAgent: string | undefined;
  fullText: string;
  lastSubAgentToolResult: {
    toolName: string;
    result: unknown;
    agent: string | undefined;
  } | null;
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
  // 1. Loop detection
  const loopState = recordToolCallFingerprint(context, toolName, toolArgs ?? {});
  if (loopState.blocked) {
    resetLoopSignals(context);
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
    const { getConversationBudget } = await import("../../context/conversationBudget.ts");
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
