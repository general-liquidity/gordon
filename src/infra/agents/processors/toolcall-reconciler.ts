/**
 * Gordon Tool-Call Reconciler Processor
 *
 * Mastra InputProcessor wrapping `reconcileToolCalls` from
 * src/infra/agents/runtime/toolCallReconciler.ts. Runs pre-turn and
 * repairs dangling tool_use blocks (assistant emitted a tool_use whose
 * matching tool_result was never produced) by synthesizing minimal
 * tool_result blocks. Without repair, providers (Anthropic in
 * particular) reject the next turn until pairing is complete.
 *
 * Failure modes addressed:
 *   - doom-loop force-stop fires mid-tool-call
 *   - permission engine denies after dispatch
 *   - timeout / process crash / manual cancel during tool exec
 *   - network drop between tool_call emission and tool_result
 *
 * The processor scans the incoming messages array and applies repairs;
 * when there is nothing dangling it returns the messages unchanged.
 *
 * Wired into all three agents' inputProcessors. Order matters: this
 * processor runs BEFORE the input guard (no upstream guard can act on
 * a malformed structure) and BEFORE the TokenLimiterProcessor (so the
 * synthesized tool_result blocks are counted in the token budget).
 *
 * The processor relies on per-turn known-interruption hints from the
 * runtime harness via a module-scoped queue. The harness emits
 * (call_id, reason, partialState) entries when it force-stops a tool;
 * the processor drains the queue and feeds it to the reconciler as
 * `knownInterruptions`. Unknown dangling calls fall back to
 * reason="unknown".
 */

import type {
  Processor,
  ProcessInputArgs,
  ProcessInputResult,
} from "@mastra/core/processors";
import {
  reconcileToolCalls,
  type InterruptionReason,
} from "../runtime/toolCallReconciler.ts";

interface KnownInterruption {
  reason: InterruptionReason;
  partialState?: Record<string, unknown>;
  /** When the interruption was reported. Used for FIFO ordering only. */
  reportedAt: number;
}

// Module-scoped queue of known interruptions. The runtime harness (and
// other interruption emitters) push into this map when they force-stop
// a tool call. The processor drains entries for ids it actually finds
// dangling in the message array; unconsumed entries persist for the
// next turn (bounded by `MAX_QUEUE_SIZE`).
const knownInterruptionQueue = new Map<string, KnownInterruption>();
const MAX_QUEUE_SIZE = 64;

/**
 * Report a known tool-call interruption so the next reconciliation pass
 * can attribute the synthesized tool_result correctly. Called by the
 * runtime harness when it force-stops a tool call, by the permission
 * engine when it denies after dispatch, etc.
 *
 * If the queue exceeds MAX_QUEUE_SIZE, the oldest entry is evicted to
 * make room. The queue is FIFO; older entries are dropped first.
 */
export function reportToolCallInterruption(
  callId: string,
  reason: InterruptionReason,
  partialState?: Record<string, unknown>,
): void {
  if (!callId) return;
  // Evict oldest if at capacity (drop entries reportedAt earlier).
  if (
    knownInterruptionQueue.size >= MAX_QUEUE_SIZE &&
    !knownInterruptionQueue.has(callId)
  ) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [key, value] of knownInterruptionQueue) {
      if (value.reportedAt < oldestTime) {
        oldestTime = value.reportedAt;
        oldestKey = key;
      }
    }
    if (oldestKey) knownInterruptionQueue.delete(oldestKey);
  }
  knownInterruptionQueue.set(callId, {
    reason,
    partialState,
    reportedAt: Date.now(),
  });
}

/**
 * Drain entries whose ids appear in the supplied set, returning a map
 * suitable for `reconcileToolCalls`. Unconsumed entries remain in the
 * queue. Exposed for tests.
 */
export function drainKnownInterruptions(
  ids: ReadonlySet<string>,
): Map<string, { reason: InterruptionReason; partialState?: Record<string, unknown> }> {
  const drained = new Map<
    string,
    { reason: InterruptionReason; partialState?: Record<string, unknown> }
  >();
  for (const id of ids) {
    const entry = knownInterruptionQueue.get(id);
    if (entry) {
      drained.set(id, {
        reason: entry.reason,
        partialState: entry.partialState,
      });
      knownInterruptionQueue.delete(id);
    }
  }
  return drained;
}

/** Test helper — clear the queue. Not exported in index.ts. */
export function _resetKnownInterruptionsForTests(): void {
  knownInterruptionQueue.clear();
}

/** Test helper — peek queue size. Not exported in index.ts. */
export function _knownInterruptionQueueSizeForTests(): number {
  return knownInterruptionQueue.size;
}

interface MessageLike {
  role?: unknown;
  content?: unknown;
  [key: string]: unknown;
}

function findToolUseIds(messages: ReadonlyArray<MessageLike>): Set<string> {
  const ids = new Set<string>();
  for (const msg of messages) {
    if (msg && (msg.role === "assistant") && Array.isArray(msg.content)) {
      for (const part of msg.content as unknown[]) {
        if (typeof part !== "object" || part === null) continue;
        const p = part as Record<string, unknown>;
        if (p.type !== "tool-call" && p.type !== "tool_use") continue;
        const id =
          (p.id as string | undefined) ??
          (p.toolCallId as string | undefined) ??
          (p.tool_use_id as string | undefined) ??
          (p.toolUseId as string | undefined);
        if (typeof id === "string" && id.length > 0) ids.add(id);
      }
    }
  }
  return ids;
}

export class GordonToolCallReconciler
  implements Processor<"gordon-toolcall-reconciler">
{
  readonly id = "gordon-toolcall-reconciler" as const;
  readonly name = "Gordon Tool-Call Reconciler";
  readonly description =
    "Repairs dangling tool_use blocks pre-turn by synthesizing minimal tool_result blocks so providers accept the next turn.";

  async processInput(args: ProcessInputArgs): Promise<ProcessInputResult> {
    const messages = args.messages as unknown as MessageLike[];
    if (!Array.isArray(messages) || messages.length === 0) {
      return args.messages;
    }

    // Drain known-interruption hints for ids present in the message array.
    const toolUseIds = findToolUseIds(messages);
    const knownInterruptions = drainKnownInterruptions(toolUseIds);

    const result = reconcileToolCalls({
      messages: messages as ReadonlyArray<Record<string, unknown>>,
      knownInterruptions,
      defaultReason: "unknown",
    });

    if (result.repairCount === 0) {
      return args.messages;
    }

    // Mastra's ProcessInputResult expects MastraMessageV2/V3-shape. The
    // reconciler emits AI-SDK kebab-case shape ({ type: "tool-result",
    // toolCallId, toolName, result, isError }). This is the same shape
    // Mastra uses for tool-result content parts internally, so the cast
    // is safe; downstream providers will translate as needed.
    return result.reconciledMessages as unknown as ProcessInputResult;
  }
}
