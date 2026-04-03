/**
 * useNotifications — Notification context access with auto-dismiss
 *
 * Re-exports the notification hook from NotificationsProvider for
 * convenient access from hook-based consumers. Also provides a
 * helper to create notification objects with consistent IDs.
 *
 * Phase 3 of the 100% parity plan.
 */

import { useCallback } from "react";
import { useNotifications as useNotificationsContext } from "../state/NotificationsProvider.js";
import type { TuiNotification, NotificationVariant } from "../state/types.js";

// ============================================================================
// Re-export the context hook
// ============================================================================

export { useNotificationsContext as useNotificationsProvider };

// ============================================================================
// Notification factory
// ============================================================================

let notifCounter = 0;

function makeNotificationId(): string {
  notifCounter++;
  return `notif-${Date.now()}-${notifCounter}-${Math.random().toString(36).slice(2, 6)}`;
}

/**
 * Create a TuiNotification object. Does not push it — call push() separately.
 */
export function createNotification(
  type: string,
  variant: NotificationVariant,
  message: string,
): TuiNotification {
  return {
    id: makeNotificationId(),
    type,
    variant,
    message,
    timestamp: new Date().toISOString(),
  };
}

// ============================================================================
// useNotifications — Convenience hook with push helper
// ============================================================================

export interface NotificationsHookResult {
  /** Active (non-dismissed) notifications */
  active: TuiNotification[];
  /** Top N visible notifications */
  visible: TuiNotification[];
  /** Folded notifications (grouped by type) */
  folded: ReturnType<typeof useNotificationsContext>["folded"];
  /** Push a pre-built notification */
  push: (notification: TuiNotification) => void;
  /** Create and push a notification in one call */
  notify: (type: string, variant: NotificationVariant, message: string) => void;
  /** Dismiss a notification by id */
  dismiss: (id: string) => void;
  /** Dismiss all */
  clearAll: () => void;
  /** Total active count */
  count: number;
}

export function useNotifications(): NotificationsHookResult {
  const ctx = useNotificationsContext();

  const notify = useCallback(
    (type: string, variant: NotificationVariant, message: string) => {
      ctx.push(createNotification(type, variant, message));
    },
    [ctx.push],
  );

  return {
    active: ctx.active,
    visible: ctx.visible,
    folded: ctx.folded,
    push: ctx.push,
    notify,
    dismiss: ctx.dismiss,
    clearAll: ctx.clearAll,
    count: ctx.active.length,
  };
}
