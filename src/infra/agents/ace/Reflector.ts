/**
 * ACE Reflector — analyzes recent trades and decisions for recurring patterns
 *
 * Part of the ACE (Agentic Context Engineering) loop:
 *   Reflector  → analyzes past trades/decisions, extracts lesson candidates
 *   Curator    → ranks/dedupes lessons and writes them to ~/.gordon/ace-lessons.json
 *
 * The Curator output file is read by future Gordon sessions and injected into
 * the system prompt so accumulated lessons persist across sessions.
 *
 * SCAFFOLD STATUS — gated behind GORDON_ACE_ENABLED=true. Not auto-wired into
 * the orchestrator default path. A future sprint can enable it via a periodic
 * job, a `/ace reflect` command, or an autonomous cycle hook.
 */

import { listActionLogEntries } from "../../action-log/store.ts";
import type { ActionLogEntry } from "../../action-log/types.ts";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("ace-reflector");

export interface ACELessonCandidate {
  /** Short human-readable lesson text */
  text: string;
  /** Free-form category bucket — the Curator may merge across these */
  category:
    | "execution_failure"
    | "execution_success"
    | "venue_quirk"
    | "strategy_decay"
    | "risk_event"
    | "user_preference"
    | "operational"
    | "agent_self_block"
    | "approved_plan_rationale"
    | "cancel_rationale";
  /** Number of distinct historical events that support this lesson */
  evidenceCount: number;
  /** First seen timestamp (ms epoch) */
  firstSeenAt: number;
  /** Last seen timestamp (ms epoch) */
  lastSeenAt: number;
}

export interface ReflectorInput {
  /** Limit the analysis window to the last N action-log entries */
  lookbackEntries?: number;
  /** Optional thread filter — defaults to all threads */
  threadId?: string;
}

export interface ReflectorOutput {
  candidates: ACELessonCandidate[];
  entriesAnalyzed: number;
  generatedAt: string;
}

/**
 * Feature flag for the ACE pipeline. Both Reflector and Curator no-op when
 * this returns false so callers don't need to guard separately.
 */
export function isACEEnabled(): boolean {
  return process.env.GORDON_ACE_ENABLED === "true";
}

const PATTERN_RULES: Array<{
  category: ACELessonCandidate["category"];
  match: (entry: ActionLogEntry) => string | null;
}> = [
  {
    category: "execution_failure",
    match: (e) => {
      if (e.entryType !== "execution_result" && e.entryType !== "execution_attempt") return null;
      const text = `${e.title} ${e.content}`.toLowerCase();
      if (/(rejected|blocked|failed|insufficient|denied|error)/.test(text)) {
        const venue = (e.payload?.venue ?? e.payload?.exchange ?? "venue") as string;
        return `Execution attempts on ${venue} have failed before — pre-validate balance and policy gates first.`;
      }
      return null;
    },
  },
  {
    category: "execution_success",
    match: (e) => {
      if (e.entryType !== "execution_result") return null;
      const text = `${e.title} ${e.content}`.toLowerCase();
      if (/(filled|executed|success|complete)/.test(text) && !/fail|reject|block/.test(text)) {
        const symbol = (e.payload?.symbol ?? "symbol") as string;
        return `${symbol} executions have completed cleanly previously — keep the same routing path unless venue conditions changed.`;
      }
      return null;
    },
  },
  {
    category: "venue_quirk",
    match: (e) => {
      if (e.entryType !== "run_status" && e.entryType !== "tool_result") return null;
      const text = `${e.title} ${e.content}`.toLowerCase();
      if (/(rate.?limit|throttle|429|maintenance|degraded)/.test(text)) {
        return "Venue/provider rate-limits or degradations have happened before — back off and narrow scope on retries.";
      }
      return null;
    },
  },
  {
    category: "strategy_decay",
    match: (e) => {
      if (e.entryType !== "decay_report" && e.entryType !== "validation_report") return null;
      const text = `${e.title} ${e.content}`.toLowerCase();
      if (/(decay|stale|edge.lost|underperform|degrad)/.test(text)) {
        return "A strategy was previously flagged as decaying — re-validate before sizing new positions on it.";
      }
      return null;
    },
  },
  {
    category: "risk_event",
    match: (e) => {
      const text = `${e.title} ${e.content}`.toLowerCase();
      if (/(drawdown|liquidat|stop.?loss hit|risk breach|over.size)/.test(text)) {
        return "Risk events (drawdown, liquidation, stop-loss) have occurred — re-check sizing rules before next entry.";
      }
      return null;
    },
  },
  {
    category: "user_preference",
    match: (e) => {
      if (e.entryType !== "user_message") return null;
      const text = e.content.toLowerCase();
      if (/(i prefer|always|never|avoid|don'?t|do not).{1,80}/.test(text) && text.length < 400) {
        const trimmed = e.content.trim();
        return `User preference recorded: "${trimmed.slice(0, 140)}".`;
      }
      return null;
    },
  },
  {
    category: "operational",
    match: (e) => {
      if (e.entryType !== "venue_change" && e.entryType !== "profile_change" && e.entryType !== "model_change") {
        return null;
      }
      return `Operator-level change observed (${e.entryType}) — confirm the change is reflected in the active session.`;
    },
  },
  {
    // Bridges report_blocked → ACE. The agent-feedback tool emits a
    // run_status entry titled "Agent reported blocked (severity: X)" with
    // intent + blocker text in the content. When this recurs, ACE should
    // surface the pattern so future sessions either avoid the trap or
    // escalate earlier instead of retrying the same approach.
    category: "agent_self_block",
    match: (e) => {
      if (e.entryType !== "run_status") return null;
      const text = `${e.title} ${e.content}`.toLowerCase();
      if (!/(reported blocked|agent.*stuck|self.?block)/.test(text)) return null;
      const intent = (e.payload?.intent as string | undefined)?.trim();
      const blocker = (e.payload?.blocker as string | undefined)?.trim();
      if (intent && blocker) {
        return `Agent has previously hit blockers on similar intents (e.g. "${intent.slice(0, 80)}" — blocker: "${blocker.slice(0, 80)}"). Surface this constraint earlier instead of retrying the same approach.`;
      }
      return "Agent has self-reported being blocked on a similar pattern before — escalate via report_blocked sooner rather than retrying.";
    },
  },
  {
    // Bridges execute_plan rationale → ACE. When execute_plan succeeds it
    // appends an action_log entry containing the user-articulated rationale
    // in both content (text-searchable) and payload (structured). Captures
    // the *kinds of rationales* the user has previously approved, which is
    // higher-signal than the generic "executions have completed cleanly".
    category: "approved_plan_rationale",
    match: (e) => {
      if (e.entryType !== "execution_result") return null;
      const rationale = (e.payload?.rationale as string | undefined)?.trim();
      if (!rationale || rationale.length < 10) return null;
      const text = `${e.title} ${e.content}`.toLowerCase();
      if (/fail|reject|block/.test(text)) return null;
      const symbol = (e.payload?.symbol as string | undefined) ?? "the asset";
      return `User has previously approved similar ${symbol} plans by articulating reasoning like "${rationale.slice(0, 100)}". Confirm comparable conditions hold before proposing the next entry.`;
    },
  },
  {
    // Bridges cancel_* tool rationales → ACE. Mirrors approved_plan_rationale
    // but for cancellations: cancel_order / cancel_all_orders /
    // cancel_replace_order / cancel_order_list all append an
    // execution_result entry with payload.kind === "cancel" and the
    // verbatim rationale in payload.rationale. Captures the *kinds of
    // reasons* the user has previously cited for cancellation, so future
    // sessions can pattern-match before re-entering a setup that was just
    // exited for an articulated reason.
    category: "cancel_rationale",
    match: (e) => {
      if (e.entryType !== "execution_result") return null;
      if (e.payload?.kind !== "cancel") return null;
      const rationale = (e.payload?.rationale as string | undefined)?.trim();
      if (!rationale || rationale.length < 10) return null;
      const symbol = (e.payload?.symbol as string | undefined) ?? "the asset";
      return `User has previously cancelled ${symbol} orders citing reasons like "${rationale.slice(0, 100)}". Before re-entering, confirm the original invalidation no longer holds.`;
    },
  },
];

function dedupeKey(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().slice(0, 80);
}

/**
 * Run the Reflector — scan recent action-log entries for recurring patterns
 * and return lesson candidates. Pure analysis, no LLM call. Returns empty
 * output when ACE is disabled.
 */
export function runReflector(input: ReflectorInput = {}): ReflectorOutput {
  const generatedAt = new Date().toISOString();
  if (!isACEEnabled()) {
    logger.debug("ACE disabled — skipping Reflector");
    return { candidates: [], entriesAnalyzed: 0, generatedAt };
  }

  const lookback = input.lookbackEntries ?? 200;
  let entries: ActionLogEntry[] = [];
  try {
    entries = listActionLogEntries({
      threadId: input.threadId,
      limit: lookback,
    });
  } catch (error) {
    logger.warn("Reflector could not read action log", { error: (error as Error).message });
    return { candidates: [], entriesAnalyzed: 0, generatedAt };
  }

  const buckets = new Map<string, ACELessonCandidate>();

  for (const entry of entries) {
    const ts = Date.parse(entry.createdAt);
    const tsMs = Number.isFinite(ts) ? ts : Date.now();
    for (const rule of PATTERN_RULES) {
      const text = rule.match(entry);
      if (!text) continue;
      const key = `${rule.category}::${dedupeKey(text)}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.evidenceCount += 1;
        existing.firstSeenAt = Math.min(existing.firstSeenAt, tsMs);
        existing.lastSeenAt = Math.max(existing.lastSeenAt, tsMs);
      } else {
        buckets.set(key, {
          text,
          category: rule.category,
          evidenceCount: 1,
          firstSeenAt: tsMs,
          lastSeenAt: tsMs,
        });
      }
    }
  }

  const candidates = [...buckets.values()].sort((a, b) => b.evidenceCount - a.evidenceCount);
  return { candidates, entriesAnalyzed: entries.length, generatedAt };
}

/**
 * Apply every pattern rule to a single action log entry. Returns the
 * matched lesson texts paired with their category. Used by tests to verify
 * individual rule behavior without spinning up the action-log store.
 */
export function _applyPatternRulesForTest(
  entry: ActionLogEntry,
): Array<{ category: ACELessonCandidate["category"]; text: string }> {
  const out: Array<{ category: ACELessonCandidate["category"]; text: string }> = [];
  for (const rule of PATTERN_RULES) {
    const text = rule.match(entry);
    if (text) out.push({ category: rule.category, text });
  }
  return out;
}
