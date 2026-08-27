/**
 * Decisions Log (GORDON_DECISIONS_LOG).
 *
 * Ports L05 from learn-harness-engineering — captures the *in-flight*
 * reasoning behind a choice ("why X over Y") at the moment the choice
 * is made. Distinct from ACE's lessons (those are after-the-fact
 * pattern distillation; this is point-in-time intent).
 *
 * Persisted as JSONL at ~/.gordon/decisions.jsonl. The format is
 * append-only — never rewritten — so it can be tailed by humans and
 * machine-parsed line-by-line.
 *
 * Read paths support filtering by threadId, symbol, and time window
 * so a new session can pull the previous session's decisions to seed
 * working memory ("last session chose mandate X because Y").
 *
 * Default-off via GORDON_DECISIONS_LOG=1. Module exports a no-op
 * `recordDecision` when disabled so call sites don't need their own
 * guards.
 */

import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type DecisionCategory =
  | "plan"
  | "mandate"
  | "risk-override"
  | "venue"
  | "strategy"
  | "entry-timing"
  | "exit"
  | "other";

/**
 * Lifecycle stage of a trade. From TraderMorin's article: post-trade
 * review precision requires knowing *where* in the trade lifecycle the
 * decision was made, so mistakes can be clustered by stage.
 */
export type TradeLifecycleStage =
  /** Pre-trade: market outlook, plan creation, sizing, confluence scoring. */
  | "planning"
  /** Order entry: timing, scaling, broker selection, fill management. */
  | "execution"
  /** In-trade: stop adjustments, partial closes, scaling in/out. */
  | "management"
  /** Trade end: full close, post-trade review, journaling. */
  | "closure";

export interface DecisionEntry {
  /** Stable ID for cross-referencing in action log. */
  id: string;
  recordedAt: string;
  threadId?: string;
  sessionId?: string;
  category: DecisionCategory;
  /**
   * Trade lifecycle stage. Optional for backward compatibility — pre-stage
   * entries remain readable. Set explicitly going forward so post-trade
   * review can answer "where do my mistakes cluster?"
   */
  stage?: TradeLifecycleStage;
  /** Brief context — what was being decided about. */
  context: string;
  /** One-line summary (alias stored alongside context for readers that expect it). */
  summary?: string;
  /** Selected choice. */
  selected: string;
  /** Alternatives the agent considered. Free-text labels. */
  alternatives: string[];
  /** Why the selected option won. */
  rationale: string;
  /** Optional symbol(s) this decision is scoped to. */
  symbols?: string[];
  /** Evidence references supporting the decision. */
  evidence?: string[];
  /** Structured metadata (convictionRating, rMultiple, etc.). */
  metadata?: Record<string, unknown>;
  /** Optional reference to a related plan / position / action-log entry. */
  refs?: Record<string, string>;
}

export interface RecordDecisionInput {
  category: DecisionCategory;
  stage?: TradeLifecycleStage;
  /** Human-readable summary of what was decided (alias for `context`). */
  summary?: string;
  context?: string;
  selected?: string;
  alternatives?: string[];
  rationale?: string;
  threadId?: string;
  sessionId?: string;
  /** Single-symbol shorthand — stored as `symbols: [symbol]`. */
  symbol?: string;
  symbols?: string[];
  evidence?: string[];
  metadata?: Record<string, unknown>;
  refs?: Record<string, string>;
}

export function isDecisionsLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.GORDON_DECISIONS_LOG === "1" || env.GORDON_DECISIONS_LOG === "true";
}

export function defaultDecisionsLogPath(env: NodeJS.ProcessEnv = process.env): string {
  return env.GORDON_DECISIONS_LOG_PATH || join(homedir(), ".gordon", "decisions.jsonl");
}

function newDecisionId(): string {
  return `dec-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Append a decision to the log. No-op when the flag is off.
 * Returns the recorded entry (or null when disabled) so callers can
 * include the ID in their own observations.
 */
function normalizeRecordInput(input: RecordDecisionInput): {
  context: string;
  selected: string;
  rationale: string;
  symbols?: string[];
} {
  const context = (input.context ?? input.summary ?? "").trim();
  const selected = (input.selected ?? input.summary ?? context).trim();
  const rationale = (input.rationale ?? input.summary ?? selected).trim();
  const symbols = input.symbols ?? (input.symbol ? [input.symbol] : undefined);
  return { context, selected, rationale, symbols };
}

export function recordDecision(
  input: RecordDecisionInput,
  env: NodeJS.ProcessEnv = process.env,
  path: string = defaultDecisionsLogPath(env),
): DecisionEntry | null {
  if (!isDecisionsLogEnabled(env)) return null;
  const normalized = normalizeRecordInput(input);
  const entry: DecisionEntry = {
    id: newDecisionId(),
    recordedAt: new Date().toISOString(),
    threadId: input.threadId,
    sessionId: input.sessionId,
    category: input.category,
    stage: input.stage,
    context: normalized.context,
    summary: input.summary ?? normalized.context,
    selected: normalized.selected,
    alternatives: input.alternatives ?? [],
    rationale: normalized.rationale,
    symbols: normalized.symbols,
    evidence: input.evidence,
    metadata: input.metadata,
    refs: input.refs,
  };
  try {
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, `${JSON.stringify(entry)}\n`, "utf8");
  } catch {
    // Best-effort: don't break the calling code path if the disk write
    // fails. The decision is still expressed in the call site's own
    // observation stream.
  }
  return entry;
}

export interface ReadDecisionsOptions {
  /** Filter to decisions recorded at-or-after this ISO timestamp. */
  since?: string;
  /** Filter to decisions from this thread. */
  threadId?: string;
  /** Filter to decisions involving this symbol. */
  symbol?: string;
  /** Filter to one or more categories. */
  categories?: DecisionCategory[];
  /** Maximum number of entries to return (most recent first). */
  limit?: number;
}

/**
 * Read decisions from the log with optional filters. Tolerant of
 * malformed lines (skipped silently). Returns most-recent-first.
 */
export function readDecisions(
  options: ReadDecisionsOptions = {},
  env: NodeJS.ProcessEnv = process.env,
  path: string = defaultDecisionsLogPath(env),
): DecisionEntry[] {
  if (!existsSync(path)) return [];
  let content: string;
  try {
    content = readFileSync(path, "utf8");
  } catch {
    return [];
  }
  const out: DecisionEntry[] = [];
  const sinceMs = options.since ? new Date(options.since).getTime() : -Infinity;
  const categorySet = options.categories ? new Set<DecisionCategory>(options.categories) : null;
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let parsed: DecisionEntry;
    try {
      parsed = JSON.parse(trimmed) as DecisionEntry;
    } catch {
      continue;
    }
    if (!parsed || typeof parsed !== "object" || !parsed.id) continue;
    if (sinceMs > -Infinity && new Date(parsed.recordedAt).getTime() < sinceMs) continue;
    if (options.threadId && parsed.threadId !== options.threadId) continue;
    if (categorySet && !categorySet.has(parsed.category)) continue;
    if (options.symbol) {
      const symbols = parsed.symbols ?? [];
      if (!symbols.includes(options.symbol)) continue;
    }
    out.push(parsed);
  }
  out.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  if (options.limit && out.length > options.limit) return out.slice(0, options.limit);
  return out;
}

/**
 * Convenience alias — most-recent decisions, default limit 50.
 */
export function readRecentDecisions(
  limit = 50,
  env: NodeJS.ProcessEnv = process.env,
  path: string = defaultDecisionsLogPath(env),
): DecisionEntry[] {
  return readDecisions({ limit }, env, path);
}

/**
 * Compact human-readable summary suitable for seeding working memory
 * at session start. One line per decision, newest first.
 */
export function summarizeDecisionsForResume(
  decisions: DecisionEntry[],
  maxLines: number = 10,
): string {
  if (decisions.length === 0) return "";
  const lines = decisions.slice(0, maxLines).map((d) => {
    const date = d.recordedAt.slice(0, 10);
    const sym = d.symbols?.length ? ` [${d.symbols.join(",")}]` : "";
    const stage = d.stage ? `@${d.stage}` : "";
    return `${date}${sym} ${d.category}${stage}: chose ${d.selected} — ${d.rationale}`;
  });
  return lines.join("\n");
}

/**
 * Group decisions by trade-lifecycle stage. Returns counts + sample
 * rationales per stage. Useful for the post-trade review pattern from
 * TraderMorin's article: cluster mistakes by where they happen in the
 * lifecycle so the operator knows whether to refine entry, management,
 * or closure discipline.
 */
export interface DecisionsByStageReport {
  totalCount: number;
  withStage: number;
  withoutStage: number;
  byStage: Record<
    TradeLifecycleStage,
    {
      count: number;
      categories: Record<DecisionCategory, number>;
      sampleContexts: string[];
    }
  >;
}

export function groupDecisionsByStage(decisions: readonly DecisionEntry[]): DecisionsByStageReport {
  const byStage: Record<
    TradeLifecycleStage,
    { count: number; categories: Record<DecisionCategory, number>; sampleContexts: string[] }
  > = {
    planning: { count: 0, categories: {} as Record<DecisionCategory, number>, sampleContexts: [] },
    execution: { count: 0, categories: {} as Record<DecisionCategory, number>, sampleContexts: [] },
    management: {
      count: 0,
      categories: {} as Record<DecisionCategory, number>,
      sampleContexts: [],
    },
    closure: { count: 0, categories: {} as Record<DecisionCategory, number>, sampleContexts: [] },
  };
  let withStage = 0;
  let withoutStage = 0;
  for (const d of decisions) {
    if (!d.stage) {
      withoutStage += 1;
      continue;
    }
    withStage += 1;
    const bucket = byStage[d.stage];
    bucket.count += 1;
    bucket.categories[d.category] = (bucket.categories[d.category] ?? 0) + 1;
    if (bucket.sampleContexts.length < 3) bucket.sampleContexts.push(d.context);
  }
  return {
    totalCount: decisions.length,
    withStage,
    withoutStage,
    byStage,
  };
}

export function formatStageReport(report: DecisionsByStageReport): string {
  const lines: string[] = [];
  lines.push(`Decisions by stage (${report.withStage} stage-tagged / ${report.totalCount} total):`);
  for (const stage of ["planning", "execution", "management", "closure"] as TradeLifecycleStage[]) {
    const bucket = report.byStage[stage];
    if (bucket.count === 0) continue;
    const cats = Object.entries(bucket.categories)
      .map(([cat, n]) => `${cat}=${n}`)
      .join(", ");
    lines.push(`  ${stage}: ${bucket.count} decisions${cats ? ` (${cats})` : ""}`);
    for (const ctx of bucket.sampleContexts) {
      lines.push(`    • ${ctx}`);
    }
  }
  if (report.withoutStage > 0) {
    lines.push(`  (${report.withoutStage} decisions without stage tag)`);
  }
  return lines.join("\n");
}
