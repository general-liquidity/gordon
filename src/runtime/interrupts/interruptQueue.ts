/**
 * Interrupt queue — soft mid-stream steering messages.
 *
 * Pattern ported from claude-code-from-scratch s19 (MIT). Gordon
 * previously had two interrupt modes: SIGINT graceful shutdown (kills
 * the process) and the doom-loop detector (kills the run). Neither
 * captures "the operator wants to steer mid-stream without aborting."
 *
 * This module is the third mode: a process-singleton queue of pending
 * messages. The orchestrator drains it at two natural check points —
 * before each LLM call, and before each tool batch. Drained messages
 * are injected into the next conversation turn as `[INTERRUPT] ...`
 * user messages. The model's system prompt instructs it to acknowledge
 * the interrupt by summarizing progress and waiting for instructions.
 *
 * Important constraint:
 *
 *   Interrupts are NOT a stop signal. They're a "look at this before
 *   you continue" signal. The model decides what to do with them —
 *   typically pause + summarize, but possibly continue if the
 *   interrupt is informational. Hard cancellation still goes through
 *   the existing AbortController / doom-loop paths.
 *
 * Process-singleton on purpose. The queue lives at the runtime layer,
 * not per-session, because the TUI captures Ctrl+C globally and the
 * orchestrator stream is also global to the current session. Two
 * concurrent sessions would conflict — but Gordon is single-tenant
 * single-session, so this is fine.
 */

import { createModuleLogger } from "../../infra/logger/index.ts";

const logger = createModuleLogger("interrupt-queue");

const queue: string[] = [];

/** Maximum interrupts retained before older ones are dropped. Stops
 *  the queue from growing unboundedly when the operator hammers Ctrl+C
 *  during a stuck run. */
const MAX_QUEUE_DEPTH = 16;

/** Format applied to enqueued messages before injection — the model's
 *  system prompt directive keys off this exact prefix. */
const INTERRUPT_PREFIX = "[INTERRUPT]";

export interface EnqueueOptions {
  /** If true, the message is added without the [INTERRUPT] prefix.
   *  Use for system-generated injections that aren't operator
   *  interrupts (e.g. a hook injecting a context refresh). */
  raw?: boolean;
}

/**
 * Add a message to the interrupt queue. Returns false when the queue
 * was at capacity and the oldest entry was evicted to make room.
 */
export function enqueueInterrupt(message: string, options: EnqueueOptions = {}): boolean {
  const trimmed = (message ?? "").trim();
  if (trimmed.length === 0) return true;
  const payload = options.raw
    ? trimmed
    : `${INTERRUPT_PREFIX} ${trimmed}`;
  const evicted = queue.length >= MAX_QUEUE_DEPTH;
  if (evicted) {
    queue.shift();
  }
  queue.push(payload);
  logger.debug("Interrupt enqueued", { depth: queue.length, evicted });
  return !evicted;
}

/**
 * Drain the queue, returning all pending interrupts as a single array.
 * The orchestrator calls this at check points (before-LLM, before-tool)
 * and converts each entry into a user-role message before the next
 * turn. Returns an empty array when nothing is pending.
 */
export function drainInterrupts(): string[] {
  if (queue.length === 0) return [];
  const drained = queue.splice(0, queue.length);
  logger.debug("Interrupt queue drained", { count: drained.length });
  return drained;
}

/**
 * Peek at the queue without draining. Useful for status displays —
 * "you have N pending interrupts." Read-only.
 */
export function peekInterrupts(): readonly string[] {
  return Object.freeze([...queue]);
}

/** Current depth of the queue. Cheap O(1) read. */
export function interruptDepth(): number {
  return queue.length;
}

/**
 * Wrap a default interrupt message — the one Ctrl+C sends when the
 * operator didn't supply specific guidance. Matches the s19 pattern of
 * "stop, summarize progress, wait for instructions."
 */
export function defaultInterruptMessage(): string {
  return (
    "The operator pressed Ctrl+C to interrupt your current sequence. " +
    "Stop what you're doing immediately, summarize the work you've completed " +
    "and what remains, then wait for the operator's next instruction."
  );
}

/** Test-only — wipe the queue between tests. */
export function _resetInterruptsForTests(): void {
  queue.length = 0;
}
