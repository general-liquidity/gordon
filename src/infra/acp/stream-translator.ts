/**
 * Translate Gordon orchestrator StreamEvents to ACP session/update notifications.
 *
 * Gordon's orchestrator (processMessageStream) emits StreamEvent objects
 * tagged by `type`. The ACP SDK accepts session/update notifications
 * with a `sessionUpdate` discriminator. This translator maps between
 * the two surfaces.
 *
 * Mapping table:
 *
 *   Gordon StreamEvent         →   ACP sessionUpdate
 *   ─────────────────────────       ─────────────────────────
 *   text_delta                     agent_message_chunk
 *   thinking_delta                 agent_thought_chunk
 *   tool_call_start                tool_call (status: pending)
 *   tool_call_end                  tool_call_update (completed/failed)
 *   agent_switch                   agent_thought_chunk (informational)
 *   step_complete                  (no-op — internal progress signal)
 *   done                           (terminal — caller returns end_turn)
 *   error                          agent_message_chunk + caller returns refusal
 *   cancelled                      (terminal — caller returns cancelled)
 *
 * Tool kind classification follows ACP's enum:
 *   read | edit | delete | move | search | execute | think | fetch | switch_mode | other
 *
 * Tool kinds are inferred from the Gordon tool name prefix because
 * Gordon's internal tool registry doesn't carry an ACP-style kind label.
 * The classification is best-effort; falls back to `other` when unmapped.
 */

import { randomUUID } from "node:crypto";
import type { ToolKind } from "@agentclientprotocol/sdk";
import type { StreamEvent } from "../agents/orchestrator/types.ts";

// ---------------------------------------------------------------------------
// Tool name → ACP kind classifier
// ---------------------------------------------------------------------------

const TOOL_KIND_PREFIXES: Array<{ prefix: string; kind: ToolKind }> = [
  // Read / fetch
  { prefix: "get_", kind: "fetch" },
  { prefix: "fetch_", kind: "fetch" },
  { prefix: "list_", kind: "fetch" },
  { prefix: "read_", kind: "read" },
  { prefix: "load_", kind: "read" },
  { prefix: "show_", kind: "fetch" },
  // Search
  { prefix: "search_", kind: "search" },
  { prefix: "find_", kind: "search" },
  { prefix: "scan_", kind: "search" },
  { prefix: "grep_", kind: "search" },
  { prefix: "discover_", kind: "search" },
  // Think / analyze
  { prefix: "analyze_", kind: "think" },
  { prefix: "evaluate_", kind: "think" },
  { prefix: "classify_", kind: "think" },
  { prefix: "check_", kind: "think" },
  { prefix: "review_", kind: "think" },
  { prefix: "explain_", kind: "think" },
  // Edit / write
  { prefix: "write_", kind: "edit" },
  { prefix: "edit_", kind: "edit" },
  { prefix: "update_", kind: "edit" },
  { prefix: "set_", kind: "edit" },
  { prefix: "save_", kind: "edit" },
  // Delete / cancel
  { prefix: "cancel_", kind: "delete" },
  { prefix: "delete_", kind: "delete" },
  { prefix: "remove_", kind: "delete" },
  { prefix: "close_", kind: "delete" },
  // Execute / trade
  { prefix: "execute_", kind: "execute" },
  { prefix: "place_", kind: "execute" },
  { prefix: "submit_", kind: "execute" },
  { prefix: "run_", kind: "execute" },
  { prefix: "swap_", kind: "execute" },
  { prefix: "transfer_", kind: "execute" },
  { prefix: "approve_", kind: "execute" },
  { prefix: "deploy_", kind: "execute" },
  { prefix: "trade_", kind: "execute" },
  { prefix: "buy_", kind: "execute" },
  { prefix: "sell_", kind: "execute" },
  { prefix: "open_", kind: "execute" },
];

export function classifyToolKind(toolName: string): ToolKind {
  const lower = toolName.toLowerCase();
  for (const { prefix, kind } of TOOL_KIND_PREFIXES) {
    if (lower.startsWith(prefix)) return kind;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Humanize tool name for the ACP `title` field
// ---------------------------------------------------------------------------

export function humanizeToolName(toolName: string): string {
  // get_trade_history → "Get trade history"
  const words = toolName.split("_").filter(Boolean);
  if (words.length === 0) return toolName;
  return [
    words[0]!.charAt(0).toUpperCase() + words[0]!.slice(1).toLowerCase(),
    ...words.slice(1).map((w) => w.toLowerCase()),
  ].join(" ");
}

// ---------------------------------------------------------------------------
// Translator
// ---------------------------------------------------------------------------

/**
 * Resolution of a stream event: zero or more ACP notifications to emit,
 * plus an optional terminal stop signal.
 */
export interface TranslatedEvent {
  /** ACP `session/update` payloads to send via connection.sessionUpdate. */
  updates: Array<{ sessionUpdate: string; [k: string]: unknown }>;
  /** Terminal stop reason — when set, the caller should stop the loop. */
  stop?: "end_turn" | "cancelled" | "refusal";
  /** Optional accumulator hint: piece of assistant text to remember in history. */
  textForHistory?: string;
}

/**
 * Stateful translator — maintains tool-call-id ↔ toolCallStart map so
 * tool_call_end events can reference the matching tool_call_id.
 */
export class StreamTranslator {
  /** Maps `toolName + stepIndex` → ACP toolCallId so the _end event finds it. */
  private toolCallIds = new Map<string, string>();

  translate(event: StreamEvent): TranslatedEvent {
    switch (event.type) {
      case "text_delta": {
        if (!event.content) return { updates: [] };
        return {
          updates: [
            {
              sessionUpdate: "agent_message_chunk",
              content: { type: "text", text: event.content },
            },
          ],
          textForHistory: event.content,
        };
      }

      case "thinking_delta": {
        if (!event.content) return { updates: [] };
        return {
          updates: [
            {
              sessionUpdate: "agent_thought_chunk",
              content: { type: "text", text: event.content },
            },
          ],
        };
      }

      case "tool_call_start": {
        if (!event.toolName) return { updates: [] };
        const toolCallId = `tc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
        const key = this.toolCallKey(event);
        this.toolCallIds.set(key, toolCallId);
        return {
          updates: [
            {
              sessionUpdate: "tool_call",
              toolCallId,
              title: humanizeToolName(event.toolName),
              kind: classifyToolKind(event.toolName),
              status: "pending",
              rawInput: event.toolArgs ?? {},
            },
          ],
        };
      }

      case "tool_call_end": {
        if (!event.toolName) return { updates: [] };
        const key = this.toolCallKey(event);
        const toolCallId = this.toolCallIds.get(key);
        if (!toolCallId) {
          // Untracked end event (start was missed) — synthesize a fresh
          // tool_call + tool_call_update pair so the editor still sees it.
          const newId = `tc_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
          return {
            updates: [
              {
                sessionUpdate: "tool_call",
                toolCallId: newId,
                title: humanizeToolName(event.toolName),
                kind: classifyToolKind(event.toolName),
                status: "completed",
                rawOutput: event.toolResult,
              },
            ],
          };
        }
        this.toolCallIds.delete(key);
        const status = event.error ? "failed" : "completed";
        const update: { sessionUpdate: string; [k: string]: unknown } = {
          sessionUpdate: "tool_call_update",
          toolCallId,
          status,
        };
        if (event.toolResult !== undefined) update.rawOutput = event.toolResult;
        return { updates: [update] };
      }

      case "agent_switch": {
        if (!event.agentName) return { updates: [] };
        return {
          updates: [
            {
              sessionUpdate: "agent_thought_chunk",
              content: {
                type: "text",
                text: `[handoff → ${event.agentName}]`,
              },
            },
          ],
        };
      }

      case "step_complete": {
        // Internal milestone — no ACP equivalent. Skip silently.
        return { updates: [] };
      }

      case "done": {
        return { updates: [], stop: "end_turn" };
      }

      case "cancelled": {
        return { updates: [], stop: "cancelled" };
      }

      case "error": {
        const message = event.error ?? "unknown error";
        return {
          updates: [
            {
              sessionUpdate: "agent_message_chunk",
              content: {
                type: "text",
                text: `[gordon error] ${message}`,
              },
            },
          ],
          stop: "refusal",
        };
      }

      default:
        // Future StreamEvent.type variants — pass silently rather than crashing
        return { updates: [] };
    }
  }

  private toolCallKey(event: StreamEvent): string {
    const idx = event.stepIndex ?? 0;
    return `${event.toolName}:${idx}`;
  }
}
