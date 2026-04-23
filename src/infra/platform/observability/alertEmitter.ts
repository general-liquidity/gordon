/**
 * Alert Emitter
 *
 * Thin wrapper over Gordon's event bus for operator-facing alerts. Metrics
 * and subsystems call `emitAlert(...)`; in-process consumers attach to the
 * `alert:fired` event and render alerts however the operator surface
 * requires — TUI status panel, CLI notification line, audit-log mirror,
 * throttled console log.
 *
 * Alerts are internal signals, not outbound notifications.
 *
 * Usage:
 *   emitAlert({
 *     level: "warning",
 *     category: "cost",
 *     message: "Session budget 75% exhausted",
 *     context: { sessionId, usdSpent, sessionBudget },
 *     dedupeKey: `cost:${sessionId}:75`,
 *   });
 */

import { emitEvent } from "../../../events/bus.ts";

export type AlertLevel = "info" | "warning" | "critical";

export interface AlertInput {
  level: AlertLevel;
  category: string;
  message: string;
  context?: Record<string, unknown>;
  /**
   * Deduplication key. Alerts with the same key within the dedup window
   * (default 60s) are suppressed. Pass a stable key per logical alert to
   * avoid flooding consumers.
   */
  dedupeKey?: string;
}

// ---------------------------------------------------------------------------
// In-memory dedup — drops repeat alerts with the same key in a time window.
// ---------------------------------------------------------------------------

const DEFAULT_DEDUP_WINDOW_MS = 60_000;
const dedupeTable = new Map<string, number>();

function isRecentDuplicate(key: string, windowMs: number): boolean {
  const last = dedupeTable.get(key);
  const now = Date.now();
  if (last !== undefined && now - last < windowMs) {
    return true;
  }
  dedupeTable.set(key, now);
  // Opportunistic cleanup — stale keys older than 10× window are dropped
  if (dedupeTable.size > 256) {
    const cutoff = now - windowMs * 10;
    for (const [k, t] of dedupeTable) {
      if (t < cutoff) dedupeTable.delete(k);
    }
  }
  return false;
}

/**
 * Emit an alert to the event bus. Returns true if the alert was emitted,
 * false if it was suppressed by dedup.
 */
export async function emitAlert(input: AlertInput, options: { dedupWindowMs?: number } = {}): Promise<boolean> {
  if (input.dedupeKey) {
    const windowMs = options.dedupWindowMs ?? DEFAULT_DEDUP_WINDOW_MS;
    if (isRecentDuplicate(input.dedupeKey, windowMs)) {
      return false;
    }
  }

  await emitEvent("alert:fired", {
    level: input.level,
    category: input.category,
    message: input.message,
    context: input.context,
    dedupeKey: input.dedupeKey,
  });
  return true;
}

/**
 * Convenience helpers for common alert levels.
 */
export const alert = {
  info: (category: string, message: string, context?: Record<string, unknown>, dedupeKey?: string) =>
    emitAlert({ level: "info", category, message, context, dedupeKey }),
  warn: (category: string, message: string, context?: Record<string, unknown>, dedupeKey?: string) =>
    emitAlert({ level: "warning", category, message, context, dedupeKey }),
  critical: (category: string, message: string, context?: Record<string, unknown>, dedupeKey?: string) =>
    emitAlert({ level: "critical", category, message, context, dedupeKey }),
};

/**
 * Reset dedup state. Test-only — production code should never need to clear.
 */
export function _resetAlertDedupe(): void {
  dedupeTable.clear();
}
