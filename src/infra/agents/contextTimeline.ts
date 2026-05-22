/**
 * Context-timeline surface — Gordon's analogue of Daniel San's
 * `context-timeline` Claude Code hook.
 *
 * In-memory registry of active agent contexts across Gordon's
 * topology. Tracks main agent + investigation sub-agents + forks +
 * thinking/critique passes. Operator-facing visibility into "what's
 * running where + how much context each is holding."
 *
 * Token estimation is rough (chars / 4 heuristic) since Gordon doesn't
 * carry a full tokenizer at this layer. The relative comparisons
 * between contexts are accurate; the absolute counts are within
 * ±30% of true token counts — fine for "is the main agent
 * approaching its budget?" questions.
 *
 * Registry is in-memory and process-scoped — clears on session
 * boundary. For cross-session observability, the audit trail is the
 * source of truth (skill-usage.jsonl, agent-feedback.jsonl, etc.).
 *
 * Composes with:
 *   - investigation.ts (recordAgentStart / End around runInvestigation)
 *   - contextFork.ts (same, plus inherited-message-count surfacing)
 *   - thinkingPhase + critiquePhase (existing primitives — caller
 *     wires recordAgentStart/End around them)
 */

export type AgentContextType =
  | "main"
  | "investigation"
  | "fork"
  | "thinking"
  | "critique"
  | "researcher"
  | "executor";

export interface AgentContextSnapshot {
  /** Stable id — caller provides (e.g., uuid or invocation id). */
  agentId: string;
  /** Display name. */
  agentName: string;
  /** Topology classification. */
  agentType: AgentContextType;
  /** Rough token estimate from char count (chars / 4 heuristic). */
  contextTokenEstimate: number;
  /** ISO-8601 start time. */
  startedAt: string;
  /** ISO-8601 end time when complete; undefined when still active. */
  endedAt?: string;
  /** Whether the agent is currently active. */
  isActive: boolean;
  /** Parent agent id (forms a tree when present). */
  parentAgentId?: string;
  /** Tool calls made by this agent so far. */
  toolCallCount: number;
}

export interface ContextTimelineSnapshot {
  capturedAt: string;
  /** All recorded agents in the session — active + completed. */
  agents: AgentContextSnapshot[];
  /** Active count (agents still running). */
  activeCount: number;
  /** Total active context tokens estimated across all live agents. */
  totalActiveContextTokens: number;
  /** Highest context-token estimate observed at capture time. */
  largestContext: AgentContextSnapshot | null;
  /** Agents grouped by type for quick rollup. */
  byType: Record<AgentContextType, number>;
}

const STATE: {
  agents: Map<string, AgentContextSnapshot>;
  insertionOrder: string[];
} = {
  agents: new Map(),
  insertionOrder: [],
};

/**
 * Rough chars-to-tokens conversion. Anthropic + OpenAI tokenizers
 * vary but ~4 chars per token is a reasonable mid-estimate for
 * English text. Caller can override by passing exact counts.
 */
export function estimateTokensFromChars(charCount: number): number {
  return Math.ceil(charCount / 4);
}

/**
 * Estimate tokens from an array of message contents.
 */
export function estimateTokensFromMessages(
  messages: Array<{ content: string }>,
): number {
  let total = 0;
  for (const m of messages) total += m.content.length;
  return estimateTokensFromChars(total);
}

/**
 * Record the start of an agent context. Idempotent on agentId — a
 * second start with the same id updates the existing record.
 */
export function recordAgentStart(input: {
  agentId: string;
  agentName: string;
  agentType: AgentContextType;
  contextTokenEstimate: number;
  parentAgentId?: string;
  now?: () => Date;
}): void {
  const now = input.now ?? (() => new Date());
  const existing = STATE.agents.get(input.agentId);
  if (existing) {
    existing.contextTokenEstimate = input.contextTokenEstimate;
    existing.isActive = true;
    existing.endedAt = undefined;
    return;
  }
  STATE.agents.set(input.agentId, {
    agentId: input.agentId,
    agentName: input.agentName,
    agentType: input.agentType,
    contextTokenEstimate: input.contextTokenEstimate,
    startedAt: now().toISOString(),
    isActive: true,
    parentAgentId: input.parentAgentId,
    toolCallCount: 0,
  });
  STATE.insertionOrder.push(input.agentId);
}

/**
 * Update an agent's token estimate + tool count mid-run. Called
 * periodically from the agent loop. No-op when the id isn't
 * registered.
 */
export function recordAgentProgress(
  agentId: string,
  update: { contextTokenEstimate?: number; toolCallCount?: number },
): void {
  const agent = STATE.agents.get(agentId);
  if (!agent) return;
  if (update.contextTokenEstimate !== undefined) {
    agent.contextTokenEstimate = update.contextTokenEstimate;
  }
  if (update.toolCallCount !== undefined) {
    agent.toolCallCount = update.toolCallCount;
  }
}

/**
 * Mark an agent as completed. Idempotent — calling on an already-
 * ended agent is a no-op. Calling on an unknown id is also a no-op.
 */
export function recordAgentEnd(
  agentId: string,
  now: () => Date = () => new Date(),
): void {
  const agent = STATE.agents.get(agentId);
  if (!agent) return;
  if (!agent.isActive) return;
  agent.isActive = false;
  agent.endedAt = now().toISOString();
}

/**
 * Capture a snapshot of the current timeline.
 */
export function captureContextTimeline(
  now: () => Date = () => new Date(),
): ContextTimelineSnapshot {
  const agents: AgentContextSnapshot[] = [];
  let activeCount = 0;
  let totalActiveTokens = 0;
  let largest: AgentContextSnapshot | null = null;
  const byType: Record<AgentContextType, number> = {
    main: 0,
    investigation: 0,
    fork: 0,
    thinking: 0,
    critique: 0,
    researcher: 0,
    executor: 0,
  };

  for (const agentId of STATE.insertionOrder) {
    const agent = STATE.agents.get(agentId);
    if (!agent) continue;
    // Push a shallow copy so consumers can't mutate registry state
    const snap: AgentContextSnapshot = { ...agent };
    agents.push(snap);
    byType[agent.agentType] += 1;
    if (agent.isActive) {
      activeCount += 1;
      totalActiveTokens += agent.contextTokenEstimate;
      if (!largest || agent.contextTokenEstimate > largest.contextTokenEstimate) {
        largest = snap;
      }
    }
  }

  return {
    capturedAt: now().toISOString(),
    agents,
    activeCount,
    totalActiveContextTokens: totalActiveTokens,
    largestContext: largest,
    byType,
  };
}

/**
 * Reset the timeline registry. Use at session boundary or in tests.
 */
export function resetContextTimeline(): void {
  STATE.agents.clear();
  STATE.insertionOrder.length = 0;
}

/**
 * Render an operator-readable timeline. One line per agent, sorted
 * by insertion order so the operator sees the chronological flow.
 */
export function formatContextTimeline(snapshot: ContextTimelineSnapshot): string {
  if (snapshot.agents.length === 0) {
    return "(no agents recorded)";
  }

  const lines: string[] = [
    `Context Timeline @ ${snapshot.capturedAt}`,
    `  ${snapshot.activeCount} active, ${snapshot.agents.length - snapshot.activeCount} completed, ` +
      `~${snapshot.totalActiveContextTokens} active tokens`,
    "",
  ];

  if (snapshot.largestContext) {
    lines.push(
      `  Largest active: ${snapshot.largestContext.agentName} ` +
        `(${snapshot.largestContext.contextTokenEstimate} tokens)`,
    );
    lines.push("");
  }

  for (const agent of snapshot.agents) {
    const status = agent.isActive ? "●" : "○";
    const parentLabel = agent.parentAgentId ? ` (parent: ${agent.parentAgentId})` : "";
    lines.push(
      `  ${status} [${agent.agentType.padEnd(13)}] ${agent.agentName.padEnd(20)} ` +
        `${agent.contextTokenEstimate} tok, ${agent.toolCallCount} tool calls${parentLabel}`,
    );
  }

  return lines.join("\n");
}
