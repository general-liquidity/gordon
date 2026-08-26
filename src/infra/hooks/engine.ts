/**
 * Hooks Engine
 *
 * Central registry + dispatch for Gordon's lifecycle hooks. Hooks run
 * serially (sorted by priority) at each hook point. If any hook returns
 * `block`, execution halts and the reason is surfaced to the caller.
 *
 * Two execution modes per hook:
 *   - default sync     : awaited in priority order; first block stops the chain.
 *   - asyncRewake=true : kicked off in parallel with other rewake hooks at the
 *                       same point, then their results awaited at the end.
 *                       A failing rewake hook still produces a `block` decision
 *                       (so compliance / audit gates don't lose teeth) but
 *                       parallel execution keeps the wall-clock cost bounded
 *                       to the slowest hook rather than the sum.
 *
 * Per-hook `statusMessage` is emitted via the optional listener registered
 * with `setHookStatusListener` so TUIs / loggers can surface progress.
 *
 * Usage:
 *   registerHook({ point: "PreToolUse", id: "my-limit", handler: ... })
 *   const decision = await runHooks("PreToolUse", payload);
 *   if (decision.action === "block") throw ...
 */

import type {
  HookDefinition,
  HookPoint,
  HookPayloadMap,
  HookResult,
  HookHandler,
} from "./types.ts";

// ============================================================================
// statusMessage listener — TUIs subscribe here to surface progress text
// while a hook with `statusMessage` is running.
// ============================================================================

export interface HookStatusEvent {
  hookId: string;
  point: HookPoint;
  message: string;
  /** "start" when the hook begins; "end" when it completes (success or fail). */
  phase: "start" | "end";
}

let statusListener: ((event: HookStatusEvent) => void) | null = null;

/**
 * Register a listener for hook statusMessage events. Pass `null` to clear.
 * Only one listener at a time — the TUI bridge owns this.
 */
export function setHookStatusListener(listener: ((event: HookStatusEvent) => void) | null): void {
  statusListener = listener;
}

function emitStatus(point: HookPoint, def: HookDefinition, phase: "start" | "end"): void {
  if (!statusListener || !def.statusMessage) return;
  try {
    statusListener({ hookId: def.id, point, message: def.statusMessage, phase });
  } catch {
    // Never let a listener throw take down the engine.
  }
}

interface RegistryEntry {
  definition: HookDefinition;
}

const registry = new Map<HookPoint, RegistryEntry[]>();

function sortEntries(entries: RegistryEntry[]): void {
  entries.sort((a, b) => (a.definition.priority ?? 100) - (b.definition.priority ?? 100));
}

function matchesToolFilter(filter: string | RegExp | undefined, toolName: string | undefined): boolean {
  if (!filter) return true;
  if (!toolName) return true;
  if (filter instanceof RegExp) return filter.test(toolName);
  // Glob support: "*" wildcards. Fall back to substring match for safety.
  if (filter.includes("*")) {
    const re = new RegExp("^" + filter.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*") + "$");
    return re.test(toolName);
  }
  return filter === toolName;
}

/** Register a new hook. Returns an unregister function. */
export function registerHook<P extends HookPoint>(def: HookDefinition<P>): () => void {
  const list = registry.get(def.point) ?? [];
  list.push({ definition: def as unknown as HookDefinition });
  sortEntries(list);
  registry.set(def.point, list);
  return () => unregisterHook(def.id);
}

/** Unregister a hook by its id. Returns true if removed. */
export function unregisterHook(id: string): boolean {
  let removed = false;
  for (const [point, entries] of registry.entries()) {
    const filtered = entries.filter((e) => e.definition.id !== id);
    if (filtered.length !== entries.length) {
      registry.set(point, filtered);
      removed = true;
    }
  }
  return removed;
}

/** List hooks registered at a given point (or all if omitted). */
export function listHooks(point?: HookPoint): HookDefinition[] {
  if (point) return (registry.get(point) ?? []).map((e) => e.definition);
  const all: HookDefinition[] = [];
  for (const entries of registry.values()) {
    for (const e of entries) all.push(e.definition);
  }
  return all;
}

export function clearHooks(point?: HookPoint): void {
  if (point) registry.delete(point);
  else registry.clear();
}

/**
 * Run all hooks for a point. Halts on first block from sync hooks; threads
 * modifications through sequentially for modify actions. Async-rewake hooks
 * run in parallel and are awaited after the sync chain — their block
 * decisions still surface even though they don't gate sync hooks.
 */
export async function runHooks<P extends HookPoint>(
  point: P,
  payload: HookPayloadMap[P],
): Promise<HookResult> {
  const entries = registry.get(point) ?? [];
  if (entries.length === 0) return { action: "allow" };

  let currentPayload: HookPayloadMap[P] = payload;

  // Determine which tool name to match (for tool-scoped filters)
  const toolName = (payload as { toolName?: string }).toolName;

  // Pass 1: kick off async-rewake hooks in parallel. We capture the
  // payload that exists *before* the sync chain runs — rewake hooks can't
  // observe sync-hook modifications. That keeps the parallel branch
  // deterministic regardless of sync-hook ordering.
  const rewakePromises: Array<{ def: HookDefinition; promise: Promise<HookResult> }> = [];
  const rewakePayload = currentPayload;
  for (const entry of entries) {
    const def = entry.definition;
    if (!def.asyncRewake) continue;
    if ((def.point === "PreToolUse" || def.point === "PostToolUse") && !matchesToolFilter(def.toolFilter, toolName)) {
      continue;
    }
    emitStatus(point, def, "start");
    const handler = def.handler as HookHandler<P>;
    const promise = (async () => {
      try {
        return await Promise.resolve(handler(rewakePayload));
      } catch (err) {
        console.error(`[hooks] ${def.id} (asyncRewake) threw at ${point}:`, err);
        // Fail closed. A rewake hook is documented as a compliance / audit
        // gate, so an unreachable or crashing one must not silently allow.
        return {
          action: "block",
          reason: `asyncRewake hook failed: ${err instanceof Error ? err.message : String(err)}`,
        } as HookResult;
      } finally {
        emitStatus(point, def, "end");
      }
    })();
    rewakePromises.push({ def, promise });
  }

  // Pass 2: sync hooks in priority order. First block stops the sync chain.
  for (const entry of entries) {
    const def = entry.definition;
    if (def.asyncRewake) continue;
    if ((def.point === "PreToolUse" || def.point === "PostToolUse") && !matchesToolFilter(def.toolFilter, toolName)) {
      continue;
    }

    emitStatus(point, def, "start");
    try {
      const handler = def.handler as HookHandler<P>;
      const result = await Promise.resolve(handler(currentPayload));

      if (result.action === "block") {
        // Still wait for async-rewake hooks before returning so their
        // statusMessage end-events fire and so we don't leave dangling
        // promises that error on unhandled rejection. Their decisions
        // are discarded — sync block already wins.
        await Promise.allSettled(rewakePromises.map((r) => r.promise));
        return {
          action: "block",
          reason: `${def.id}: ${result.reason ?? "blocked"}`,
          metadata: result.metadata,
        };
      }

      if (result.action === "modify" && result.replacement !== undefined) {
        // Shallow merge — each hook can modify any field.
        currentPayload = { ...currentPayload, ...(result.replacement as object) } as HookPayloadMap[P];
      }
    } catch (err) {
      // Hook errors must not crash the agent loop; log and continue.
      console.error(`[hooks] ${def.id} threw at ${point}:`, err);
    } finally {
      emitStatus(point, def, "end");
    }
  }

  // Pass 3: await async-rewake hooks. Any block surfaces.
  for (const { def, promise } of rewakePromises) {
    const result = await promise;
    if (result.action === "block") {
      return {
        action: "block",
        reason: `${def.id} (asyncRewake): ${result.reason ?? "blocked"}`,
        metadata: result.metadata,
      };
    }
  }

  return { action: "allow", metadata: { finalPayload: currentPayload } };
}

/** Synchronous convenience — fires-and-forgets without blocking. */
export function emitHook<P extends HookPoint>(point: P, payload: HookPayloadMap[P]): void {
  runHooks(point, payload).catch((err) => {
    console.error(`[hooks] emit ${point} failed:`, err);
  });
}
