/**
 * Memory Gate — Hermes hot-tier discipline applied to Mastra Memory.
 *
 * Two policy layers, both additive (never breaking) on top of Mastra:
 *
 *   1. Hot-tier char cap. Working-memory writes are truncated to
 *      MAX_WORKING_MEMORY_CHARS (2200, matching Hermes's MEMORY.md cap).
 *      The cap protects the always-injected hot tier from unbounded
 *      growth — the failure mode the "Reverse-Engineering Memory"
 *      article calls out as the ChatGPT-style "always inject" trap.
 *
 *   2. Optional session-boundary defer. When GORDON_DEFER_WORKING_MEMORY
 *      is set, mid-session writes go to an in-memory buffer keyed by
 *      thread+resource instead of hitting disk + cache-busting the
 *      injected prompt. The buffer is flushed via
 *      `flushDeferredWorkingMemoryWrites(memory)` at a natural rebuild
 *      point (session end, post-compression). Hermes principle:
 *      "writes go to disk immediately, but the prompt stays stable
 *      until a natural rebuild point."
 *
 * Both apply via `wrapMemoryWithGate(mem)` which monkey-patches
 * `updateWorkingMemory` on the Memory instance. Read paths are
 * untouched.
 */

import type { Memory } from "@mastra/memory";
import { createModuleLogger } from "../logger/logger.ts";

const logger = createModuleLogger("memory-gate");

/**
 * Hot-tier cap. Hermes's MEMORY.md=2200 + USER.md=1375 (~1300 tokens)
 * showed that durable trader-profile context fits comfortably in this
 * range. Anything that doesn't is session state masquerading as profile.
 */
export const MAX_WORKING_MEMORY_CHARS = 2200;

const TRUNCATION_MARKER = "\n[...truncated to hot-tier cap]";
const DEFER_FLAG_ENV = "GORDON_DEFER_WORKING_MEMORY";

interface UpdateWorkingMemoryParams {
  threadId: string;
  resourceId: string;
  workingMemory: string;
  memoryConfig?: unknown;
}

type UpdateWorkingMemoryFn = (params: UpdateWorkingMemoryParams) => Promise<void>;

interface DeferredWrite {
  params: UpdateWorkingMemoryParams;
  enqueuedAt: number;
}

const _pendingByMemory = new WeakMap<Memory, Map<string, DeferredWrite>>();
const _originalByMemory = new WeakMap<Memory, UpdateWorkingMemoryFn>();

export function isDeferralEnabled(): boolean {
  return process.env[DEFER_FLAG_ENV] === "1";
}

export function truncateWorkingMemoryValue(value: string): string {
  if (value.length <= MAX_WORKING_MEMORY_CHARS) return value;
  const room = MAX_WORKING_MEMORY_CHARS - TRUNCATION_MARKER.length;
  return value.slice(0, room) + TRUNCATION_MARKER;
}

function bufferKey(params: UpdateWorkingMemoryParams): string {
  return `${params.threadId}::${params.resourceId}`;
}

export interface MemoryGateOptions {
  /** Override the env-driven defer mode (mainly for tests). */
  defer?: boolean;
}

/**
 * Wrap a Memory instance with the gate. Idempotent: calling twice on
 * the same instance is a no-op (the original method is recorded once).
 */
export function wrapMemoryWithGate<M extends Memory>(
  memory: M,
  options: MemoryGateOptions = {},
): M {
  if (_originalByMemory.has(memory)) return memory;
  const proto = memory as unknown as {
    updateWorkingMemory: UpdateWorkingMemoryFn;
  };
  if (typeof proto.updateWorkingMemory !== "function") {
    logger.debug("Memory has no updateWorkingMemory — gate is a no-op", {});
    return memory;
  }
  const original = proto.updateWorkingMemory.bind(memory);
  _originalByMemory.set(memory, original);

  proto.updateWorkingMemory = async (params) => {
    const truncatedValue = truncateWorkingMemoryValue(params.workingMemory);
    const finalParams: UpdateWorkingMemoryParams = {
      ...params,
      workingMemory: truncatedValue,
    };

    const defer = options.defer ?? isDeferralEnabled();
    if (defer) {
      let buffer = _pendingByMemory.get(memory);
      if (!buffer) {
        buffer = new Map();
        _pendingByMemory.set(memory, buffer);
      }
      buffer.set(bufferKey(finalParams), {
        params: finalParams,
        enqueuedAt: Date.now(),
      });
      logger.debug("Deferred working-memory write", {
        threadId: finalParams.threadId,
        bytes: truncatedValue.length,
      });
      return;
    }

    if (truncatedValue.length < params.workingMemory.length) {
      logger.info("Working memory truncated on write", {
        threadId: params.threadId,
        from: params.workingMemory.length,
        to: truncatedValue.length,
      });
    }
    return original(finalParams);
  };

  return memory;
}

/**
 * Apply all buffered writes for a Memory instance, last-write-wins per
 * thread+resource key. Returns the number of writes flushed.
 *
 * Call at session boundaries: explicit `/clear`, compaction completion,
 * thread close. Never mid-turn — that defeats the purpose.
 */
export async function flushDeferredWorkingMemoryWrites(
  memory: Memory,
): Promise<number> {
  const buffer = _pendingByMemory.get(memory);
  if (!buffer || buffer.size === 0) return 0;
  const original = _originalByMemory.get(memory);
  if (!original) return 0;

  const writes = Array.from(buffer.values()).sort(
    (a, b) => a.enqueuedAt - b.enqueuedAt,
  );
  buffer.clear();

  let flushed = 0;
  for (const w of writes) {
    try {
      await original(w.params);
      flushed += 1;
    } catch (err) {
      logger.warn("Deferred working-memory flush entry failed", {
        threadId: w.params.threadId,
        err: err instanceof Error ? err.message : String(err),
      });
    }
  }
  logger.info("Flushed deferred working-memory writes", { count: flushed });
  return flushed;
}

/**
 * Discard all buffered writes without applying. Used when a session is
 * abandoned (`/clear` with no save) or after a hard reset.
 */
export function discardDeferredWorkingMemoryWrites(memory: Memory): number {
  const buffer = _pendingByMemory.get(memory);
  if (!buffer) return 0;
  const count = buffer.size;
  buffer.clear();
  return count;
}

/**
 * Read-only inspector for /context or debug surfaces. Returns the
 * currently-buffered writes sorted oldest-first.
 */
export function inspectDeferredWorkingMemory(
  memory: Memory,
): ReadonlyArray<{ threadId: string; resourceId: string; bytes: number; ageMs: number }> {
  const buffer = _pendingByMemory.get(memory);
  if (!buffer) return [];
  const now = Date.now();
  return Array.from(buffer.values())
    .sort((a, b) => a.enqueuedAt - b.enqueuedAt)
    .map((w) => ({
      threadId: w.params.threadId,
      resourceId: w.params.resourceId,
      bytes: w.params.workingMemory.length,
      ageMs: now - w.enqueuedAt,
    }));
}

/** Test helper — unwrap and clear buffers for a memory instance. */
export function _resetMemoryGateForTests(memory: Memory): void {
  const original = _originalByMemory.get(memory);
  if (original) {
    (memory as unknown as { updateWorkingMemory: UpdateWorkingMemoryFn }).updateWorkingMemory =
      original;
    _originalByMemory.delete(memory);
  }
  _pendingByMemory.delete(memory);
}
