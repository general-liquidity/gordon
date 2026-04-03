/**
 * useEventBusSubscription — Subscribe to Gordon EventBus events
 *
 * Wraps the EventBus.on() pattern in a React hook that automatically
 * unsubscribes on unmount. The handler is kept stable via ref so
 * re-renders don't cause re-subscriptions.
 *
 * Phase 3 of the 100% parity plan.
 */

import { useEffect, useRef } from "react";
import { getEventBus, type EventHandler } from "../../events/index.ts";
import type { EventType, EventData } from "../../events/index.ts";

/**
 * Subscribe to a single EventBus event type.
 *
 * @param eventType  The event type string (e.g. "trade:opened")
 * @param handler    Callback invoked with event data
 * @param enabled    Optional flag to conditionally enable/disable (default true)
 *
 * @example
 *   useEventBusSubscription("trade:opened", (event) => {
 *     console.log("Trade opened:", event.trade.symbol);
 *   });
 */
export function useEventBusSubscription<T extends EventType>(
  eventType: T,
  handler: EventHandler<T>,
  enabled: boolean = true,
): void {
  // Keep the handler reference stable to avoid re-subscribing on every render
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled) return;

    let bus: ReturnType<typeof getEventBus>;
    try {
      bus = getEventBus();
    } catch {
      // EventBus not initialized yet (e.g. during SSR or early boot)
      return;
    }

    const wrappedHandler: EventHandler<T> = (event) => {
      handlerRef.current(event);
    };

    const unsubscribe = bus.on(eventType, wrappedHandler);
    return unsubscribe;
  }, [eventType, enabled]);
}

/**
 * Subscribe to multiple EventBus event types with a single handler.
 *
 * @param eventTypes  Array of event type strings
 * @param handler     Callback invoked with event data (typed as any EventData)
 * @param enabled     Optional flag to conditionally enable/disable (default true)
 *
 * @example
 *   useEventBusSubscriptions(
 *     ["trade:opened", "trade:closed"],
 *     (event) => { console.log("Trade event:", event); }
 *   );
 */
export function useEventBusSubscriptions(
  eventTypes: EventType[],
  handler: (event: EventData<EventType>) => void,
  enabled: boolean = true,
): void {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;

  useEffect(() => {
    if (!enabled || eventTypes.length === 0) return;

    let bus: ReturnType<typeof getEventBus>;
    try {
      bus = getEventBus();
    } catch {
      return;
    }

    const unsubscribes: Array<() => void> = [];

    for (const eventType of eventTypes) {
      const wrappedHandler = (event: EventData<typeof eventType>) => {
        handlerRef.current(event);
      };
      unsubscribes.push(bus.on(eventType, wrappedHandler));
    }

    return () => {
      for (const unsub of unsubscribes) {
        unsub();
      }
    };
    // Stringify the array to detect changes in the list of event types
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(eventTypes), enabled]);
}
