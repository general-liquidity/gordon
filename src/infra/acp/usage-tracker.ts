/**
 * Token-usage emitter — sends ACP `usage_update` notifications so the
 * editor can show cumulative token spend per session.
 *
 * Gordon's LLM client already tracks input/output tokens per call (see
 * `LLMResponse.usage` in `ai/llm/types.ts`). In ACP mode, those numbers
 * are surfaced to the editor at turn boundaries — operators get the
 * same cost transparency in Zed as they do via the cost-tracker
 * daily-budget event stream.
 *
 * Schema per the ACP `usage_update` sessionUpdate:
 *   - usage: {
 *       promptTokens: number,
 *       completionTokens: number,
 *       totalTokens: number,
 *       costUsd?: number  (cents-precision OK; Gordon emits when known)
 *     }
 *
 * The tracker is stateful PER SESSION — accumulates across turns within
 * the same sessionId, resets on newSession.
 */

import type { AgentSideConnection } from "@agentclientprotocol/sdk";

export interface UsageDelta {
  promptTokens: number;
  completionTokens: number;
  totalTokens?: number;
  costUsd?: number;
}

interface SessionUsageState {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

const sessions = new Map<string, SessionUsageState>();

/**
 * Reset usage tracking for a session — called on newSession.
 */
export function resetSessionUsage(sessionId: string): void {
  sessions.set(sessionId, {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
    costUsd: 0,
  });
}

/**
 * Drop a session's usage state — called on session-close (future).
 */
export function dropSessionUsage(sessionId: string): void {
  sessions.delete(sessionId);
}

/**
 * Get the running totals for a session — for inspection / tests.
 */
export function getSessionUsage(sessionId: string): SessionUsageState | null {
  return sessions.get(sessionId) ?? null;
}

/**
 * Accumulate a usage delta into the session totals + emit a
 * `usage_update` notification to the editor.
 *
 * Called at the end of each prompt turn with the delta accumulated
 * during that turn. The editor sees cumulative-across-turns counts
 * because Gordon tracks the running total per session.
 *
 * Cost in USD is optional (some providers don't return per-call cost);
 * when present, it's added to the running total. When absent, the
 * accumulated cost stays unchanged.
 */
export async function emitUsageUpdate(
  connection: AgentSideConnection,
  sessionId: string,
  delta: UsageDelta,
): Promise<void> {
  let state = sessions.get(sessionId);
  if (!state) {
    resetSessionUsage(sessionId);
    state = sessions.get(sessionId)!;
  }
  state.promptTokens += delta.promptTokens;
  state.completionTokens += delta.completionTokens;
  state.totalTokens += delta.totalTokens ?? delta.promptTokens + delta.completionTokens;
  if (typeof delta.costUsd === "number") state.costUsd += delta.costUsd;

  // The ACP usage_update schema is intentionally flexible — we send the
  // cumulative session-scoped numbers so the editor can render
  // "session total" without doing its own accumulation.
  await connection.sessionUpdate({
    sessionId,
    update: {
      sessionUpdate: "usage_update",
      usage: {
        promptTokens: state.promptTokens,
        completionTokens: state.completionTokens,
        totalTokens: state.totalTokens,
        ...(state.costUsd > 0 ? { costUsd: state.costUsd } : {}),
      },
    } as unknown as Parameters<AgentSideConnection["sessionUpdate"]>[0]["update"],
  });
}
