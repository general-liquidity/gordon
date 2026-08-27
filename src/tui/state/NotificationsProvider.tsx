/**
 * NotificationsProvider — Priority queue with fold, invalidation, and auto-dismiss
 *
 * Manages TUI notifications (trade fills, alerts, errors, etc.) as a priority
 * queue. Higher-priority notifications displace lower ones when the display
 * limit is reached. Notifications auto-dismiss after a configurable timeout.
 *
 * Phase 2 of the 100% parity plan.
 */

import {
  createContext,
  useContext,
  useCallback,
  useRef,
  useState,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import type { TuiNotification, NotificationVariant } from "./types.js";

// ============================================================================
// Priority mapping — higher number = higher priority
// ============================================================================

const VARIANT_PRIORITY: Record<NotificationVariant, number> = {
  error: 100,
  alert: 80,
  fill: 60,
  strategy: 40,
  info: 20,
  system: 10,
};

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_MAX_VISIBLE = 5;
const DEFAULT_DISMISS_MS: Record<NotificationVariant, number> = {
  error: 10_000,
  alert: 8_000,
  fill: 6_000,
  strategy: 6_000,
  info: 4_000,
  system: 3_000,
};

// ============================================================================
// Context value
// ============================================================================

export interface NotificationsContextValue {
  /** All notifications (including dismissed) */
  all: TuiNotification[];
  /** Active (non-dismissed) notifications, sorted by priority desc */
  active: TuiNotification[];
  /** Top N visible notifications (priority-sorted, capped at maxVisible) */
  visible: TuiNotification[];
  /** Push a new notification */
  push: (notification: TuiNotification) => void;
  /** Dismiss a notification by id */
  dismiss: (id: string) => void;
  /** Dismiss all notifications */
  clearAll: () => void;
  /** Fold: collapse multiple same-type notifications into one with count */
  folded: FoldedNotification[];
}

export interface FoldedNotification {
  /** Representative notification (most recent of the type) */
  notification: TuiNotification;
  /** How many notifications were folded into this one */
  count: number;
}

const NotificationsContext = createContext<NotificationsContextValue | null>(null);

// ============================================================================
// Provider
// ============================================================================

interface Props {
  children: ReactNode;
  /** Maximum visible notifications (default 5) */
  maxVisible?: number;
  /** Override dismiss timeouts per variant */
  dismissTimeouts?: Partial<Record<NotificationVariant, number>>;
}

export function NotificationsProvider({
  children,
  maxVisible = DEFAULT_MAX_VISIBLE,
  dismissTimeouts,
}: Props) {
  const [notifications, setNotifications] = useState<TuiNotification[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  const mergedTimeouts = useMemo(
    () => ({ ...DEFAULT_DISMISS_MS, ...dismissTimeouts }),
    [dismissTimeouts],
  );

  // ── Push ──
  const push = useCallback(
    (notification: TuiNotification) => {
      setNotifications((prev) => {
        // Cap total stored notifications at 100
        const next = [...prev, notification];
        if (next.length > 100) next.shift();
        return next;
      });

      // Schedule auto-dismiss
      const timeout = mergedTimeouts[notification.variant] ?? 5_000;
      const timer = setTimeout(() => {
        setNotifications((prev) =>
          prev.map((n) => (n.id === notification.id ? { ...n, dismissed: true } : n)),
        );
        timersRef.current.delete(notification.id);
      }, timeout);
      timersRef.current.set(notification.id, timer);
    },
    [mergedTimeouts],
  );

  // ── Dismiss ──
  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.map((n) => (n.id === id ? { ...n, dismissed: true } : n)));
    const timer = timersRef.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timersRef.current.delete(id);
    }
  }, []);

  // ── Clear all ──
  const clearAll = useCallback(() => {
    setNotifications((prev) => prev.map((n) => ({ ...n, dismissed: true })));
    for (const timer of timersRef.current.values()) {
      clearTimeout(timer);
    }
    timersRef.current.clear();
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      for (const timer of timersRef.current.values()) {
        clearTimeout(timer);
      }
    };
  }, []);

  // ── Derived: active notifications sorted by priority ──
  const active = useMemo(() => {
    return notifications
      .filter((n) => !n.dismissed)
      .sort((a, b) => (VARIANT_PRIORITY[b.variant] ?? 0) - (VARIANT_PRIORITY[a.variant] ?? 0));
  }, [notifications]);

  // ── Derived: visible (top N) ──
  const visible = useMemo(() => active.slice(0, maxVisible), [active, maxVisible]);

  // ── Derived: folded (group same-type, keep most recent) ──
  const folded = useMemo<FoldedNotification[]>(() => {
    const groups = new Map<string, TuiNotification[]>();
    for (const n of active) {
      const key = n.type;
      const group = groups.get(key);
      if (group) {
        group.push(n);
      } else {
        groups.set(key, [n]);
      }
    }
    const result: FoldedNotification[] = [];
    for (const group of groups.values()) {
      // Most recent first (last in array)
      const representative = group[group.length - 1]!;
      result.push({ notification: representative, count: group.length });
    }
    // Sort by priority of representative
    result.sort(
      (a, b) =>
        (VARIANT_PRIORITY[b.notification.variant] ?? 0) -
        (VARIANT_PRIORITY[a.notification.variant] ?? 0),
    );
    return result;
  }, [active]);

  // ── Context value ──
  const value = useMemo<NotificationsContextValue>(
    () => ({
      all: notifications,
      active,
      visible,
      push,
      dismiss,
      clearAll,
      folded,
    }),
    [notifications, active, visible, push, dismiss, clearAll, folded],
  );

  return <NotificationsContext.Provider value={value}>{children}</NotificationsContext.Provider>;
}

// ============================================================================
// useNotifications — Access notification context
// ============================================================================

export function useNotifications(): NotificationsContextValue {
  const ctx = useContext(NotificationsContext);
  if (!ctx) {
    // Return a no-op fallback for use outside the provider (e.g. tests)
    return {
      all: [],
      active: [],
      visible: [],
      push: () => {},
      dismiss: () => {},
      clearAll: () => {},
      folded: [],
    };
  }
  return ctx;
}
