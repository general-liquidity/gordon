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
import { createModuleLogger } from "../../logger/logger.ts";

const logger = createModuleLogger("memory-gate");

/**
 * Hot-tier cap. Hermes's MEMORY.md=2200 + USER.md=1375 (~1300 tokens)
 * showed that durable trader-profile context fits comfortably in this
 * range. Anything that doesn't is session state masquerading as profile.
 */
export const MAX_WORKING_MEMORY_CHARS = 2200;

const TRUNCATION_MARKER = "\n[...truncated to hot-tier cap]";
const DEFER_FLAG_ENV = "GORDON_DEFER_WORKING_MEMORY";

/**
 * Sensitive working-memory field markers. When a write changes content under
 * any of these field labels, we log a structured warning so the user can
 * audit whether the change was intentional. This is detection, not
 * blocking — false positives would break legitimate user-driven updates
 * ("I'm switching to Coinbase"). The signal is most useful when reviewing
 * the audit log for sessions where the agent ingested untrusted content
 * (news, MCP outputs) that could have triggered an unsolicited update.
 *
 * Borrowed from the "Building Real-World Agents" pillar 2 prescription:
 * detect state poisoning by watching for changes to high-trust fields.
 */
const SENSITIVE_FIELD_MARKERS: readonly string[] = [
  "Max Risk Per Trade",
  "Max Portfolio Allocation Per Position",
  "Risk Tolerance",
  "Default Execution Venue",
  "Account Type",
  "Base Currency",
  "Primary Market Focus",
];

/**
 * Patterns the content of an update SHOULD NOT match. Adversarial
 * prompt-injection payloads frequently include classic markers ("ignore
 * prior instructions", "system:", new email addresses appearing under
 * fields that weren't email-shaped). Defensive: log + flag, never block.
 */
const SUSPICIOUS_PATTERNS: ReadonlyArray<{ name: string; pattern: RegExp }> = [
  { name: "ignore-instructions", pattern: /ignore (prior|previous|all) instructions/i },
  { name: "embedded-system-role", pattern: /\bsystem\s*:\s*you (are|must)/i },
  { name: "unexpected-email", pattern: /\b[a-zA-Z0-9._%+-]+@(?!gmail\.com|outlook\.com|icloud\.com|protonmail\.com|hotmail\.com|yahoo\.com)[a-zA-Z0-9.-]+\.(xyz|top|tk|click|pw)\b/ },
];

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

/**
 * Last-seen working-memory value per (Memory, threadId, resourceId) key.
 * Used to diff incoming writes against the prior state so the gate can
 * detect sensitive-field changes. Kept in-process only — survives across
 * writes within a session, resets on process restart.
 */
const _lastWorkingMemoryByKey = new WeakMap<Memory, Map<string, string>>();

/**
 * Per-key provenance — the source of the last write. Default for all
 * Mastra-mediated writes is "llm_assertion" since the LLM's auto-injected
 * updateWorkingMemory tool doesn't carry source context. Higher-level
 * callers (setup wizard, explicit user commands) can call
 * `recordTrustedProvenance()` BEFORE their write to mark it as trusted.
 *
 * This is documentation-as-infrastructure: it declares that LLM-driven
 * writes are untrusted by default. The actual privilege boundary would
 * require patching Mastra to inject source on every call — that's a
 * follow-up. For now, the provenance map drives logging only.
 */
export type ProvenanceSource =
  | "llm_assertion"
  | "user_verified"
  | "system_init"
  | "oauth"
  | "setup_wizard"
  | "explicit_command";

const TRUSTED_SOURCES: ReadonlySet<ProvenanceSource> = new Set([
  "user_verified",
  "system_init",
  "oauth",
  "setup_wizard",
  "explicit_command",
]);

const _provenanceByKey = new WeakMap<Memory, Map<string, ProvenanceSource>>();
const _pendingTrustedWrite = new WeakMap<Memory, Map<string, ProvenanceSource>>();

/**
 * Mark the NEXT write to (memory, threadId, resourceId) as coming from
 * a trusted source. Must be called immediately before the corresponding
 * updateWorkingMemory call. Idempotent — calling twice queues only the
 * most recent source.
 *
 * Typical use:
 *   recordTrustedProvenance(memory, threadId, resourceId, "setup_wizard");
 *   await memory.updateWorkingMemory({ threadId, resourceId, workingMemory: newValue });
 */
export function recordTrustedProvenance(
  memory: Memory,
  threadId: string,
  resourceId: string,
  source: ProvenanceSource,
): void {
  let pending = _pendingTrustedWrite.get(memory);
  if (!pending) {
    pending = new Map();
    _pendingTrustedWrite.set(memory, pending);
  }
  pending.set(`${threadId}::${resourceId}`, source);
}

/**
 * Read the recorded provenance for the last write to a given key.
 * Returns "llm_assertion" (default untrusted source) when no write has
 * happened yet. Useful for diagnostics + the doctor engine.
 */
export function getProvenance(
  memory: Memory,
  threadId: string,
  resourceId: string,
): ProvenanceSource {
  const map = _provenanceByKey.get(memory);
  if (!map) return "llm_assertion";
  return map.get(`${threadId}::${resourceId}`) ?? "llm_assertion";
}

export function isTrustedSource(source: ProvenanceSource): boolean {
  return TRUSTED_SOURCES.has(source);
}

export interface SensitiveChange {
  /** The field label that contains the sensitive marker. */
  field: string;
  /** Previous line content (or null if newly added). */
  before: string | null;
  /** New line content. */
  after: string;
  /** Suspicious-pattern names matched against the new value, if any. */
  flaggedPatterns: string[];
}

/**
 * Diff two working-memory snapshots and surface changes to sensitive
 * fields. Heuristic line-based — looks for marker substrings ("Max Risk
 * Per Trade") and compares values on the line. Both null and equal values
 * are skipped (no change to report).
 */
export function detectSensitiveFieldChanges(
  before: string | null,
  after: string,
): SensitiveChange[] {
  const beforeLines = (before ?? "").split("\n");
  const afterLines = after.split("\n");
  const changes: SensitiveChange[] = [];

  for (const marker of SENSITIVE_FIELD_MARKERS) {
    const beforeLine = beforeLines.find((l) => l.includes(marker)) ?? null;
    const afterLine = afterLines.find((l) => l.includes(marker)) ?? null;
    if (afterLine === null) continue;
    if (beforeLine === afterLine) continue;

    const flagged = SUSPICIOUS_PATTERNS
      .filter((p) => p.pattern.test(afterLine))
      .map((p) => p.name);

    changes.push({
      field: marker,
      before: beforeLine,
      after: afterLine,
      flaggedPatterns: flagged,
    });
  }

  return changes;
}

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

    // Sensitive-field-change detection + provenance tracking. Pull the
    // prior snapshot (if any) for this thread+resource key, diff against
    // the incoming value, and log structured warnings for sensitive-
    // field changes. Resolve the source: if a higher-level caller pre-
    // registered trusted provenance via recordTrustedProvenance(), use
    // that; otherwise default to "llm_assertion". Never blocks the write
    // — the user retains agency to update via legitimate paths.
    let lastByKey = _lastWorkingMemoryByKey.get(memory);
    if (!lastByKey) {
      lastByKey = new Map();
      _lastWorkingMemoryByKey.set(memory, lastByKey);
    }
    const memKey = bufferKey(finalParams);
    const previousValue = lastByKey.get(memKey) ?? null;

    // Resolve source from pending trusted-provenance map; consume it
    // (one-shot) so subsequent writes default back to llm_assertion.
    const pendingMap = _pendingTrustedWrite.get(memory);
    const explicitSource = pendingMap?.get(memKey);
    const source: ProvenanceSource = explicitSource ?? "llm_assertion";
    if (pendingMap && explicitSource) pendingMap.delete(memKey);

    // Persist provenance for this key.
    let provenanceMap = _provenanceByKey.get(memory);
    if (!provenanceMap) {
      provenanceMap = new Map();
      _provenanceByKey.set(memory, provenanceMap);
    }
    provenanceMap.set(memKey, source);

    const sensitiveChanges = detectSensitiveFieldChanges(previousValue, truncatedValue);
    for (const change of sensitiveChanges) {
      const flagSuffix = change.flaggedPatterns.length > 0
        ? ` ⚠ suspicious patterns: ${change.flaggedPatterns.join(", ")}`
        : "";
      const trustSuffix = isTrustedSource(source) ? "" : " (UNTRUSTED source — review)";
      logger.warn("Working-memory sensitive field changed", {
        threadId: finalParams.threadId,
        field: change.field,
        before: change.before,
        after: change.after,
        source,
        trustSuffix,
        flagSuffix,
      });
    }
    lastByKey.set(memKey, truncatedValue);

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
  _lastWorkingMemoryByKey.delete(memory);
  _provenanceByKey.delete(memory);
  _pendingTrustedWrite.delete(memory);
}

/** Test/debug helper — surface the sensitive-field marker list. */
export const _SENSITIVE_FIELD_MARKERS_FOR_TESTS = SENSITIVE_FIELD_MARKERS;
