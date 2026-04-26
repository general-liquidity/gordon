/**
 * Permission Bubble — surface fork-subagent approval prompts to the
 * parent's terminal.
 *
 * In Claude Code's coordinator pattern, a fork child can declare
 * `permissionMode: "bubble"` so its own approval prompts surface in
 * the parent's UI rather than being silently auto-approved or
 * deadlocking the child. In Gordon's current single-process model
 * there's already only one runtime store + UI, so the routing is
 * structurally a no-op — but the *labelling* matters: the user needs
 * to see "Fork analyze-BTC is requesting permission to call
 * place_order" rather than just "this agent wants permission".
 *
 * This module provides:
 *   - `bubbledRequestMetadata(...)` — stamps a permission request
 *     with `{ bubbledFrom, forkTask }` metadata fields so the TUI
 *     can render the originating fork.
 *   - `buildBubbleHook(...)` — a PermissionEngine hook that auto-stamps
 *     the metadata when the requesting agent is a registered fork.
 *
 * Once Gordon adds true subagent context-isolation (worktree / remote
 * runners), this evolves into the real router. For today's in-process
 * model, it's a label-and-trace primitive.
 */

export interface BubbleRequestStamp {
  /** Fork subagent id that originated the request. */
  bubbledFrom: string;
  /** Human-readable description of the fork's task. */
  forkTask?: string;
  /** Whether the parent's auto-approve rules should also apply to forks. Default true. */
  inheritParentRules?: boolean;
}

export interface BubbleHookInput {
  toolName: string;
  agentId?: string;
  policy?: { approvalClass?: string };
}

export interface BubbleHookOutput {
  /** Metadata to merge into the approval request's `metadata` field. */
  metadata?: Record<string, unknown>;
  /** Tag that adapters can read to format the prompt message. */
  promptPrefix?: string;
}

export type ForkLookup = (subagentId: string) => { task?: string } | undefined;

/**
 * Pure stamper — caller has already determined the request originates
 * from a fork. Produces the metadata + prompt prefix the runtime store
 * and TUI consume.
 */
export function bubbledRequestMetadata(stamp: BubbleRequestStamp): BubbleHookOutput {
  const meta: Record<string, unknown> = {
    bubbledFrom: stamp.bubbledFrom,
  };
  if (stamp.forkTask) meta.forkTask = stamp.forkTask;
  if (stamp.inheritParentRules !== undefined) meta.inheritParentRules = stamp.inheritParentRules;
  const prefix = stamp.forkTask
    ? `[fork ${stamp.bubbledFrom}: "${stamp.forkTask}"]`
    : `[fork ${stamp.bubbledFrom}]`;
  return { metadata: meta, promptPrefix: prefix };
}

/**
 * Build a hook function that auto-stamps when the requesting agent's
 * id is registered as a fork. `lookup` is provided by the caller —
 * typically `(id) => agentRegistry.get(id)` filtered to fork-typed
 * entries, or a custom resolver that knows about the orchestrator's
 * fork-id convention.
 *
 * Returns null when the input doesn't carry an agentId or the lookup
 * doesn't resolve — caller treats that as "non-fork, leave unstamped".
 */
export function buildBubbleStamper(lookup: ForkLookup): (input: BubbleHookInput) => BubbleHookOutput | null {
  return (input) => {
    if (!input.agentId) return null;
    const fork = lookup(input.agentId);
    if (!fork) return null;
    return bubbledRequestMetadata({
      bubbledFrom: input.agentId,
      forkTask: fork.task,
      inheritParentRules: true,
    });
  };
}

/**
 * Helper for callers that already have the request and want to merge
 * the bubble stamp in-place. Returns a *new* object so callers can use
 * with immutable patterns.
 */
export function applyBubbleStampToRequest<T extends { metadata?: Record<string, unknown>; reason?: string }>(
  request: T,
  stamp: BubbleHookOutput,
): T {
  const merged: T = { ...request };
  if (stamp.metadata) {
    merged.metadata = { ...(request.metadata ?? {}), ...stamp.metadata };
  }
  if (stamp.promptPrefix) {
    const existing = request.reason ?? "";
    merged.reason = existing
      ? `${stamp.promptPrefix} ${existing}`
      : stamp.promptPrefix;
  }
  return merged;
}
