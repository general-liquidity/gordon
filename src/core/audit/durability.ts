/**
 * Boundary-I/O Durability Tiering
 *
 * Cross-agent handoff payloads — the dispatch-in that starts a sub-unit, the
 * child deliverable it returns, and the parent's absorption of that result —
 * are the records you most need to RESUME a handed-off unit of work. Today they
 * are truncatable like any log line by the uniform offload cap, so the one
 * payload you cannot afford to lose is exactly the one that gets clipped.
 *
 * This module tiers audit payloads:
 *   - "boundary"   payloads are stored LOSSLESS (exempt from the offload cap).
 *   - "bestEffort" payloads (process chatter) truncate at the offload limit.
 *
 * A payload with no class is treated as bestEffort, so existing behavior is
 * unchanged. This does NOT touch the HMAC chain — the durability class rides on
 * the audit record as an optional field (see types.ts).
 */

import type { DurabilityClass } from "./types.ts";

/**
 * Default per-payload offload cap (chars). Mirrors the runtime harness tool
 * offload limit so a bestEffort audit summary truncates to the same size a
 * tool result would.
 */
export const DEFAULT_OFFLOAD_LIMIT = 1800;

/**
 * The handoff payload kinds that constitute a durability boundary. Kept as a
 * typed set so callers classify by intent, not by a magic string.
 */
export type BoundaryHandoffKind = "dispatch_in" | "child_deliverable" | "absorption";

const BOUNDARY_HANDOFF_KINDS: ReadonlySet<BoundaryHandoffKind> = new Set([
  "dispatch_in",
  "child_deliverable",
  "absorption",
]);

/** Map a handoff payload kind to its durability class. */
export function classifyHandoffPayload(kind: BoundaryHandoffKind): DurabilityClass {
  return BOUNDARY_HANDOFF_KINDS.has(kind) ? "boundary" : "bestEffort";
}

/** True when the class (or its absence) means the payload is stored lossless. */
export function isLossless(durabilityClass: DurabilityClass | undefined): boolean {
  return durabilityClass === "boundary";
}

/**
 * Resolve an effective class, defaulting an absent class to "bestEffort".
 * Use at read time so unclassified legacy records behave as before.
 */
export function resolveDurabilityClass(
  durabilityClass: DurabilityClass | undefined,
): DurabilityClass {
  return durabilityClass ?? "bestEffort";
}

/**
 * Apply the offload cap to a payload according to its durability class.
 * Boundary payloads are returned unchanged (lossless). bestEffort payloads
 * longer than `limit` are truncated with an explicit elision marker that names
 * how many characters were dropped, so a reader knows the text is partial.
 */
export function applyDurabilityTruncation(
  text: string,
  durabilityClass: DurabilityClass | undefined,
  limit: number = DEFAULT_OFFLOAD_LIMIT,
): string {
  if (isLossless(durabilityClass)) return text;
  if (text.length <= limit) return text;
  const dropped = text.length - limit;
  const marker = ` …[+${dropped} chars offloaded]`;
  const keep = Math.max(0, limit - marker.length);
  return text.slice(0, keep) + marker;
}
