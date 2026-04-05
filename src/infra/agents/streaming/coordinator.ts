/**
 * Global Agent Event Coordinator
 *
 * Single shared AgentEventStream instance used across Gordon's orchestrator,
 * stream processor, summarization hooks, and tool wrappers. The TUI and any
 * HTTP/WebSocket transports subscribe via getAgentEventStream().
 *
 * This coordinator does NOT replace Gordon's existing StreamEvent pipeline.
 * It emits IN PARALLEL — same agent actions, richer event taxonomy. Existing
 * TUI code continues to consume StreamEvent; new consumers subscribe to
 * AgentEvent.
 */

import { AgentEventStream, type AgentEvent, type AgentEventListener } from "./events.ts";

let instance: AgentEventStream | null = null;

export function getAgentEventStream(): AgentEventStream {
  if (!instance) instance = new AgentEventStream({ bufferLimit: 500 });
  return instance;
}

export function resetAgentEventStream(): void {
  instance = null;
}

/** Emit an event to the shared stream. Safe to call even before any subscribers. */
export function emitAgentEvent(event: AgentEvent): void {
  getAgentEventStream().emit(event);
}

/** Convenience re-exports for callers. */
export { AgentEventStream };
export type { AgentEvent, AgentEventListener };
