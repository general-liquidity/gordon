import type { GordonContext } from "../types.ts";

export type LifecycleHookStage =
  | "session_start"
  | "session_end"
  | "before_request"
  | "after_request"
  | "tool_call_start"
  | "tool_call_end"
  | "tool_call_error"
  | "agent_switch"
  | "before_compaction"
  | "after_compaction"
  | "subagent_start" // fired when a sub-agent begins execution
  | "subagent_stop"; // fired when a sub-agent completes or errors

export type CompactionReason = "manual" | "threshold" | "overflow";

export interface LifecycleHookPayload {
  threadId?: string;
  agentName?: string;
  subagentName?: string; // populated for subagent_start / subagent_stop
  subagentType?: string; // e.g. "Scanner", "Analyst", "Planner"
  toolName?: string;
  userMessage?: string;
  response?: string;
  error?: string;
  /**
   * Why compaction fired — populated on before_compaction / after_compaction.
   * "threshold" = normal pressure-driven compaction, "overflow" = emergency
   * (fill ratio at full), "manual" = user invoked /compact.
   */
  compactionReason?: CompactionReason;
  /**
   * Whether the compaction result will trigger a retry / subsequent run.
   * Populated on after_compaction when the summarizer soft-failed (ran but
   * didn't shrink) and the circuit-breaker will retry next turn.
   */
  willRetry?: boolean;
  /**
   * Whether the compaction was aborted mid-run (summarizer threw). Populated
   * on after_compaction.
   */
  aborted?: boolean;
  payload?: Record<string, unknown>;
}

export interface LifecycleHookResult {
  blocked?: boolean;
  reason?: string;
  annotations?: string[];
}

export type LifecycleHook = (
  context: GordonContext,
  payload: LifecycleHookPayload,
) => Promise<LifecycleHookResult | undefined> | LifecycleHookResult | undefined;

interface RegisteredLifecycleHook {
  id: string;
  stage: LifecycleHookStage;
  hook: LifecycleHook;
}

export interface LifecycleHookRunResult {
  blocked: boolean;
  reason?: string;
  annotations: string[];
}

const hooks: RegisteredLifecycleHook[] = [];
const activeSessions = new Map<string, LifecycleHookPayload>();

export function registerLifecycleHook(
  id: string,
  stage: LifecycleHookStage,
  hook: LifecycleHook,
): () => void {
  hooks.push({ id, stage, hook });
  return () => unregisterLifecycleHook(id);
}

export function unregisterLifecycleHook(id: string): void {
  const index = hooks.findIndex((entry) => entry.id === id);
  if (index >= 0) {
    hooks.splice(index, 1);
  }
}

export function clearLifecycleHooks(): void {
  hooks.length = 0;
}

export async function runLifecycleHooks(
  stage: LifecycleHookStage,
  context: GordonContext,
  payload: LifecycleHookPayload = {},
): Promise<LifecycleHookRunResult> {
  const annotations: string[] = [];

  for (const entry of hooks) {
    if (entry.stage !== stage) {
      continue;
    }

    const result = await entry.hook(context, payload);
    if (!result) {
      continue;
    }

    if (result.annotations?.length) {
      annotations.push(...result.annotations);
    }

    if (result.blocked) {
      return {
        blocked: true,
        reason: result.reason ?? `Lifecycle hook ${entry.id} blocked the request.`,
        annotations,
      };
    }
  }

  return {
    blocked: false,
    annotations,
  };
}

export async function startLifecycleSession(
  context: GordonContext,
  payload: LifecycleHookPayload = {},
): Promise<void> {
  const key = context.threadId ?? payload.threadId;
  if (!key || activeSessions.has(key)) {
    return;
  }
  activeSessions.set(key, payload);
  await runLifecycleHooks("session_start", context, {
    ...payload,
    threadId: key,
  });
}

export async function endLifecycleSession(
  context: GordonContext,
  payload: LifecycleHookPayload = {},
): Promise<void> {
  const key = context.threadId ?? payload.threadId;
  if (!key || !activeSessions.has(key)) {
    return;
  }
  activeSessions.delete(key);
  await runLifecycleHooks("session_end", context, {
    ...payload,
    threadId: key,
  });
}

export function clearLifecycleSessions(): void {
  activeSessions.clear();
}
