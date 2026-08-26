import { randomUUID } from "node:crypto";

import { runHooks } from "./engine.ts";

interface ActiveSubagent {
  id: string;
  key: string;
  type: string;
  parent?: string;
  startedAt: number;
}

const active = new Map<string, ActiveSubagent>();

export async function beginSubagentHook(input: {
  key: string;
  id?: string;
  type: string;
  parent?: string;
  task?: string;
}): Promise<{ allowed: boolean; reason?: string; id: string }> {
  const existing = active.get(input.key);
  if (existing) return { allowed: true, id: existing.id };
  const run: ActiveSubagent = {
    id: input.id ?? randomUUID(),
    key: input.key,
    type: input.type,
    parent: input.parent,
    startedAt: Date.now(),
  };
  const result = await runHooks("SubagentStart", {
    subagentId: run.id,
    subagentType: run.type,
    parentAgent: run.parent,
    task: input.task,
    startedAt: run.startedAt,
  });
  if (result.action === "block") {
    return { allowed: false, reason: result.reason ?? "Subagent start blocked by lifecycle hook.", id: run.id };
  }
  active.set(input.key, run);
  return { allowed: true, id: run.id };
}

export async function endSubagentHook(input: {
  key: string;
  type: string;
  parent?: string;
  status: "completed" | "failed" | "aborted" | "timeout";
  result?: unknown;
  error?: string;
  tokensUsed?: { input?: number; output?: number; total?: number };
}): Promise<void> {
  const stoppedAt = Date.now();
  const run = active.get(input.key);
  if (!run) return;
  active.delete(input.key);
  const hookResult = await runHooks("SubagentStop", {
    subagentId: run.id,
    subagentType: run.type,
    parentAgent: run.parent,
    stoppedAt,
    status: input.status,
    durationMs: Math.max(0, stoppedAt - run.startedAt),
    result: input.result,
    error: input.error,
    tokensUsed: input.tokensUsed,
  });
  if (hookResult.action === "block") {
    // A stop observation cannot undo a subagent run that already ended, but a
    // failed audit/compliance sink must remain operationally visible.
    console.error(`[hooks] SubagentStop blocked: ${hookResult.reason ?? "blocked"}`);
  }
}

export function resetSubagentHookBridgeForTests(): void {
  active.clear();
}
