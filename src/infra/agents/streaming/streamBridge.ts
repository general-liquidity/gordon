/**
 * Stream Bridge: Wire AgentEventStream into Mastra's Stream Processor
 *
 * Mastra emits coarse StreamEvent chunks (text_delta, tool_call_start, etc.)
 * This bridge translates them into Gordon's fine-grained AgentEvent taxonomy
 * and emits to the shared AgentEventStream. Existing TUI code continues to
 * consume Mastra's StreamEvent unchanged; new consumers subscribe to AgentEvent.
 *
 * Integration: Call `bridgeStreamEvents(mastraChunk, iteration)` from the
 * stream processor loop for each incoming Mastra chunk.
 */

import { emitAgentEvent } from "./coordinator.ts";
import { createEvent, type AgentEventKind, type AgentEvent } from "./events.ts";

interface MastraStreamChunk {
  type: string;
  content?: string;
  toolName?: string;
  toolCallId?: string;
  agentName?: string;
  args?: unknown;
  usage?: { inputTokens?: number; outputTokens?: number };
  [key: string]: unknown;
}

const toolStartTimes = new Map<string, number>();

/**
 * Translate a Mastra StreamEvent chunk into Gordon AgentEvent(s).
 * Some Mastra events map 1:1; others synthesize new events.
 */
export function bridgeStreamEvent(chunk: MastraStreamChunk, iteration: number): void {
  switch (chunk.type) {
    // ── Agent lifecycle ──
    case "agent-execution-start":
      emitAgentEvent(createEvent("start", iteration, {
        query: (chunk.content ?? "") as string,
        agentName: chunk.agentName,
      }));
      break;

    // ── Thinking / text ──
    case "routing-agent-text-delta":
    case "agent-execution-event-text-delta":
      if (chunk.content) {
        emitAgentEvent(createEvent("thinking", iteration, {
          chunk: chunk.content,
          agentName: chunk.agentName,
        }));
      }
      break;

    // ── Tool calls ──
    case "tool-call-start":
      if (chunk.toolCallId) {
        toolStartTimes.set(chunk.toolCallId, Date.now());
      }
      emitAgentEvent(createEvent("tool_start", iteration, {
        toolName: chunk.toolName ?? "unknown",
        toolCallId: chunk.toolCallId ?? "",
        args: chunk.args,
        agentName: chunk.agentName,
      }));
      break;

    case "tool-call-streaming":
      if (chunk.toolCallId && chunk.content) {
        emitAgentEvent(createEvent("tool_progress", iteration, {
          toolCallId: chunk.toolCallId,
          message: chunk.content,
          agentName: chunk.agentName,
        }));
      }
      break;

    case "tool-call-result":
    case "tool-call-end": {
      const startTime = chunk.toolCallId ? toolStartTimes.get(chunk.toolCallId) : undefined;
      const durationMs = startTime ? Date.now() - startTime : 0;
      if (chunk.toolCallId) toolStartTimes.delete(chunk.toolCallId);

      emitAgentEvent(createEvent("tool_end", iteration, {
        toolName: chunk.toolName ?? "unknown",
        toolCallId: chunk.toolCallId ?? "",
        success: !(chunk as { error?: unknown }).error,
        durationMs,
        resultPreview: typeof chunk.content === "string" ? chunk.content.slice(0, 200) : undefined,
        agentName: chunk.agentName,
      }));
      break;
    }

    // ── Usage / iteration end ──
    case "usage":
    case "step-finish":
      if (chunk.usage) {
        emitAgentEvent(createEvent("iteration_end", iteration, {
          inputTokens: chunk.usage.inputTokens ?? 0,
          outputTokens: chunk.usage.outputTokens ?? 0,
          agentName: chunk.agentName,
        }));
      }
      break;

    // ── Done ──
    case "done":
    case "finish":
      emitAgentEvent(createEvent("final", iteration, {
        content: chunk.content ?? "",
        success: true,
        agentName: chunk.agentName,
      }));
      break;

    case "error":
      emitAgentEvent(createEvent("error", iteration, {
        message: chunk.content ?? (chunk as { error?: string }).error ?? "Unknown error",
        recoverable: false,
        agentName: chunk.agentName,
      }));
      break;

    // Other Mastra events (handoff, etc.) — no-op for now.
    default:
      break;
  }
}

/** Reset internal state (call between sessions). */
export function resetStreamBridge(): void {
  toolStartTimes.clear();
}
