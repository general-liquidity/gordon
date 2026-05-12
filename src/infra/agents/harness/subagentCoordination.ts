/**
 * Subagent Coordination — fork helper, in-memory registry,
 * SendMessage envelope, TaskNotification builder.
 *
 * Inspired by Claude Code's coordinator-mode multi-agent pattern. The
 * runtime wiring (Mastra agent invocation, message routing) is left to
 * the orchestrator — these are pure helpers + a process-local registry
 * the orchestrator can consult.
 *
 * Why ship as primitives first:
 *   - Mastra integration shapes are still being explored.
 *   - The pure helpers + registry compose cleanly in tests.
 *   - Once the orchestrator opts in, no further edits to these files.
 *
 * Design:
 *   - `ForkConfig`     — what the parent passes when spawning a fork
 *   - `AgentRegistry`  — process-local map of running subagent metadata
 *   - `buildSendMessageEnvelope` — agent-to-agent message in standard shape
 *   - `buildTaskNotification`    — task-complete signal in XML envelope
 */

// ============================================================================
// Fork — context-inheriting subagent spawn
// ============================================================================

/**
 * Configuration handed to the orchestrator when spawning a fork. The
 * fork inherits the parent's system prompt + memory window, gaining
 * prompt-cache reuse on the Anthropic side. Only `task` is required;
 * everything else has a sensible default.
 */
export interface ForkConfig {
  /** Human-readable description of what the fork should do. */
  task: string;
  /** Subagent identifier — picked by caller (often "fork:" + a UUID). */
  subagentId: string;
  /** Parent's name, recorded for hook payloads / audit. */
  parentAgent: string;
  /**
   * Model preference. "inherit" = use the parent's model so prompt
   * cache stays warm. Pass an explicit model id to override (breaks
   * cache reuse but lets the fork run on a faster / cheaper model).
   */
  model: "inherit" | string;
  /**
   * Permission mode. "bubble" routes child approval prompts back to the
   * parent terminal so a single approval covers all forks; "inherit"
   * uses the parent's mode in-place.
   */
  permissionMode: "bubble" | "inherit";
  /** Maximum turns the fork is allowed before forced termination. */
  maxTurns?: number;
  /**
   * Optional structured input the fork should receive. The orchestrator
   * decides how to render this (typically prepended as a user message).
   */
  input?: Record<string, unknown>;
}

export const DEFAULT_FORK_CONFIG: Pick<ForkConfig, "model" | "permissionMode" | "maxTurns"> = {
  model: "inherit",
  permissionMode: "bubble",
  maxTurns: 20,
};

/**
 * Build a complete ForkConfig from the minimum required inputs. The
 * orchestrator hands this to Mastra's Agent.generate() (or equivalent).
 */
export function buildForkConfig(
  partial: Pick<ForkConfig, "task" | "subagentId" | "parentAgent"> & Partial<ForkConfig>,
): ForkConfig {
  return { ...DEFAULT_FORK_CONFIG, ...partial };
}

// ============================================================================
// AgentRegistry — process-local map of running subagents
// ============================================================================

export type AgentLifecycleState = "starting" | "running" | "completed" | "failed" | "aborted";

export interface RegisteredAgent {
  subagentId: string;
  subagentType: string;
  parentAgent: string;
  state: AgentLifecycleState;
  startedAt: number;
  endedAt?: number;
  task?: string;
  /** Last result emitted by the agent (set when state goes terminal). */
  result?: unknown;
  /** Error message, set when state is failed/aborted. */
  error?: string;
}

/**
 * In-memory, single-process registry. Process restart wipes it —
 * persistent tracking is the audit log's job, not this. Thread-safe
 * is irrelevant since Bun + Node are single-threaded for our use case.
 */
export class AgentRegistry {
  private readonly entries: Map<string, RegisteredAgent> = new Map();

  register(entry: Omit<RegisteredAgent, "state"> & { state?: AgentLifecycleState }): RegisteredAgent {
    const e: RegisteredAgent = {
      ...entry,
      state: entry.state ?? "starting",
    };
    this.entries.set(e.subagentId, e);
    return e;
  }

  setState(
    subagentId: string,
    state: AgentLifecycleState,
    options: { result?: unknown; error?: string; endedAt?: number } = {},
  ): RegisteredAgent | undefined {
    const e = this.entries.get(subagentId);
    if (!e) return undefined;
    e.state = state;
    if (options.result !== undefined) e.result = options.result;
    if (options.error !== undefined) e.error = options.error;
    if (state === "completed" || state === "failed" || state === "aborted") {
      e.endedAt = options.endedAt ?? Date.now();
    }
    return e;
  }

  get(subagentId: string): RegisteredAgent | undefined {
    return this.entries.get(subagentId);
  }

  /** All registered entries, optionally filtered by state. */
  list(state?: AgentLifecycleState): RegisteredAgent[] {
    const all = [...this.entries.values()];
    return state ? all.filter((e) => e.state === state) : all;
  }

  /** Drop terminal entries older than the cutoff to bound memory. */
  prune(olderThanMs: number, now: number = Date.now()): number {
    let removed = 0;
    for (const [id, e] of this.entries) {
      const isTerminal = e.state === "completed" || e.state === "failed" || e.state === "aborted";
      if (!isTerminal) continue;
      const cutoff = (e.endedAt ?? e.startedAt) + olderThanMs;
      if (cutoff <= now) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  clear(): void {
    this.entries.clear();
  }

  size(): number {
    return this.entries.size;
  }
}

// Singleton — orchestrator imports this. Tests construct their own.
let defaultRegistry: AgentRegistry | undefined;
export function getDefaultAgentRegistry(): AgentRegistry {
  if (!defaultRegistry) defaultRegistry = new AgentRegistry();
  return defaultRegistry;
}

export function _resetDefaultAgentRegistryForTests(): void {
  defaultRegistry = undefined;
}

// ============================================================================
// SendMessage — agent-to-agent message envelope
// ============================================================================

export type SendMessageKind =
  | "instruction"     // parent → child: "do this next"
  | "shutdown_request" // parent → child: "stop now"
  | "plan_approval_response" // user → child via parent: "approved"
  | "plain";          // free-form

export interface SendMessageEnvelope {
  fromAgent: string;
  toAgent: string;
  kind: SendMessageKind;
  /** Body — either a string or a structured payload (caller decides). */
  body: string | Record<string, unknown>;
  /** ISO timestamp the orchestrator stamps on emit. */
  sentAt: string;
  /** Optional id so receivers can ack / ignore duplicates. */
  messageId?: string;
}

/** Build an envelope. Orchestrator delivers it. */
export function buildSendMessageEnvelope(
  args: Omit<SendMessageEnvelope, "sentAt"> & { sentAt?: string },
): SendMessageEnvelope {
  return {
    sentAt: args.sentAt ?? new Date().toISOString(),
    ...args,
  };
}

// ============================================================================
// TaskNotification — structured task-complete signal
// ============================================================================

export interface TaskNotificationInput {
  subagentId: string;
  status: "completed" | "failed" | "aborted" | "timeout";
  summary: string;
  /** Optional structured result (JSON-stringifiable). */
  result?: unknown;
  /** Token usage if known — feeds the cost ledger. */
  usage?: { input?: number; output?: number; cacheRead?: number; cacheWrite?: number };
}

/**
 * Build the XML-shaped notification body. Renders as a single user-role
 * message the parent agent can scan in its next turn. The shape mirrors
 * Claude Code's `<task_notification>` element so plugins that already
 * parse Claude Code transcripts work unchanged.
 */
export function buildTaskNotification(input: TaskNotificationInput): string {
  const lines: string[] = ["<task_notification>"];
  lines.push(`  <subagent_id>${escapeXml(input.subagentId)}</subagent_id>`);
  lines.push(`  <status>${input.status}</status>`);
  lines.push(`  <summary>${escapeXml(input.summary)}</summary>`);
  if (input.result !== undefined) {
    lines.push("  <result>");
    lines.push(escapeXml(typeof input.result === "string" ? input.result : safeJson(input.result)));
    lines.push("  </result>");
  }
  if (input.usage) {
    const u = input.usage;
    lines.push(
      `  <usage input="${u.input ?? 0}" output="${u.output ?? 0}" cacheRead="${u.cacheRead ?? 0}" cacheWrite="${u.cacheWrite ?? 0}"/>`,
    );
  }
  lines.push("</task_notification>");
  return lines.join("\n");
}

function escapeXml(s: string): string {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}
