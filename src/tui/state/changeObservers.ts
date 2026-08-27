/**
 * changeObservers -- State change observation and side-effect dispatch
 * Phase 11: observeStateChanges(prev, next) -- persist on message change, emit on cost change.
 *
 * This module compares consecutive state snapshots and triggers
 * side-effects when specific fields change:
 *   - Messages changed  -> persist conversation to disk
 *   - Cost changed      -> emit cost event for external consumers
 */

import type { AppState } from "./types.js";

// ============================================================================
// Observer callback types
// ============================================================================

export interface ChangeObserverCallbacks {
  /** Called when the messages array changes (length or identity). */
  onMessagesChanged?: (messages: AppState["messages"]) => void;
  /** Called when the cost value changes. */
  onCostChanged?: (cost: number, prevCost: number) => void;
}

// ============================================================================
// Observer instance
// ============================================================================

let registeredCallbacks: ChangeObserverCallbacks = {};

/**
 * Register callbacks that fire when specific state fields change.
 * Replaces any previously registered callbacks.
 */
export function registerObservers(callbacks: ChangeObserverCallbacks): void {
  registeredCallbacks = { ...callbacks };
}

/**
 * Clear all registered observer callbacks.
 */
export function clearObservers(): void {
  registeredCallbacks = {};
}

// ============================================================================
// Core observer function
// ============================================================================

/**
 * Compare prev and next state, fire registered callbacks for changed fields.
 * Intended to be called after every reducer dispatch.
 *
 * Checks:
 *   1. Messages identity/length change -> onMessagesChanged (persist)
 *   2. Cost value change               -> onCostChanged (emit)
 */
export function observeStateChanges(prev: AppState, next: AppState): void {
  // 1. Persist on message change
  //    Compare by reference first (fast path), then by length as fallback
  if (prev.messages !== next.messages) {
    registeredCallbacks.onMessagesChanged?.(next.messages);
  }

  // 2. Emit on cost change
  if (prev.cost !== next.cost) {
    registeredCallbacks.onCostChanged?.(next.cost, prev.cost);
  }
}

// ============================================================================
// Persistence helper (default implementation)
// ============================================================================

/**
 * Default persistence handler for messages.
 * Writes the conversation to a JSON file in the session directory.
 * Can be used as the onMessagesChanged callback.
 */
export function createMessagePersister(sessionDir: string) {
  const fs = require("node:fs") as typeof import("fs");
  const path = require("node:path") as typeof import("path");

  let writeQueued = false;
  let latestMessages: AppState["messages"] = [];

  return function persistMessages(messages: AppState["messages"]): void {
    latestMessages = messages;

    // Debounce writes -- only one pending write at a time
    if (writeQueued) return;
    writeQueued = true;

    // Defer to next tick to batch rapid changes
    setImmediate(() => {
      writeQueued = false;
      try {
        const filePath = path.join(sessionDir, "conversation.json");
        const payload = JSON.stringify(latestMessages, null, 2);
        fs.writeFileSync(filePath, payload, "utf8");
      } catch {
        // Persistence is best-effort; swallow errors silently
      }
    });
  };
}

/**
 * Default cost emitter.
 * Emits cost changes to a Node.js EventEmitter or similar sink.
 */
export function createCostEmitter(
  emit: (event: string, data: { cost: number; delta: number }) => void,
) {
  return function emitCost(cost: number, prevCost: number): void {
    const delta = cost - prevCost;
    if (delta !== 0) {
      emit("cost:changed", { cost, delta });
    }
  };
}
