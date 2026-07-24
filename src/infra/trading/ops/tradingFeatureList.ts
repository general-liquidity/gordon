/**
 * Trading Feature List (GORDON_TRADING_FEATURE_LIST).
 *
 * Trading-domain port of the `feature_list.json` pattern from Anthropic's
 * "Effective harnesses for long-running agents" (2026). Anthropic shipped
 * a Claude.ai clone at 200-feature scale using this primitive; we mirror
 * the shape and apply it to trading-agent capabilities.
 *
 * Schema (per Anthropic):
 *
 *   { category, description, steps[], passes: bool }
 *
 * Critical constraint: **the agent may edit ONLY the `passes` field** (plus
 * the verified/failed timestamps and the failure reason). All other fields
 * are immutable once the list is initialized. This is enforced by the
 * `applyEdit` function which rejects any diff that mutates frozen fields.
 *
 * The autonomous loop reads the list each cycle, picks the highest-priority
 * not-yet-passing entry, and works on it. When verification passes (paper
 * mode end-to-end), the agent flips `passes` via `markPass`.
 *
 * Categories tuned for trading:
 *   - venue       — connectivity / adapter / market-data correctness
 *   - analysis    — regime detection / signal generation / scoring
 *   - execution   — order placement / cancellation / reconciliation
 *   - risk        — limits / deny-list / mandate / kill-switch
 *   - monitoring  — alerts / panels / health checks
 *   - operational — sessions / state / handoff / boot
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const TRADING_FEATURE_LIST_PATH_ENV = "GORDON_TRADING_FEATURE_LIST_PATH";

export type FeatureCategory =
  | "venue"
  | "analysis"
  | "execution"
  | "risk"
  | "monitoring"
  | "operational";

export interface FeatureEntry {
  /** Stable identifier (e.g. "exec-place-spot-order"). */
  id: string;
  category: FeatureCategory;
  /** One-line capability description, visible to the operator. */
  description: string;
  /** Ordered verification steps the agent must complete to mark passes=true. */
  steps: string[];
  /** Lower = higher priority. 0 is the highest. */
  priority: number;
  /** Has the agent verified this capability end-to-end? */
  passes: boolean;
  /** ISO timestamp at which `passes` flipped to true. */
  paperModeVerifiedAt: string | null;
  /** ISO timestamp at which `passes` was last set to false after a failure. */
  failedAt: string | null;
  /** Short reason if the most recent verification failed. */
  failedReason: string | null;
}

/** Fields the agent may mutate. Everything else is frozen. */
export const MUTABLE_FEATURE_FIELDS: ReadonlySet<keyof FeatureEntry> = new Set<keyof FeatureEntry>([
  "passes",
  "paperModeVerifiedAt",
  "failedAt",
  "failedReason",
]);

export interface FeatureList {
  version: number;
  createdAt: string;
  /** Ordered by `priority` ascending (recomputed on save). */
  entries: FeatureEntry[];
}

export interface FeatureListSummary {
  totalCount: number;
  passingCount: number;
  failingCount: number;
  byCategory: Record<FeatureCategory, { total: number; passing: number }>;
  nextPriority: FeatureEntry | null;
}

export interface EditViolation {
  entryId: string;
  field: keyof FeatureEntry;
  message: string;
}

export interface ApplyEditResult {
  ok: boolean;
  applied: FeatureList | null;
  violations: EditViolation[];
}

export function defaultTradingFeatureListPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[TRADING_FEATURE_LIST_PATH_ENV] ?? join(homedir(), ".gordon", "feature-list.json");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Construct a new feature entry with sane defaults. */
export function makeEntry(
  init: Pick<FeatureEntry, "id" | "category" | "description" | "steps" | "priority">,
): FeatureEntry {
  return {
    ...init,
    passes: false,
    paperModeVerifiedAt: null,
    failedAt: null,
    failedReason: null,
  };
}

export function createFeatureList(entries: FeatureEntry[], now?: string): FeatureList {
  return {
    version: 1,
    createdAt: now ?? new Date().toISOString(),
    entries: sortByPriority(entries),
  };
}

function sortByPriority(entries: FeatureEntry[]): FeatureEntry[] {
  return [...entries].sort((a, b) => a.priority - b.priority);
}

export function loadFeatureList(path?: string): FeatureList | null {
  const target = path ?? defaultTradingFeatureListPath();
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as FeatureList;
    if (typeof parsed.version !== "number" || !Array.isArray(parsed.entries)) return null;
    return { ...parsed, entries: sortByPriority(parsed.entries) };
  } catch {
    return null;
  }
}

export function saveFeatureList(list: FeatureList, path?: string): void {
  const target = path ?? defaultTradingFeatureListPath();
  ensureParentDir(target);
  const normalized: FeatureList = { ...list, entries: sortByPriority(list.entries) };
  writeFileSync(target, JSON.stringify(normalized, null, 2), "utf8");
}

/** Return the highest-priority not-yet-passing entry, or null if all pass. */
export function pickHighestPriority(list: FeatureList): FeatureEntry | null {
  for (const e of sortByPriority(list.entries)) {
    if (!e.passes) return e;
  }
  return null;
}

export function summarize(list: FeatureList): FeatureListSummary {
  const byCategory: Record<FeatureCategory, { total: number; passing: number }> = {
    venue: { total: 0, passing: 0 },
    analysis: { total: 0, passing: 0 },
    execution: { total: 0, passing: 0 },
    risk: { total: 0, passing: 0 },
    monitoring: { total: 0, passing: 0 },
    operational: { total: 0, passing: 0 },
  };
  let passing = 0;
  for (const e of list.entries) {
    byCategory[e.category].total += 1;
    if (e.passes) {
      byCategory[e.category].passing += 1;
      passing += 1;
    }
  }
  return {
    totalCount: list.entries.length,
    passingCount: passing,
    failingCount: list.entries.length - passing,
    byCategory,
    nextPriority: pickHighestPriority(list),
  };
}

// ============================================================================
// Edit enforcement — only `passes` + timestamps + reason may change
// ============================================================================

/**
 * Mark an entry as passing. Returns a new list; original is unchanged.
 * If the id doesn't exist, returns null.
 */
export function markPass(list: FeatureList, id: string, now?: string): FeatureList | null {
  const idx = list.entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const entry = list.entries[idx]!;
  const updated: FeatureEntry = {
    ...entry,
    passes: true,
    paperModeVerifiedAt: now ?? new Date().toISOString(),
    failedAt: null,
    failedReason: null,
  };
  const entries = [...list.entries];
  entries[idx] = updated;
  return { ...list, entries: sortByPriority(entries) };
}

export function markFail(
  list: FeatureList,
  id: string,
  reason: string,
  now?: string,
): FeatureList | null {
  const idx = list.entries.findIndex((e) => e.id === id);
  if (idx === -1) return null;
  const entry = list.entries[idx]!;
  const updated: FeatureEntry = {
    ...entry,
    passes: false,
    failedAt: now ?? new Date().toISOString(),
    failedReason: reason,
  };
  const entries = [...list.entries];
  entries[idx] = updated;
  return { ...list, entries: sortByPriority(entries) };
}

/**
 * Apply a candidate edit. Compare every field of every entry; reject any
 * mutation to a non-mutable field. Used to gate LLM-proposed edits.
 *
 * `candidate.entries` must contain the same id set as `current.entries`
 * (no adds, no removes) — additions and removals are also forbidden.
 */
export function applyEdit(current: FeatureList, candidate: FeatureList): ApplyEditResult {
  const violations: EditViolation[] = [];

  // Set membership: forbid adds and removes
  const currentIds = new Set(current.entries.map((e) => e.id));
  const candidateIds = new Set(candidate.entries.map((e) => e.id));
  for (const id of currentIds) {
    if (!candidateIds.has(id)) {
      violations.push({
        entryId: id,
        field: "id",
        message: "feature removal is not allowed",
      });
    }
  }
  for (const id of candidateIds) {
    if (!currentIds.has(id)) {
      violations.push({
        entryId: id,
        field: "id",
        message: "feature addition is not allowed via applyEdit",
      });
    }
  }

  // Per-entry field diff
  const currentById = new Map(current.entries.map((e) => [e.id, e]));
  for (const cand of candidate.entries) {
    const cur = currentById.get(cand.id);
    if (!cur) continue; // already flagged above
    for (const field of Object.keys(cand) as Array<keyof FeatureEntry>) {
      const before = cur[field];
      const after = cand[field];
      const changed = !valueEqual(before, after);
      if (changed && !MUTABLE_FEATURE_FIELDS.has(field)) {
        violations.push({
          entryId: cand.id,
          field,
          message: `field "${String(field)}" is immutable`,
        });
      }
    }
  }

  if (violations.length > 0) {
    return { ok: false, applied: null, violations };
  }

  return {
    ok: true,
    applied: { ...candidate, entries: sortByPriority(candidate.entries) },
    violations: [],
  };
}

function valueEqual(a: unknown, b: unknown): boolean {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => valueEqual(v, b[i]));
  }
  return a === b;
}

// ============================================================================
// Reporting
// ============================================================================

export function formatFeatureList(list: FeatureList): string {
  const lines: string[] = [];
  const s = summarize(list);
  lines.push(`Feature list — ${s.passingCount}/${s.totalCount} passing`);
  for (const cat of Object.keys(s.byCategory) as FeatureCategory[]) {
    const c = s.byCategory[cat];
    if (c.total === 0) continue;
    lines.push(`  ${cat.padEnd(12)} ${c.passing}/${c.total}`);
  }
  if (s.nextPriority) {
    lines.push(`Next: [${s.nextPriority.category}] ${s.nextPriority.description}`);
  } else {
    lines.push("All features passing.");
  }
  return lines.join("\n");
}

export function featureListToPayload(list: FeatureList): Record<string, unknown> {
  const s = summarize(list);
  return {
    kind: "trading_feature_list.summary_recorded",
    totalCount: s.totalCount,
    passingCount: s.passingCount,
    nextPriorityId: s.nextPriority?.id ?? null,
    nextPriorityCategory: s.nextPriority?.category ?? null,
  };
}
