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
    | "cancel_rationale"
    | "aggregate_pattern";
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

// ============================================================================
// Aggregate pattern rules — see across-session patterns invisible per-trace
// ============================================================================
//
// The Sentra "company brain" framing + HALO's Terminal-Bench finding converged
// on the same insight: some patterns only exist when you look at the trace
// corpus as a whole, not one entry at a time. The per-entry PATTERN_RULES
// above can't detect "user has cancelled 4 orders citing 'changed my mind'
// across 3 different symbols this week" because each individual cancel
// looks reasonable in isolation.
//
// AggregatePatternRule operates on the full entry array. Each rule returns
// zero or more lesson candidates with their own evidence counts. Aggregate
// rules should be conservative — only emit when the pattern is statistically
// meaningful (sample-size floor + ratio threshold), or they'll spam.

export interface AggregateCandidate {
  text: string;
  firstSeenAt: number;
  lastSeenAt: number;
  evidenceCount: number;
}

type AggregatePatternRule = {
  category: ACELessonCandidate["category"];
  match: (entries: ReadonlyArray<ActionLogEntry>) => AggregateCandidate[];
};

const BROAD_EXPLORATION_TOOLS = new Set([
  "scan_market",
  "get_candles",
  "get_orderbook",
  "get_trending_tokens",
  "search_packages",
  "list_markets",
  "list_open_orders",
  "list_trades",
]);

const MIN_SESSIONS_FOR_AGGREGATE = 3;

function bucketBySession(
  entries: ReadonlyArray<ActionLogEntry>,
): Map<string, ActionLogEntry[]> {
  const sessions = new Map<string, ActionLogEntry[]>();
  for (const e of entries) {
    const sid = e.sessionId ?? e.threadId ?? "default";
    let list = sessions.get(sid);
    if (!list) {
      list = [];
      sessions.set(sid, list);
    }
    list.push(e);
  }
  return sessions;
}

function entryTimestamp(e: ActionLogEntry): number {
  const t = Date.parse(e.createdAt);
  return Number.isFinite(t) ? t : Date.now();
}

const AGGREGATE_PATTERN_RULES: ReadonlyArray<AggregatePatternRule> = [
  // Rule: first-action breadth. If the first tool call across recent
  // sessions falls into the broad-exploration set >40% of the time, the
  // agent is defaulting to wide scans before narrowing — HALO's exact
  // Terminal-Bench finding ("first command too generic"). Surface as a
  // meta-lesson so future sessions consider starting targeted.
  {
    category: "aggregate_pattern",
    match: (entries) => {
      const sessions = bucketBySession(entries);
      if (sessions.size < MIN_SESSIONS_FOR_AGGREGATE) return [];

      let broadFirst = 0;
      let totalWithTool = 0;
      let firstTs = Number.POSITIVE_INFINITY;
      let lastTs = Number.NEGATIVE_INFINITY;

      for (const sessEntries of sessions.values()) {
        const sorted = [...sessEntries].sort(
          (a, b) => entryTimestamp(a) - entryTimestamp(b),
        );
        const firstTool = sorted.find((e) => e.entryType === "tool_call");
        if (!firstTool) continue;
        totalWithTool += 1;
        const toolName = String(
          firstTool.payload?.toolName ?? firstTool.title ?? "",
        ).toLowerCase();
        if (BROAD_EXPLORATION_TOOLS.has(toolName)) {
          broadFirst += 1;
          const ts = entryTimestamp(firstTool);
          firstTs = Math.min(firstTs, ts);
          lastTs = Math.max(lastTs, ts);
        }
      }

      if (totalWithTool < MIN_SESSIONS_FOR_AGGREGATE) return [];
      const ratio = broadFirst / totalWithTool;
      if (ratio < 0.4) return [];

      return [
        {
          text:
            `Across ${totalWithTool} recent sessions, ${broadFirst} began with broad-exploration tools (scan_market / get_candles / get_orderbook / list_*). ` +
            `When the user query already names a specific instrument or setup, consider opening with a targeted tool call ` +
            `(e.g. get_candles for the named symbol, or going directly to plan creation) rather than a broad scan. ` +
            `HALO's Terminal-Bench finding: first-action breadth is a recurring inefficiency invisible per-session but obvious in aggregate.`,
          firstSeenAt: Number.isFinite(firstTs) ? firstTs : Date.now(),
          lastSeenAt: Number.isFinite(lastTs) ? lastTs : Date.now(),
          evidenceCount: broadFirst,
        },
      ];
    },
  },
  // Rule: cancel-rationale recurrence. If the user cancels >=3 orders
  // within recent history citing a recurring theme (e.g. "changed mind",
  // "wrong size", "stopped out elsewhere"), surface as a behavioral
  // signal — Sentra's "company brain" framing applied to single-trader
  // pattern detection. Distinct from the per-event cancel_rationale rule
  // which captures individual reasons; this surfaces the meta-pattern.
  {
    category: "aggregate_pattern",
    match: (entries) => {
      const cancels = entries.filter(
        (e) => e.entryType === "execution_result" && e.payload?.kind === "cancel",
      );
      if (cancels.length < 3) return [];

      const reasonBuckets = new Map<
        string,
        { samples: string[]; firstSeen: number; lastSeen: number; count: number }
      >();

      for (const e of cancels) {
        const rationale = (e.payload?.rationale as string | undefined)
          ?.trim()
          .toLowerCase();
        if (!rationale || rationale.length < 5) continue;
        // Coarse bucket by first 3 significant words — captures
        // recurring themes without overfitting to exact wording.
        const bucket = rationale
          .replace(/[^a-z0-9\s]/g, " ")
          .split(/\s+/)
          .filter((w) => w.length > 2)
          .slice(0, 3)
          .join(" ");
        if (!bucket) continue;
        const ts = entryTimestamp(e);
        const existing = reasonBuckets.get(bucket);
        if (existing) {
          existing.count += 1;
          existing.firstSeen = Math.min(existing.firstSeen, ts);
          existing.lastSeen = Math.max(existing.lastSeen, ts);
          if (existing.samples.length < 3) {
            existing.samples.push(rationale.slice(0, 80));
          }
        } else {
          reasonBuckets.set(bucket, {
            samples: [rationale.slice(0, 80)],
            firstSeen: ts,
            lastSeen: ts,
            count: 1,
          });
        }
      }

      const out: AggregateCandidate[] = [];
      for (const [bucket, data] of reasonBuckets) {
        if (data.count < 3) continue;
        out.push({
          text:
            `User has cancelled ${data.count} orders citing theme "${bucket}" (sample rationales: ${data.samples.join(" / ")}). ` +
            `This is a recurring cancellation pattern — before proposing the next entry, surface the prior cancellations and confirm conditions have changed.`,
          firstSeenAt: data.firstSeen,
          lastSeenAt: data.lastSeen,
          evidenceCount: data.count,
        });
      }
      return out;
    },
  },
];

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

  // Run aggregate pattern rules — operate on the full entry array, not
  // per-entry. See above for rationale (Sentra + HALO convergence).
  for (const rule of AGGREGATE_PATTERN_RULES) {
    let aggResults: AggregateCandidate[] = [];
    try {
      aggResults = rule.match(entries);
    } catch (err) {
      logger.warn("Aggregate ACE rule failed", {
        category: rule.category,
        error: (err as Error).message,
      });
      continue;
    }
    for (const cand of aggResults) {
      const key = `${rule.category}::${dedupeKey(cand.text)}`;
      const existing = buckets.get(key);
      if (existing) {
        existing.evidenceCount = Math.max(existing.evidenceCount, cand.evidenceCount);
        existing.firstSeenAt = Math.min(existing.firstSeenAt, cand.firstSeenAt);
        existing.lastSeenAt = Math.max(existing.lastSeenAt, cand.lastSeenAt);
      } else {
        buckets.set(key, {
          text: cand.text,
          category: rule.category,
          evidenceCount: cand.evidenceCount,
          firstSeenAt: cand.firstSeenAt,
          lastSeenAt: cand.lastSeenAt,
        });
      }
    }
  }

  const candidates = [...buckets.values()].sort((a, b) => b.evidenceCount - a.evidenceCount);
  return { candidates, entriesAnalyzed: entries.length, generatedAt };
}

/**
 * Apply every aggregate pattern rule to a set of entries. Returns the
 * matched candidates paired with their category. Used by tests to verify
 * aggregate rule behavior without spinning up the action-log store.
 */
export function _applyAggregatePatternRulesForTest(
  entries: ReadonlyArray<ActionLogEntry>,
): Array<{ category: ACELessonCandidate["category"]; candidates: AggregateCandidate[] }> {
  const out: Array<{ category: ACELessonCandidate["category"]; candidates: AggregateCandidate[] }> = [];
  for (const rule of AGGREGATE_PATTERN_RULES) {
    const candidates = rule.match(entries);
    if (candidates.length > 0) {
      out.push({ category: rule.category, candidates });
    }
  }
  return out;
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
