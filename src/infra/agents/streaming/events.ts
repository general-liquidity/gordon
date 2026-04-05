/**
 * Agent Event Stream — Typed Events for Real-Time UI
 *
 * Instead of wrapping the agent loop in opaque promises and only surfacing
 * the final result, agents yield granular events: thinking chunks, tool
 * start/end, compaction markers, flush events, errors. The TUI subscribes
 * and renders these live, so users see exactly what Gordon is doing — not
 * a spinner that magically resolves 30 seconds later.
 *
 * This event schema is transport-agnostic. It plugs into the Ink TUI,
 * the gateway HTTP stream, action logs, and audit trails with the same
 * event types.
 */

export type AgentEventKind =
  | "start"
  | "thinking"
  | "tool_start"
  | "tool_progress"
  | "tool_end"
  | "microcompact"
  | "compact"
  | "memory_flush"
  | "context_warning"
  | "result_spilled"
  | "approval_required"
  | "queued_input_drained"
  | "iteration_end"
  | "final"
  | "error";

export interface AgentEventBase {
  kind: AgentEventKind;
  iteration: number;
  timestamp: number;
  agentName?: string;
}

export interface StartEvent extends AgentEventBase {
  kind: "start";
  query: string;
}

export interface ThinkingEvent extends AgentEventBase {
  kind: "thinking";
  chunk: string;
}

export interface ToolStartEvent extends AgentEventBase {
  kind: "tool_start";
  toolName: string;
  toolCallId: string;
  args: unknown;
}

export interface ToolProgressEvent extends AgentEventBase {
  kind: "tool_progress";
  toolCallId: string;
  message: string;
  percent?: number;
}

export interface ToolEndEvent extends AgentEventBase {
  kind: "tool_end";
  toolName: string;
  toolCallId: string;
  success: boolean;
  durationMs: number;
  /** Truncated result preview; full result may be on disk. */
  resultPreview?: string;
  spilledToDisk?: boolean;
}

export interface MicrocompactEvent extends AgentEventBase {
  kind: "microcompact";
  cleared: number;
  tokensSaved: number;
  trigger: "count" | "token";
}

export interface CompactEvent extends AgentEventBase {
  kind: "compact";
  beforeTokens: number;
  afterTokens: number;
  summary: string;
}

export interface MemoryFlushEvent extends AgentEventBase {
  kind: "memory_flush";
  written: boolean;
  contentPreview?: string;
}

export interface ContextWarningEvent extends AgentEventBase {
  kind: "context_warning";
  currentTokens: number;
  threshold: number;
  message: string;
}

export interface ResultSpilledEvent extends AgentEventBase {
  kind: "result_spilled";
  toolName: string;
  toolCallId: string;
  filePath: string;
  originalSize: number;
}

export interface ApprovalRequiredEvent extends AgentEventBase {
  kind: "approval_required";
  action: string;
  rationale: string;
  riskTier: "standard" | "high" | "critical";
}

export interface QueuedInputDrainedEvent extends AgentEventBase {
  kind: "queued_input_drained";
  count: number;
  sources: string[];
}

export interface IterationEndEvent extends AgentEventBase {
  kind: "iteration_end";
  inputTokens: number;
  outputTokens: number;
}

export interface FinalEvent extends AgentEventBase {
  kind: "final";
  content: string;
  success: boolean;
}

export interface ErrorEvent extends AgentEventBase {
  kind: "error";
  message: string;
  recoverable: boolean;
}

export type AgentEvent =
  | StartEvent
  | ThinkingEvent
  | ToolStartEvent
  | ToolProgressEvent
  | ToolEndEvent
  | MicrocompactEvent
  | CompactEvent
  | MemoryFlushEvent
  | ContextWarningEvent
  | ResultSpilledEvent
  | ApprovalRequiredEvent
  | QueuedInputDrainedEvent
  | IterationEndEvent
  | FinalEvent
  | ErrorEvent;

export type AgentEventListener = (event: AgentEvent) => void;

/**
 * Simple event emitter — the agent loop pushes events; consumers subscribe.
 */
export class AgentEventStream {
  private listeners = new Set<AgentEventListener>();
  private buffer: AgentEvent[] = [];
  private bufferLimit: number;

  constructor(options?: { bufferLimit?: number }) {
    this.bufferLimit = options?.bufferLimit ?? 500;
  }

  emit(event: AgentEvent): void {
    this.buffer.push(event);
    if (this.buffer.length > this.bufferLimit) {
      this.buffer.splice(0, this.buffer.length - this.bufferLimit);
    }
    for (const l of this.listeners) {
      try {
        l(event);
      } catch {
        // listener errors must not break the stream
      }
    }
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Recent buffered events, oldest-first. */
  recent(n?: number): AgentEvent[] {
    if (n === undefined) return [...this.buffer];
    return this.buffer.slice(-n);
  }

  clear(): void {
    this.buffer = [];
  }

  get size(): number {
    return this.buffer.length;
  }
}

/** Build an event with sensible defaults. */
export function createEvent<K extends AgentEventKind, T extends Extract<AgentEvent, { kind: K }>>(
  kind: K,
  iteration: number,
  extra: Omit<T, "kind" | "iteration" | "timestamp">,
): T {
  return {
    kind,
    iteration,
    timestamp: Date.now(),
    ...extra,
  } as T;
}
