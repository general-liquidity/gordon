/**
 * Event Bus
 * Central event system for decoupled communication
 */

import type { GordonEvent, EventType, EventData } from "./types.ts";
import { createModuleLogger } from "../infra/logger/index.ts";

const logger = createModuleLogger("events");

/**
 * Event handler function type
 */
export type EventHandler<T extends EventType> = (event: EventData<T>) => void | Promise<void>;

/**
 * Wildcard handler that receives all events
 */
export type WildcardHandler = (event: GordonEvent) => void | Promise<void>;

/**
 * Subscription options
 */
export interface SubscriptionOptions {
  /** Only trigger once then unsubscribe */
  once?: boolean;
  /** Priority (higher runs first) */
  priority?: number;
}

/**
 * Internal subscription record
 */
interface Subscription {
  handler: EventHandler<EventType> | WildcardHandler;
  options: SubscriptionOptions;
}

/**
 * Event Bus - pub/sub system for Gordon events
 */
export class EventBus {
  private handlers: Map<EventType | "*", Subscription[]> = new Map();
  private history: GordonEvent[] = [];
  private historyLimit: number;

  constructor(historyLimit: number = 100) {
    this.historyLimit = historyLimit;
  }

  /**
   * Subscribe to an event type
   */
  on<T extends EventType>(
    type: T,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): () => void {
    const subs = this.handlers.get(type) || [];
    const subscription: Subscription = {
      handler: handler as unknown as EventHandler<EventType>,
      options,
    };

    // Insert by priority (higher first)
    const priority = options.priority ?? 0;
    const insertIndex = subs.findIndex((s) => (s.options.priority ?? 0) < priority);
    if (insertIndex === -1) {
      subs.push(subscription);
    } else {
      subs.splice(insertIndex, 0, subscription);
    }

    this.handlers.set(type, subs);

    // Return unsubscribe function
    return () => this.off(type, handler);
  }

  /**
   * Subscribe to all events
   */
  onAny(handler: WildcardHandler, options: SubscriptionOptions = {}): () => void {
    const subs = this.handlers.get("*") || [];
    subs.push({ handler, options });
    this.handlers.set("*", subs);

    return () => {
      const current = this.handlers.get("*") || [];
      this.handlers.set("*", current.filter((s) => s.handler !== handler));
    };
  }

  /**
   * Subscribe to an event type, but only once
   */
  once<T extends EventType>(
    type: T,
    handler: EventHandler<T>,
    options: SubscriptionOptions = {}
  ): () => void {
    return this.on(type, handler, { ...options, once: true });
  }

  /**
   * Unsubscribe from an event type
   */
  off<T extends EventType>(type: T, handler: EventHandler<T>): void {
    const subs = this.handlers.get(type);
    if (subs) {
      this.handlers.set(
        type,
        subs.filter((s) => s.handler !== handler)
      );
    }
  }

  /**
   * Emit an event
   */
  async emit<T extends EventType>(event: EventData<T>): Promise<void> {
    // Add to history
    this.history.push(event as GordonEvent);
    if (this.history.length > this.historyLimit) {
      this.history.shift();
    }

    logger.debug(`Event emitted: ${event.type}`, { event });

    // Get handlers for this specific event type
    const typeHandlers = this.handlers.get(event.type as EventType) || [];

    // Get wildcard handlers
    const wildcardHandlers = this.handlers.get("*") || [];

    // Combine and process
    const toRemove: { type: EventType | "*"; handler: EventHandler<EventType> | WildcardHandler }[] = [];

    // Process type-specific handlers
    for (const sub of typeHandlers) {
      try {
        await sub.handler(event as EventData<EventType>);
      } catch (error) {
        logger.error(`Error in event handler for ${event.type}`, error as Error);
      }

      if (sub.options.once) {
        toRemove.push({ type: event.type as EventType, handler: sub.handler });
      }
    }

    // Process wildcard handlers
    for (const sub of wildcardHandlers) {
      try {
        await (sub.handler as WildcardHandler)(event as GordonEvent);
      } catch (error) {
        logger.error(`Error in wildcard event handler`, error as Error);
      }

      if (sub.options.once) {
        toRemove.push({ type: "*", handler: sub.handler });
      }
    }

    // Remove one-time handlers
    for (const { type, handler } of toRemove) {
      const subs = this.handlers.get(type);
      if (subs) {
        this.handlers.set(
          type,
          subs.filter((s) => s.handler !== handler)
        );
      }
    }
  }

  /**
   * Create and emit an event with automatic timestamp
   */
  async send<T extends EventType>(
    type: T,
    data: Omit<EventData<T>, "type" | "timestamp">
  ): Promise<void> {
    const event = {
      ...data,
      type,
      timestamp: new Date().toISOString(),
    } as EventData<T>;

    await this.emit(event);
  }

  /**
   * Get event history
   */
  getHistory(type?: EventType): GordonEvent[] {
    if (type) {
      return this.history.filter((e) => e.type === type);
    }
    return [...this.history];
  }

  /**
   * Clear event history
   */
  clearHistory(): void {
    this.history = [];
  }

  /**
   * Remove all handlers
   */
  clear(): void {
    this.handlers.clear();
    this.history = [];
  }

  /**
   * Get handler count for a type
   */
  listenerCount(type: EventType | "*"): number {
    return (this.handlers.get(type) || []).length;
  }
}

// Default event bus instance
let defaultBus: EventBus | null = null;

/**
 * Get the default event bus instance
 */
export function getEventBus(): EventBus {
  if (!defaultBus) {
    defaultBus = new EventBus();
  }
  return defaultBus;
}

/**
 * Set the default event bus instance
 */
export function setEventBus(bus: EventBus): void {
  defaultBus = bus;
}

/**
 * Convenience function to emit an event on the default bus
 */
export async function emitEvent<T extends EventType>(
  type: T,
  data: Omit<EventData<T>, "type" | "timestamp">
): Promise<void> {
  await getEventBus().send(type, data);
}
