/**
 * FW7 — Parallel read-only subagent fan-out (orchestrator-worker).
 *
 * The 2026 SOTA multi-agent consensus (Anthropic's research system, Cognition's
 * "don't build multi-agents", reconciled): an orchestrator decomposes a task and
 * spawns ISOLATED, READ-ONLY, ephemeral subagents — each with a fresh context, a
 * self-contained brief, NO peer-to-peer channel and NO shared mutable state — then
 * the orchestrator (single-threaded) synthesizes their returned SUMMARIES. Peer
 * "swarm" designs lost; parallelism is only safe for READ/gather work, never for
 * WRITE/decisions that must cohere.
 *
 * This module is the fan-out + gather layer on top of `dispatchSubagentTask`. It
 * runs N read-only dispatches concurrently under a bounded pool and returns a
 * structured gather. It deliberately does NOT synthesize/decide — that stays with
 * the single orchestrator (Cognition's rule: "actions carry implicit decisions;
 * conflicting decisions carry bad results"). And because it dispatches through
 * `dispatchSubagentTask`, every subagent inherits the hard read-only invariants
 * (execution tools stripped, strict permission mode, bounded turns) — so this can
 * NEVER fan out the trade-execution path. That path stays single-threaded through
 * the executor + risk gate, exactly as the research and Gordon's safety model both
 * require.
 */

import {
  dispatchSubagentTask,
  type DispatchOptions,
  type DispatchResult,
} from "./subagentDispatcher.ts";
import type { SubagentProfile } from "./subagentProfile.ts";

/** Hard ceiling on concurrent subagents — Anthropic's "don't spawn 50" failure-mode guard. */
export const MAX_FANOUT_TASKS = 12;
/** Conservative default concurrency — token cost (~15× chat) is the real gate, so stay modest. */
export const DEFAULT_FANOUT_CONCURRENCY = 4;
/** Upper bound on the concurrency pool, even if the caller asks for more. */
export const MAX_FANOUT_CONCURRENCY = 8;

export interface FanoutTask {
  /** Profile name (the subagent role). */
  role: string;
  /** Self-contained brief — objective + scope. The subagent never sees the parent conversation. */
  task: string;
  /** Optional display label for the gather. */
  label?: string;
}

export interface FanoutOptions extends DispatchOptions {
  /** Concurrency pool size. Clamped to [1, min(MAX_FANOUT_CONCURRENCY, task count)]. */
  concurrency?: number;
}

export interface FanoutItem {
  index: number;
  role: string;
  label?: string;
  result: DispatchResult;
}

export interface FanoutReport {
  /** Tasks actually dispatched (after the MAX_FANOUT_TASKS cap). */
  total: number;
  /** Tasks dropped by the cap — surfaced, never silently truncated. */
  dropped: number;
  completed: number;
  failed: number;
  refused: number;
  disabled: number;
  /** The concurrency pool size actually used. */
  concurrency: number;
  /** Per-task results, in original task order. */
  items: FanoutItem[];
  /** Summed token usage across completed subagents. */
  usage: { inputTokens: number; outputTokens: number };
  /**
   * A structured READ-ONLY gather of the subagents' returned summaries, for the
   * orchestrator to synthesize. This is a digest, NOT a decision.
   */
  digest: string;
}

function refusedUnknownRole(role: string, profiles: ReadonlyMap<string, SubagentProfile>): DispatchResult {
  const available = [...profiles.keys()].join(", ");
  const summary = `Unknown role '${role}'. Available: ${available || "(none)"}`;
  return {
    status: "refused",
    subagentId: "n/a",
    toolFilter: { allowed: [], unmatched: [], blocked: [] },
    notification: summary,
    error: summary,
  };
}

function failedResult(err: unknown): DispatchResult {
  const msg = err instanceof Error ? err.message : String(err);
  return {
    status: "failed",
    subagentId: "n/a",
    toolFilter: { allowed: [], unmatched: [], blocked: [] },
    notification: `Dispatch threw: ${msg}`,
    error: msg,
  };
}

function buildDigest(items: FanoutItem[], dropped: number): string {
  const lines: string[] = [];
  const completed = items.filter((it) => it.result.status === "completed").length;
  let header = `Parallel research gather — ${items.length} task(s), ${completed} completed`;
  if (dropped > 0) header += `, ${dropped} dropped by the ${MAX_FANOUT_TASKS}-task cap`;
  lines.push(`${header}. (Read-only gather — synthesize/decide yourself; the subagents could not.)`);
  for (const it of items) {
    const tag = it.label ? `${it.role}/${it.label}` : it.role;
    const r = it.result;
    const body =
      r.status === "completed"
        ? (r.text ?? "(no text returned)")
        : `[${r.status}] ${r.error ?? "no detail"}`;
    lines.push(`[${it.index + 1}] ${tag} — ${body}`);
  }
  return lines.join("\n");
}

/**
 * Fan out N read-only subagent tasks concurrently and gather their summaries.
 * Never throws: an unknown role, a refused/disabled dispatch, or an unexpected
 * throw all land as a per-item result so one bad task can't sink the batch.
 */
export async function fanoutSubagentTasks(
  profiles: ReadonlyMap<string, SubagentProfile>,
  tasks: FanoutTask[],
  toolRegistry: Record<string, unknown>,
  options: FanoutOptions = {},
): Promise<FanoutReport> {
  const capped = tasks.slice(0, MAX_FANOUT_TASKS);
  const dropped = tasks.length - capped.length;
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? DEFAULT_FANOUT_CONCURRENCY, MAX_FANOUT_CONCURRENCY, capped.length || 1),
  );

  const items = new Array<FanoutItem>(capped.length);
  const dispatchOne = async (t: FanoutTask, i: number): Promise<void> => {
    const profile = profiles.get(t.role);
    let result: DispatchResult;
    if (!profile) {
      result = refusedUnknownRole(t.role, profiles);
    } else {
      try {
        result = await dispatchSubagentTask(profile, t.task, toolRegistry, options);
      } catch (err) {
        result = failedResult(err);
      }
    }
    items[i] = { index: i, role: t.role, label: t.label, result };
  };

  // Bounded worker pool — pull the next index until the queue drains.
  let next = 0;
  const workers = Array.from({ length: concurrency }, async () => {
    for (let i = next++; i < capped.length; i = next++) {
      await dispatchOne(capped[i]!, i);
    }
  });
  await Promise.all(workers);

  const report: FanoutReport = {
    total: capped.length,
    dropped,
    completed: 0,
    failed: 0,
    refused: 0,
    disabled: 0,
    concurrency,
    items,
    usage: { inputTokens: 0, outputTokens: 0 },
    digest: "",
  };
  for (const it of items) {
    report[it.result.status] += 1;
    if (it.result.usage) {
      report.usage.inputTokens += it.result.usage.inputTokens ?? 0;
      report.usage.outputTokens += it.result.usage.outputTokens ?? 0;
    }
  }
  report.digest = buildDigest(items, dropped);
  return report;
}
