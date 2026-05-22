/**
 * Timeline wiring — runtime adapter that registers Gordon's existing
 * cognition primitives (thinkingPhase, critiquePhase) with the
 * context-timeline registry.
 *
 * Used by:
 *   - cognition/thinkingPhase.ts — wraps runThinkingPhase
 *   - cognition/critiquePhase.ts — wraps runCritiquePhase
 *   - tools/runtime/flow/investigationTool.ts — wraps runInvestigation
 *
 * Implementation: a small async wrapper that calls recordAgentStart
 * before the work, recordAgentEnd in finally (so completion fires even
 * on error), and propagates the result.
 */

import {
  recordAgentEnd,
  recordAgentStart,
  recordAgentProgress,
  estimateTokensFromMessages,
  type AgentContextType,
} from "../contextTimeline.ts";

export interface TimelineEntryOptions {
  /** Stable id — typically a session/request id with a short suffix. */
  agentId: string;
  /** Display name. */
  agentName: string;
  /** Topology classification. */
  agentType: AgentContextType;
  /** Parent agent id if this is a child of another tracked agent. */
  parentAgentId?: string;
  /** Initial token estimate (pre-call). */
  initialTokens?: number;
}

/**
 * Wrap an async function with timeline registration. The agent is
 * marked started before the work begins and ended (with endedAt
 * timestamp) when the work completes — success or failure.
 *
 * Errors from the wrapped function propagate; the registry is updated
 * either way so the operator sees the agent transition out of active
 * state even when the work failed.
 */
export async function withTimelineEntry<T>(
  opts: TimelineEntryOptions,
  fn: () => Promise<T>,
): Promise<T> {
  recordAgentStart({
    agentId: opts.agentId,
    agentName: opts.agentName,
    agentType: opts.agentType,
    contextTokenEstimate: opts.initialTokens ?? 0,
    parentAgentId: opts.parentAgentId,
  });
  try {
    return await fn();
  } finally {
    recordAgentEnd(opts.agentId);
  }
}

/**
 * Generate a short stable id from a base string + a random suffix.
 * Useful for the typical case where a session has no pre-existing
 * agent id to thread through.
 */
export function generateTimelineAgentId(base: string): string {
  const suffix = Math.random().toString(36).slice(2, 8);
  return `${base}-${suffix}`;
}

/**
 * Update an in-flight agent's token + tool-call counters. Used by
 * long-running primitives (investigation, fork) so the timeline shows
 * progress mid-run, not just start/end.
 */
export function reportTimelineProgress(
  agentId: string,
  update: { tokenEstimate?: number; toolCallCount?: number },
): void {
  recordAgentProgress(agentId, {
    contextTokenEstimate: update.tokenEstimate,
    toolCallCount: update.toolCallCount,
  });
}

// Re-export estimator so callers don't need a second import
export { estimateTokensFromMessages };
