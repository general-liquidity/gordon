/**
 * Sub-agent steering — queued mid-flight messages for in-flight subagents.
 *
 * Gordon's read-only fan-out subagents are dispatched run-to-completion via a
 * single Mastra `agent.generate(task, { maxSteps })` call (see
 * `subagentDispatcher.ts`). Mastra's `.generate()` is a black box: it owns the
 * internal LLM↔tool step loop and exposes no per-step injection hook, so
 * arbitrary mid-`generate()` injection is not possible WITHOUT rewriting the
 * dispatcher into a manual step loop. That rewrite is explicitly out of scope —
 * it would change run-to-completion behavior for every caller.
 *
 * This module is the additive, byte-identical-for-non-steerers alternative: a
 * process-local queue of pending steer messages keyed by subagentId, plus a
 * delivery boundary the dispatcher consumes at SPAWN-STEP time (when it builds
 * the task brief, before invoking `.generate()`). A steer sent while a subagent
 * is `running` is buffered and delivered at the next natural spawn-step the
 * dispatcher reaches for that id — which, for a single run-to-completion
 * dispatch, means it is woven into the brief if it arrives before dispatch, and
 * is otherwise surfaced to the registry/operator as "delivered: deferred" so the
 * caller can re-dispatch with the steer applied. No silent drops.
 *
 * ── HARD SAFETY INVARIANT ──────────────────────────────────────────────────
 * Steering NEVER grants new powers. A steer message is plain text appended to a
 * subagent's INPUT brief — it flows through the EXACT same read-only tool
 * filter, strict permission mode, and bounded-turn ceiling that the dispatcher
 * already enforces. It cannot add tools, change permission mode, or escalate
 * scope. The dispatcher's safety preamble still wins. This module holds text; it
 * has no authority of its own.
 *
 * Process-singleton, in-memory only. Mirrors the `interruptQueue` design (the
 * orchestrator-level sibling of this subagent-level queue) and the
 * `AgentRegistry` lifetime — process restart wipes it; persistent tracking is
 * the audit log's job, not this.
 */

import { createModuleLogger } from "../../logger/index.ts";
import { getDefaultAgentRegistry, type AgentRegistry } from "./subagentCoordination.ts";

const logger = createModuleLogger("subagent-steer");

/** Bound per-subagent queue depth so a hammered steer can't grow unbounded. */
export const MAX_STEER_DEPTH = 8;

/** Prefix stamped on delivered steer text so the subagent recognizes it as an
 *  operator interjection (mirrors interruptQueue's `[INTERRUPT]`). */
export const STEER_PREFIX = "[STEER]";

export interface SteerResult {
  /** Whether the steer was accepted into a queue. */
  queued: boolean;
  /**
   * Why the steer did/didn't queue:
   *  - "queued"        — buffered for the subagent's next spawn-step
   *  - "unknown"       — no such subagent id (safe no-op)
   *  - "terminal"      — subagent already completed/failed/aborted (safe no-op)
   *  - "evicted"       — queued, but the oldest message was dropped (depth cap)
   */
  reason: "queued" | "unknown" | "terminal" | "evicted";
  /** Current queue depth for this subagent after the operation. */
  depth: number;
}

/**
 * Process-local steer store. One queue per subagentId. Entries are plain steer
 * strings (already prefixed). Drained by the dispatcher at spawn-step.
 */
class SubagentSteerStore {
  private readonly queues = new Map<string, string[]>();

  constructor(private readonly registry: AgentRegistry) {}

  /**
   * Enqueue a steer message for an in-flight subagent.
   *
   * Safe no-op (returns `queued: false`) when:
   *   - the subagent id is unknown (never registered / pruned), or
   *   - the subagent is already in a terminal state.
   * This is what makes "steer a finished/unknown task" harmless — the contract
   * the task spec requires.
   */
  steer(subagentId: string, message: string): SteerResult {
    const trimmed = (message ?? "").trim();
    if (trimmed.length === 0) {
      const depth = this.queues.get(subagentId)?.length ?? 0;
      return { queued: false, reason: "unknown", depth };
    }

    const entry = this.registry.get(subagentId);
    if (!entry) {
      logger.debug("Steer dropped — unknown subagent", { subagentId });
      return { queued: false, reason: "unknown", depth: 0 };
    }
    if (entry.state === "completed" || entry.state === "failed" || entry.state === "aborted") {
      logger.debug("Steer dropped — subagent terminal", {
        subagentId,
        state: entry.state,
      });
      return { queued: false, reason: "terminal", depth: 0 };
    }

    const queue = this.queues.get(subagentId) ?? [];
    const payload = `${STEER_PREFIX} ${trimmed}`;
    const evicted = queue.length >= MAX_STEER_DEPTH;
    if (evicted) queue.shift();
    queue.push(payload);
    this.queues.set(subagentId, queue);
    logger.info("Steer queued for subagent", {
      subagentId,
      depth: queue.length,
      evicted,
    });
    return {
      queued: true,
      reason: evicted ? "evicted" : "queued",
      depth: queue.length,
    };
  }

  /**
   * Drain all pending steers for a subagent, clearing its queue. Called by the
   * dispatcher at spawn-step. Returns `[]` when nothing is pending so the hot
   * path stays free (no allocation for the common no-steer case).
   */
  drain(subagentId: string): string[] {
    const queue = this.queues.get(subagentId);
    if (!queue || queue.length === 0) return [];
    this.queues.delete(subagentId);
    logger.info("Steer queue drained for subagent", {
      subagentId,
      count: queue.length,
    });
    return queue;
  }

  /** Peek without draining — for status displays. Read-only. */
  peek(subagentId: string): readonly string[] {
    return Object.freeze([...(this.queues.get(subagentId) ?? [])]);
  }

  /** Current pending depth for a subagent. Cheap O(1). */
  depth(subagentId: string): number {
    return this.queues.get(subagentId)?.length ?? 0;
  }

  /** Drop a subagent's queue entirely — called when its dispatch finishes so a
   *  late steer for a now-terminal id doesn't linger. */
  clear(subagentId: string): void {
    this.queues.delete(subagentId);
  }

  /** Test-only — wipe every queue. */
  clearAll(): void {
    this.queues.clear();
  }
}

// Singleton bound to the default AgentRegistry. Tests can construct their own
// store with an injected registry via `createSteerStore`.
let defaultStore: SubagentSteerStore | undefined;

function getStore(): SubagentSteerStore {
  if (!defaultStore) {
    defaultStore = new SubagentSteerStore(getDefaultAgentRegistry());
  }
  return defaultStore;
}

/**
 * Construct a steer store over an explicit registry. Used by tests so they can
 * drive registry state deterministically without touching the process
 * singleton.
 */
export function createSteerStore(registry: AgentRegistry): SubagentSteerStore {
  return new SubagentSteerStore(registry);
}

export type { SubagentSteerStore };

// ── Module-level convenience API (delegates to the singleton) ───────────────

/**
 * Send a steer message to a running subagent by id. The message is buffered and
 * delivered to the subagent at its next spawn-step (when the dispatcher builds
 * its brief). Steering an unknown or already-finished subagent is a safe no-op.
 *
 * Returns a structured result so callers (and the steer tool) can report
 * accurately whether the message landed.
 */
export function steerSubagent(subagentId: string, message: string): SteerResult {
  return getStore().steer(subagentId, message);
}

/** Drain pending steers for a subagent at spawn-step. Dispatcher-internal. */
export function drainSteers(subagentId: string): string[] {
  return getStore().drain(subagentId);
}

/** Peek at pending steers without draining. */
export function peekSteers(subagentId: string): readonly string[] {
  return getStore().peek(subagentId);
}

/** Pending steer depth for a subagent. */
export function steerDepth(subagentId: string): number {
  return getStore().depth(subagentId);
}

/** Clear a subagent's steer queue (dispatcher cleanup on completion). */
export function clearSteers(subagentId: string): void {
  getStore().clear(subagentId);
}

/** Test-only — reset the singleton + all queues. */
export function _resetSteersForTests(): void {
  defaultStore = undefined;
}

// ── Dispatcher integration helpers ──────────────────────────────────────────

/**
 * Spawn-step delivery. Drain any steers queued for `subagentId` and weave them
 * into the task brief BEFORE `.generate()` runs. Returns `task` UNCHANGED (same
 * string) when nothing is queued, so a non-steered dispatch is byte-identical to
 * prior behavior. Uses `store` when one is injected (tests); otherwise the
 * process singleton. Each drained entry already carries `STEER_PREFIX` and flows
 * through the dispatcher's existing read-only filter + strict mode — it grants
 * no new powers, it only appends operator text to the input brief.
 */
export function applyQueuedSteers(
  task: string,
  subagentId: string,
  store?: SubagentSteerStore,
): string {
  const pending = store ? store.drain(subagentId) : drainSteers(subagentId);
  if (pending.length === 0) return task;
  return `${task}\n\n${pending.join("\n")}`;
}

/**
 * Dispatch cleanup. Drop any lingering steer queue for a now-terminal subagent
 * so a late steer for a finished id doesn't linger. Idempotent / safe no-op.
 */
export function finalizeSteers(subagentId: string, store?: SubagentSteerStore): void {
  if (store) store.clear(subagentId);
  else clearSteers(subagentId);
}
