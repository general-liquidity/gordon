/**
 * Alert → Audit Log Mirror
 *
 * Subscribes to `alert:fired` events and forwards warning/critical alerts
 * to the audit log, so operator-facing alerts leave a durable compliance
 * trail even when no TUI is running (daemons, background mandates, tests).
 *
 * Info-level alerts are NOT mirrored — they're ephemeral status signals
 * not worth persisting.
 *
 * Usage:
 *   // During app startup:
 *   import { startAlertAuditMirror } from ".../alertAuditMirror.ts";
 *   const stopMirror = startAlertAuditMirror();
 *
 *   // On shutdown:
 *   stopMirror();
 */

import { getEventBus } from "../../../events/bus.ts";
import { getAuditLogger } from "../audit/audit-log.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("alert-audit-mirror");

let mirrorUnsubscribe: (() => void) | null = null;

/**
 * Start the alert-to-audit mirror. Idempotent — repeated calls are safe;
 * returns the same teardown function.
 *
 * @returns unsubscribe function
 */
export function startAlertAuditMirror(): () => void {
  if (mirrorUnsubscribe) {
    return mirrorUnsubscribe;
  }

  const audit = getAuditLogger("alert-mirror");

  const handler = (event: {
    level: "info" | "warning" | "critical";
    category: string;
    message: string;
    context?: Record<string, unknown>;
    dedupeKey?: string;
  }) => {
    if (event.level === "info") return; // ephemeral — skip persistence

    const action = event.level === "critical" ? "ALERT_CRITICAL" : "ALERT_WARNING";
    try {
      audit.success(
        action,
        {
          category: event.category,
          message: event.message,
          dedupeKey: event.dedupeKey,
        },
        {
          metadata: event.context ? { alertContext: event.context } : undefined,
        },
      );
    } catch (err) {
      // Audit failures never block the event bus
      logger.error("Failed to mirror alert to audit log", err as Error);
    }
  };

  const unsub = getEventBus().on("alert:fired", handler);
  mirrorUnsubscribe = () => {
    unsub();
    mirrorUnsubscribe = null;
  };
  return mirrorUnsubscribe;
}

/**
 * Returns true if the mirror is currently active.
 */
export function isAlertAuditMirrorRunning(): boolean {
  return mirrorUnsubscribe !== null;
}
