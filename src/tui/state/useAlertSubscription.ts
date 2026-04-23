/**
 * useAlertSubscription
 *
 * React hook that subscribes to Gordon's `alert:fired` event stream and
 * pushes each alert into the TUI NotificationsProvider queue. Handles the
 * level → variant mapping + wraps message text for display.
 *
 * Mount once under `<NotificationsProvider>` (e.g. at the App root) and
 * alerts emitted from anywhere in Gordon will surface as prioritized TUI
 * notifications automatically.
 */

import { useEffect } from "react";
import { getEventBus } from "../../events/bus.ts";
import type { EventData } from "../../events/index.ts";
import { useNotifications } from "./NotificationsProvider.js";
import type { NotificationVariant, TuiNotification } from "./types.js";

const LEVEL_TO_VARIANT: Record<"info" | "warning" | "critical", NotificationVariant> = {
  info: "info",
  warning: "alert",
  critical: "error",
};

let idCounter = 0;
function generateNotificationId(event: EventData<"alert:fired">): string {
  if (event.dedupeKey) return `alert:${event.dedupeKey}`;
  idCounter += 1;
  return `alert:${event.category}:${Date.now()}:${idCounter}`;
}

export function useAlertSubscription(): void {
  const { push } = useNotifications();

  useEffect(() => {
    const unsubscribe = getEventBus().on("alert:fired", (event) => {
      const notification: TuiNotification = {
        id: generateNotificationId(event),
        type: `alert:${event.category}`,
        variant: LEVEL_TO_VARIANT[event.level],
        message: event.message,
        timestamp: new Date().toISOString(),
      };
      push(notification);
    });
    return () => unsubscribe();
  }, [push]);
}
