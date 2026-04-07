/**
 * Notification Fold/Merge
 *
 * When a notification with the same key arrives, fold (merge) with the
 * existing one instead of queueing a duplicate. Enables counters like
 * "3 orders filled" instead of 3 separate notifications.
 *
 * Claude Code pattern: notifications with same key get folded, counter
 * incremented, timeout reset. Supports priority invalidation (e.g.,
 * "order pending" invalidated by "order filled").
 */

export type NotificationPriority = "immediate" | "normal" | "low";
export type NotificationVariant = "fill" | "alert" | "strategy" | "info" | "error" | "system";

export interface Notification {
  id: string;
  /** Dedup key — notifications with same key get folded. */
  key: string;
  message: string;
  variant: NotificationVariant;
  priority: NotificationPriority;
  /** How many times this notification has been folded. */
  count: number;
  /** ISO timestamp of first occurrence. */
  firstAt: string;
  /** ISO timestamp of most recent fold. */
  lastAt: string;
  /** Auto-dismiss after this many ms (0 = sticky). */
  timeoutMs: number;
  /** Keys of notifications this one invalidates when it arrives. */
  invalidates?: string[];
  /** Custom data payload. */
  data?: Record<string, unknown>;
}

export interface FolderOptions {
  /** Max notifications to keep in the queue. Default 50. */
  maxSize?: number;
  /** Default timeout for auto-dismiss. Default 8000ms. */
  defaultTimeoutMs?: number;
}

type Listener = (notifications: Notification[]) => void;

export class NotificationFolder {
  private queue: Notification[] = [];
  private listeners = new Set<Listener>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private maxSize: number;
  private defaultTimeoutMs: number;
  private nextId = 0;

  constructor(options: FolderOptions = {}) {
    this.maxSize = options.maxSize ?? 50;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 8000;
  }

  /**
   * Push a notification. If one with the same key exists, fold into it
   * (increment count, update message, reset timeout). Otherwise add new.
   */
  push(params: {
    key: string;
    message: string;
    variant?: NotificationVariant;
    priority?: NotificationPriority;
    timeoutMs?: number;
    invalidates?: string[];
    data?: Record<string, unknown>;
  }): Notification {
    const now = new Date().toISOString();

    // Invalidate related notifications
    if (params.invalidates?.length) {
      for (const invKey of params.invalidates) {
        this.remove(invKey);
      }
    }

    // Check for existing notification with same key
    const existing = this.queue.find((n) => n.key === params.key);

    if (existing) {
      // Fold: increment count, update message and timestamp
      existing.count++;
      existing.message = params.message;
      existing.lastAt = now;
      if (params.data) existing.data = { ...existing.data, ...params.data };

      // Reset timeout
      this.resetTimeout(existing);
      this.notify();
      return existing;
    }

    // New notification
    const notification: Notification = {
      id: `notif_${this.nextId++}`,
      key: params.key,
      message: params.message,
      variant: params.variant ?? "info",
      priority: params.priority ?? "normal",
      count: 1,
      firstAt: now,
      lastAt: now,
      timeoutMs: params.timeoutMs ?? this.defaultTimeoutMs,
      invalidates: params.invalidates,
      data: params.data,
    };

    // Insert by priority (immediate first)
    if (notification.priority === "immediate") {
      this.queue.unshift(notification);
    } else {
      this.queue.push(notification);
    }

    // Enforce max size
    while (this.queue.length > this.maxSize) {
      const removed = this.queue.shift();
      if (removed) this.clearTimeout(removed.key);
    }

    // Start auto-dismiss timer
    if (notification.timeoutMs > 0) {
      this.startTimeout(notification);
    }

    this.notify();
    return notification;
  }

  /**
   * Remove a notification by key.
   */
  remove(key: string): boolean {
    const idx = this.queue.findIndex((n) => n.key === key);
    if (idx === -1) return false;
    this.queue.splice(idx, 1);
    this.clearTimeout(key);
    this.notify();
    return true;
  }

  /**
   * Get all active notifications (for rendering).
   */
  getAll(): readonly Notification[] {
    return this.queue;
  }

  /**
   * Get count of active notifications.
   */
  get size(): number {
    return this.queue.length;
  }

  /**
   * Subscribe to notification changes.
   */
  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Clear all notifications.
   */
  clear(): void {
    for (const key of this.timers.keys()) this.clearTimeout(key);
    this.queue = [];
    this.notify();
  }

  // ── Internal ──

  private startTimeout(n: Notification): void {
    this.clearTimeout(n.key);
    const timer = setTimeout(() => {
      this.remove(n.key);
    }, n.timeoutMs);
    this.timers.set(n.key, timer);
  }

  private resetTimeout(n: Notification): void {
    if (n.timeoutMs > 0) this.startTimeout(n);
  }

  private clearTimeout(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  private notify(): void {
    const snapshot = [...this.queue];
    for (const l of this.listeners) {
      try { l(snapshot); } catch { /* listener errors don't crash notifications */ }
    }
  }
}

// ── Singleton ──

let instance: NotificationFolder | null = null;

export function getNotificationFolder(): NotificationFolder {
  if (!instance) instance = new NotificationFolder();
  return instance;
}

export function resetNotificationFolder(): void {
  instance?.clear();
  instance = null;
}

// ── Convenience: trading-specific helpers ──

export function notifyOrderFilled(symbol: string, side: string, qty: number, price: number): Notification {
  return getNotificationFolder().push({
    key: `fill:${symbol}`,
    message: `${side} ${qty} ${symbol} @ ${price}`,
    variant: "fill",
    priority: "immediate",
    invalidates: [`pending:${symbol}`],
    data: { symbol, side, qty, price },
  });
}

export function notifyOrderPending(symbol: string, orderId: string): Notification {
  return getNotificationFolder().push({
    key: `pending:${symbol}`,
    message: `Order pending: ${symbol} (${orderId})`,
    variant: "info",
    priority: "normal",
  });
}

export function notifyRiskAlert(message: string, severity: "warn" | "critical" = "warn"): Notification {
  return getNotificationFolder().push({
    key: `risk:${Date.now()}`,
    message,
    variant: severity === "critical" ? "error" : "alert",
    priority: severity === "critical" ? "immediate" : "normal",
    timeoutMs: severity === "critical" ? 0 : 10_000, // critical = sticky
  });
}
