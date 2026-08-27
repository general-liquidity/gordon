import { emitEvent } from "../../../events/index.ts";
import { validateHandoffBudget } from "../../../gateway/handoffs/index.ts";
import { recordNetworkRouting } from "../../platform/observability/index.ts";
import { createModuleLogger } from "../../logger/index.ts";
import { WorkerRegistry } from "../../../runtime/workers/WorkerRegistry.ts";
import { classifyHandoffPayload } from "../../../core/audit/durability.ts";
import type { AbsorptionStatus, ParentAbsorptionRecord } from "../../../core/audit/types.ts";

const logger = createModuleLogger("handoff-coordinator");

export interface HandoffRecord {
  handoffId: string;
  fromAgent: string;
  toAgent: string;
  timestamp: number;
  validated: boolean;
  validationReason?: string;
  metadata?: Record<string, unknown>;
}

export interface HandoffValidation {
  valid: boolean;
  reason?: string;
  warnings?: string[];
}

/**
 * Generic message shape for least-context handoff scrubbing.
 *
 * Kept structural (not tied to `ai`'s `CoreMessage`) so the filter applies
 * uniformly to provider messages, `{ role, content }` plain objects, and
 * multi-part content arrays without coupling to a single SDK type.
 */
export interface FilterableMessage {
  role?: string;
  content?: unknown;
  [key: string]: unknown;
}

export interface SubagentContextFilterResult {
  /** Scrubbed copy of the messages (input is never mutated). */
  messages: FilterableMessage[];
  /** Whether any redaction was applied. */
  redacted: boolean;
  /** Count of individual redaction substitutions applied. */
  redactionCount: number;
  /** Whether the target agent is on the least-context filter list. */
  filteredAgent: boolean;
}

export interface DelegationFeedbackNote {
  /** Supervisor that should read the note on its next iteration. */
  supervisorAgent: string;
  /** Subagent the feedback is about. */
  subagentAgent: string;
  /** Human-readable feedback (e.g. "researcher returned no risk section — revise"). */
  note: string;
  timestamp: number;
  metadata?: Record<string, unknown>;
}

/**
 * Agents that receive a least-context handoff by default. The researcher never
 * trades (no execution permissions), so it must not see account financials.
 * Matched case-insensitively against both the worker role ("Researcher") and
 * the agent id ("researcher").
 */
const DEFAULT_LEAST_CONTEXT_AGENTS = new Set(["researcher"]);

// ── Redaction rules ─────────────────────────────────────────────────────────
// Conservative, regex-based. Two tiers:
//   ACCOUNT_STATE_RULES — balances / equity / positions. Stripped for
//     least-context agents (researcher) only; the executor legitimately needs
//     these to size and place orders.
//   SECRET_RULES — API-key-shaped tokens / PEM blocks. Stripped for EVERY
//     subagent; no agent profile needs raw credentials in its context.

const ACCOUNT_STATE_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // "balance: 12,345.67", "available balance $1,000", "free balance = 1.2345 BTC"
  {
    pattern:
      /\b(available\s+|free\s+|total\s+|account\s+)?balance\b\s*[:=]?\s*\$?\s*[\d,]+(?:\.\d+)?\s*[A-Za-z]{0,5}/gi,
    replacement: "[REDACTED_BALANCE]",
  },
  // "equity: $250,000", "net equity = 12345.67"
  {
    pattern: /\b(net\s+|account\s+)?equity\b\s*[:=]?\s*\$?\s*[\d,]+(?:\.\d+)?/gi,
    replacement: "[REDACTED_EQUITY]",
  },
  // "buying power: 50,000"
  {
    pattern: /\bbuying\s+power\b\s*[:=]?\s*\$?\s*[\d,]+(?:\.\d+)?/gi,
    replacement: "[REDACTED_BUYING_POWER]",
  },
  // "available cash: $3,200.50", "cash balance 1000"
  {
    pattern: /\b(available\s+)?cash(\s+balance)?\b\s*[:=]?\s*\$?\s*[\d,]+(?:\.\d+)?/gi,
    replacement: "[REDACTED_CASH]",
  },
  // "position: LONG 0.5 BTC", "open position 1,200 SOL", "holding 2.5 ETH"
  {
    pattern:
      /\b(open\s+)?(position|holding)s?\b\s*[:=]?\s*(LONG|SHORT|long|short)?\s*[\d,]+(?:\.\d+)?\s*[A-Za-z]{1,6}/gi,
    replacement: "[REDACTED_POSITION]",
  },
];

const SECRET_RULES: Array<{ pattern: RegExp; replacement: string }> = [
  // PEM blocks (private keys, certs) — multi-line, greedy to the END footer.
  {
    pattern: /-----BEGIN[\s\S]*?-----END[^-]*-----/g,
    replacement: "[REDACTED_PEM_BLOCK]",
  },
  // Long base64-ish / hex tokens (API keys, secrets). 32+ chars of the
  // key-charset, not part of a longer word. Catches hex digests and base64
  // secrets without nuking ordinary prose or short numbers.
  {
    pattern: /\b[A-Za-z0-9+/_-]{32,}={0,2}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
];

export class HandoffCoordinator {
  private readonly workerRegistry: WorkerRegistry;
  private readonly history: HandoffRecord[] = [];
  private counter = 0;
  /** Lowercased agent ids that get a least-context (account-state-scrubbed) handoff. */
  private readonly leastContextAgents: Set<string>;
  /** Pending post-delegation feedback, keyed by lowercased supervisor agent id. */
  private readonly delegationFeedback = new Map<string, DelegationFeedbackNote[]>();
  /** Parent-absorption records: parent step -> child trace, absorbed vs dropped. */
  private readonly absorptions: ParentAbsorptionRecord[] = [];

  constructor(workerRegistry: WorkerRegistry = new WorkerRegistry()) {
    this.workerRegistry = workerRegistry;
    this.leastContextAgents = new Set(DEFAULT_LEAST_CONTEXT_AGENTS);
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Least-context handoff (messageFilter)
  // ──────────────────────────────────────────────────────────────────────────

  /** True if the target agent receives an account-state-scrubbed handoff. */
  isLeastContextAgent(targetAgentId: string): boolean {
    return this.leastContextAgents.has(targetAgentId.toLowerCase());
  }

  /** Configure per-agent least-context filtering at runtime. */
  setLeastContextFiltering(targetAgentId: string, enabled: boolean): void {
    const key = targetAgentId.toLowerCase();
    if (enabled) {
      this.leastContextAgents.add(key);
    } else {
      this.leastContextAgents.delete(key);
    }
  }

  /**
   * Redact API-key-shaped strings and PEM blocks from a single string.
   * Applied for EVERY subagent — no agent profile needs raw credentials.
   * Returns the scrubbed text and the number of substitutions made.
   */
  private redactSecrets(text: string): { text: string; count: number } {
    let out = text;
    let count = 0;
    for (const { pattern, replacement } of SECRET_RULES) {
      out = out.replace(pattern, () => {
        count += 1;
        return replacement;
      });
    }
    return { text: out, count };
  }

  /**
   * Redact account state (balances / equity / positions / cash / buying power)
   * in addition to secrets. Applied only for least-context agents.
   */
  private redactSensitiveText(text: string): { text: string; count: number } {
    const secrets = this.redactSecrets(text);
    let out = secrets.text;
    let count = secrets.count;
    for (const { pattern, replacement } of ACCOUNT_STATE_RULES) {
      out = out.replace(pattern, () => {
        count += 1;
        return replacement;
      });
    }
    return { text: out, count };
  }

  /**
   * Walk a message's `content` (string or multi-part array) and redact every
   * text segment with the provided redactor. Non-text parts pass through
   * untouched. Returns a deep-ish copy (input is never mutated).
   */
  private redactContent(
    content: unknown,
    redactor: (text: string) => { text: string; count: number },
  ): { content: unknown; count: number } {
    if (typeof content === "string") {
      const { text, count } = redactor(content);
      return { content: text, count };
    }
    if (Array.isArray(content)) {
      let count = 0;
      const parts = content.map((part) => {
        if (typeof part === "string") {
          const r = redactor(part);
          count += r.count;
          return r.text;
        }
        if (
          part &&
          typeof part === "object" &&
          typeof (part as { text?: unknown }).text === "string"
        ) {
          const r = redactor((part as { text: string }).text);
          count += r.count;
          return { ...(part as Record<string, unknown>), text: r.text };
        }
        return part;
      });
      return { content: parts, count };
    }
    return { content, count: 0 };
  }

  /**
   * Least-context handoff: scrub sensitive state from the messages a subagent
   * will see BEFORE it receives them.
   *
   * - Secrets (API keys, PEM blocks) are stripped for every target.
   * - Account state (balances / equity / positions) is additionally stripped
   *   for least-context agents (researcher by default — it never trades).
   * - The executor keeps account financials (it needs them to size orders) but
   *   still loses raw credentials.
   *
   * The input array and its messages are never mutated; a scrubbed copy is
   * returned.
   */
  filterContextForSubagent(
    targetAgentId: string,
    messages: FilterableMessage[],
  ): SubagentContextFilterResult {
    const filteredAgent = this.isLeastContextAgent(targetAgentId);
    const redactor = filteredAgent
      ? (text: string) => this.redactSensitiveText(text)
      : (text: string) => this.redactSecrets(text);

    let redactionCount = 0;
    const scrubbed = messages.map((message) => {
      const { content, count } = this.redactContent(message.content, redactor);
      redactionCount += count;
      if (count === 0) return message;
      return { ...message, content };
    });

    return {
      messages: scrubbed,
      redacted: redactionCount > 0,
      redactionCount,
      filteredAgent,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Post-delegation feedback
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record a feedback note to inject into the supervisor's context on its next
   * iteration after a subagent returns (e.g. "researcher returned no risk
   * section — revise"). Notes are queued per supervisor and drained by
   * `consumeDelegationFeedback`.
   */
  recordDelegationFeedback(
    supervisorAgent: string,
    subagentAgent: string,
    note: string,
    metadata?: Record<string, unknown>,
  ): DelegationFeedbackNote {
    const entry: DelegationFeedbackNote = {
      supervisorAgent,
      subagentAgent,
      note,
      timestamp: Date.now(),
      metadata,
    };
    const key = supervisorAgent.toLowerCase();
    const queue = this.delegationFeedback.get(key);
    if (queue) {
      queue.push(entry);
    } else {
      this.delegationFeedback.set(key, [entry]);
    }
    logger.info("Delegation feedback recorded", {
      supervisorAgent,
      subagentAgent,
      note,
    });
    return entry;
  }

  /** Peek at pending feedback for a supervisor without draining it. */
  getDelegationFeedback(supervisorAgent: string): DelegationFeedbackNote[] {
    return [...(this.delegationFeedback.get(supervisorAgent.toLowerCase()) ?? [])];
  }

  /**
   * Drain pending feedback for a supervisor — returns the queued notes and
   * clears them so they're injected exactly once into the next iteration.
   */
  consumeDelegationFeedback(supervisorAgent: string): DelegationFeedbackNote[] {
    const key = supervisorAgent.toLowerCase();
    const queue = this.delegationFeedback.get(key) ?? [];
    this.delegationFeedback.delete(key);
    return queue;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Parent-absorption records
  // ──────────────────────────────────────────────────────────────────────────

  /**
   * Record that a parent step took up (or dropped) a delegated child's result.
   *
   * Today absorption is implicit — when `delegate_subagent`'s return lands in
   * context you cannot tell, on resume, an absorbed result from one silently
   * dropped. This makes the link explicit: parent step -> child trace, with an
   * `observed | absorbed | dropped` status.
   *
   * The record is tagged boundary-durable (reuses the "absorption" handoff kind)
   * so downstream persistence stores it lossless. Attach the returned record to
   * a trace via its unsigned `absorptions` field — it never disturbs the
   * tamper-evidence hash (see types.ts / signing.ts).
   */
  recordAbsorption(
    parentStepId: string,
    childTraceId: string,
    status: AbsorptionStatus,
    note?: string,
  ): ParentAbsorptionRecord {
    const record: ParentAbsorptionRecord = {
      parent_step_id: parentStepId,
      child_trace_id: childTraceId,
      status,
      durability_class: classifyHandoffPayload("absorption"),
      recorded_at: new Date().toISOString(),
      ...(note !== undefined ? { note } : {}),
    };
    this.absorptions.push(record);
    logger.info("Parent absorption recorded", {
      parentStepId,
      childTraceId,
      status,
    });
    return record;
  }

  /** All recorded absorption links (most-recent last). */
  getAbsorptions(): ParentAbsorptionRecord[] {
    return [...this.absorptions];
  }

  /** Absorption links for a specific parent step. */
  getAbsorptionsForStep(parentStepId: string): ParentAbsorptionRecord[] {
    return this.absorptions.filter((a) => a.parent_step_id === parentStepId);
  }

  getValidHandoffRules(): Record<string, string[]> {
    return this.workerRegistry.list().reduce<Record<string, string[]>>((acc, definition) => {
      acc[definition.name] = [...definition.handoffTargets];
      return acc;
    }, {});
  }

  validate(
    fromAgent: string,
    toAgent: string,
    context?: Record<string, unknown>,
  ): HandoffValidation {
    const warnings: string[] = [];
    if (!this.workerRegistry.has(fromAgent)) {
      return {
        valid: false,
        reason: `Unknown source agent: ${fromAgent}`,
      };
    }
    if (!this.workerRegistry.has(toAgent)) {
      return {
        valid: false,
        reason: `Unknown target agent: ${toAgent}`,
      };
    }
    if (!this.workerRegistry.canHandoff(fromAgent, toAgent)) {
      const allowedTargets = this.workerRegistry.get(fromAgent)?.handoffTargets ?? [];
      return {
        valid: false,
        reason: `Handoff from ${fromAgent} to ${toAgent} is not allowed. Allowed targets: ${allowedTargets.join(", ")}`,
      };
    }

    const recentHandoffs = this.history.slice(-10);
    const circularCount = recentHandoffs.filter(
      (handoff) => handoff.fromAgent === toAgent && handoff.toAgent === fromAgent,
    ).length;
    if (circularCount >= 3) {
      return {
        valid: false,
        reason: `Blocked circular handoff loop between ${fromAgent} and ${toAgent} (${circularCount} consecutive round-trips detected)`,
      };
    }

    const lastSecondHandoffs = this.history.filter(
      (handoff) => Date.now() - handoff.timestamp < 1000,
    );
    if (lastSecondHandoffs.length >= 5) {
      return {
        valid: false,
        reason:
          "Blocked: high handoff frequency detected (5+ handoffs in 1 second). Possible infinite loop.",
      };
    }

    if (toAgent === "Executor" && context?.permissionMode === "strict") {
      warnings.push("Handoff to Executor while permissionMode is 'strict' (read-only)");
    }

    const budgetValidation = validateHandoffBudget({
      fromAgent,
      toAgent,
      metadata: context,
    });
    if (!budgetValidation.valid) {
      return {
        valid: false,
        reason: budgetValidation.reason || "Handoff budget validation failed.",
      };
    }
    if (budgetValidation.warnings && budgetValidation.warnings.length > 0) {
      warnings.push(...budgetValidation.warnings);
    }

    return {
      valid: true,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  async track(
    fromAgent: string,
    toAgent: string,
    metadata?: Record<string, unknown>,
  ): Promise<HandoffRecord> {
    const handoffId = `handoff_${Date.now()}_${++this.counter}`;
    const validation = this.validate(fromAgent, toAgent, metadata);
    const record: HandoffRecord = {
      handoffId,
      fromAgent,
      toAgent,
      timestamp: Date.now(),
      validated: validation.valid,
      validationReason: validation.reason,
      metadata,
    };
    this.history.push(record);
    recordNetworkRouting(fromAgent, toAgent);
    if (this.history.length > 100) {
      this.history.shift();
    }

    await emitEvent("agent:handoff_ack", {
      fromAgent,
      toAgent,
      validated: validation.valid,
      reason: validation.reason || validation.warnings?.join("; "),
      handoffId,
    });

    if (validation.valid) {
      logger.info("Agent handoff tracked", {
        handoffId,
        fromAgent,
        toAgent,
        warnings: validation.warnings,
      });
    } else {
      logger.warn("Invalid agent handoff attempted", {
        handoffId,
        fromAgent,
        toAgent,
        reason: validation.reason,
      });
    }

    return record;
  }

  getHistory(limit: number = 20): HandoffRecord[] {
    return this.history.slice(-limit);
  }

  clear(): void {
    this.history.length = 0;
    this.counter = 0;
    this.delegationFeedback.clear();
    this.absorptions.length = 0;
  }
}

export const defaultHandoffCoordinator = new HandoffCoordinator();
