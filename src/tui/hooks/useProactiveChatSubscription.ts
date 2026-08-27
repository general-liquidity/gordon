/**
 * Proactive Chat Subscription Hook
 *
 * Bridges Gordon's event bus into the TUI chat stream so proactive suggestions
 * actually show up as chat messages when they fire. Subscribes to
 * `proactive:suggestion_fired` on mount, translates each event into a
 * Message with variant="proactive_suggestion", and dispatches ADD_MESSAGE
 * into the TUI state.
 *
 * Without this hook, suggestions fire silently into the suggestion store and
 * the user has to explicitly call list_proactive_suggestions to see anything —
 * the renderer exists but nothing triggers it. This closes the gap.
 *
 * The badge field on Message carries "<category>:<id>:<confidence>" so the
 * ProactiveSuggestionMessage renderer can parse category, id, and confidence
 * from a single string without schema changes.
 */

import { useEffect } from "react";
import type { Dispatch } from "react";
import { getEventBus } from "../../events/index.js";
import type { Message } from "../components/messages/MessageBubble.tsx";

type AddMessageAction = { type: "ADD_MESSAGE"; message: Message };

export function useProactiveChatSubscription(dispatch: Dispatch<AddMessageAction>): void {
  useEffect(() => {
    const bus = getEventBus();
    const unsubscribe = bus.on("proactive:suggestion_fired", (event) => {
      const confidence = typeof event.confidence === "number" ? event.confidence : 0;
      const formatted = `${event.title}\n\n${event.body}${event.action ? `\n\n→ ${event.action}` : ""}`;

      const message: Message = {
        id: `proactive-${event.suggestionId}`,
        role: "system",
        content: formatted,
        timestamp: event.timestamp,
        variant: "proactive_suggestion",
        badge: `${event.category}:${event.suggestionId}:${confidence.toFixed(2)}`,
        agent: "Gordon",
      };

      dispatch({ type: "ADD_MESSAGE", message });
    });

    return () => {
      try {
        unsubscribe();
      } catch {
        // Bus may already be torn down on shutdown — ignore
      }
    };
  }, [dispatch]);
}
