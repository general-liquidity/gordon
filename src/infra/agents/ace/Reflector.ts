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
    | "operational";
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
