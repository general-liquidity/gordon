/**
 * Hooks Engine
 *
 * Central registry + dispatch for Gordon's lifecycle hooks. Hooks run
 * serially (sorted by priority) at each hook point. If any hook returns
 * `block`, execution halts and the reason is surfaced to the caller.
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
  list.push({ definition: def as HookDefinition });
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
 * Run all hooks for a point. Halts on first block; threads modifications
 * through sequentially for modify actions.
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

  for (const entry of entries) {
    const def = entry.definition;
    if ((def.point === "PreToolUse" || def.point === "PostToolUse") && !matchesToolFilter(def.toolFilter, toolName)) {
      continue;
    }

    try {
      const handler = def.handler as HookHandler<P>;
      const result = await Promise.resolve(handler(currentPayload));

      if (result.action === "block") {
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
