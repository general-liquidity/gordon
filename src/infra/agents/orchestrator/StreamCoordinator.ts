import type { StreamEvent } from "./types.ts";

export interface MessageStreamChunk {
  type: StreamEvent["type"];
  content?: string;
  toolName?: string;
  toolArgs?: Record<string, unknown>;
  toolResult?: unknown;
  agentName?: string;
  error?: string;
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

export function toMessageStreamChunk(event: StreamEvent): MessageStreamChunk {
  return {
    type: event.type,
    content: event.content,
    toolName: event.toolName,
    toolArgs: event.toolArgs,
    toolResult: event.toolResult,
    agentName: event.agentName,
    error: event.error,
    usage: event.usage,
  };
}

