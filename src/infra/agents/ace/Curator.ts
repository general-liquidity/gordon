/**
 * ACE Curator — ranks and persists Reflector lesson candidates
 *
 * Reads candidates from the Reflector, merges them with any persisted lessons,
 * dedupes, scores, prunes, and writes the result to ~/.gordon/ace-lessons.json.
 *
 * Subsequent Gordon sessions can call `loadACELessons()` and inject the
 * formatted block into the system prompt. Auto-injection is NOT yet wired —
 * this is scaffolded for a future sprint.
 *
 * SCAFFOLD STATUS — gated behind GORDON_ACE_ENABLED=true; no-ops otherwise.
 */

import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createModuleLogger } from "../../logger/index.ts";
import {
  isACEEnabled,
  mergeEvidenceIds,
  type ACELessonCandidate,
  type ReflectorOutput,
} from "./Reflector.ts";
import { listActionLogEntries } from "../../action-log/store.ts";
import type { ActionLogEntry } from "../../action-log/types.ts";
import { recordRepropose, rejectedIds } from "./RejectedBuffer.ts";
import { gateLessonCandidates } from "./regressionGate.ts";

const logger = createModuleLogger("ace-curator");

/**
 * Per-cycle cap on the number of NEW lessons accepted from a single
 * Reflector pass. SkillOpt calls this the "textual learning rate" —
 * without a cap, the loop becomes ad-hoc prompt rewriting. Existing
 * lesson merges (refreshing evidence on an already-curated lesson) do
 * NOT count against the budget; only brand-new lessons do.
 *
 * Default 4 per the paper. Override via GORDON_ACE_EDIT_BUDGET when an
 * operator deliberately wants a wider ingest window (e.g. after a long
 * gap with no /reflect run).
 */
const DEFAULT_EDIT_BUDGET = 4;

function getEditBudget(): number {
  const raw = process.env.GORDON_ACE_EDIT_BUDGET;
  if (raw && raw.trim()) {
    const parsed = Number(raw);
    if (Number.isFinite(parsed) && parsed > 0) return Math.floor(parsed);
  }
  return DEFAULT_EDIT_BUDGET;
}

export interface ACELesson extends ACELessonCandidate {
  /** Stable id derived from category + dedupe key */
  id: string;
  /** Curator score (0–1). Higher = surface more aggressively. */
  score: number;
  /** Last time this lesson was written or refreshed */
  curatedAt: string;
}

export interface ACELessonStore {
  /** SCHEMA version (file format) — bump only on a breaking shape change. */
  version: 1;
  updatedAt: string;
  /**
   * Monotonic CONTENT revision — distinct from `version` (which is the file
   * schema). Increments by 1 each time a curation pass actually changes the
   * promoted lesson set (a new lesson, or refreshed evidence on an existing
   * one). Stable across reads and across no-op curation passes, so a live
   * output can be stamped with "operating under ACE lesson-set rev N" for
   * attribution — which lesson revision produced a given action.
   */
  revision: number;
  lessons: ACELesson[];
}

const MAX_RETAINED_LESSONS = 50;

/**
 * Repeated-signal promotion bar. A brand-new lesson must be backed by at least
 * this many supporting events before it promotes into the cross-session prompt
 * — a single noisy one-off shouldn't become a durable procedural rule (the
 * memory-overfitting trap). The Reflector aggregates `evidenceCount` from the
 * action log in one pass, so this is "≥2 log entries support it," not "seen
 * across 2 curation cycles."
 */
const MIN_EVIDENCE_TO_PROMOTE = 2;

/**
 * Categories EXEMPT from the repeated-signal bar — promote on first occurrence.
 * These are either safety-critical realized events or EXPLICIT operator-sourced
 * signals (a stated preference, a logged rationale, an in-context correction),
 * which are ground truth on first mention rather than noisy inferences. The
 * inferred / recurring-pattern categories (venue_quirk, execution_*,
 * strategy_decay, operational, aggregate_pattern) require ≥MIN_EVIDENCE.
 */
const PROMOTE_ON_FIRST: ReadonlySet<ACELessonCandidate["category"]> = new Set([
  "risk_event",
  "operator_override",
  "agent_self_block",
  "user_preference",
  "approved_plan_rationale",
  "cancel_rationale",
]);

const CATEGORY_BASE_SCORE: Record<ACELessonCandidate["category"], number> = {
  risk_event: 0.95,
  // Operator override — the human corrected the agent's judgment on a correct-looking decision.
  // The strongest LEARNING signal (above self-blocks and failures): scored just under a realized
  // risk event so it surfaces aggressively and is evicted last.
  operator_override: 0.92,
  execution_failure: 0.85,
  strategy_decay: 0.80,
  // Self-reported agent blocks are high-signal — the agent explicitly named
  // intent + blocker, which is more actionable than inferring from a tool
  // failure. Score above execution_failure so these surface early.
  agent_self_block: 0.88,
  user_preference: 0.75,
  // User-articulated rationales accompanying approved plans — strong
  // positive signal but specific to the exact context, so weight modestly.
  approved_plan_rationale: 0.72,
  // Cancel rationales — the user named a specific reason to exit. Slightly
  // higher than approved_plan_rationale because invalidation events tend
  // to recur and are higher-leverage to surface ("we exited TSLA earnings
  // for X reason; don't re-enter under the same conditions").
  cancel_rationale: 0.74,
  // Aggregate cross-session patterns (Sentra + HALO). Score in between
  // approved_plan and cancel — these are meta-observations about the
  // user's running behavior, high-signal but inherently noisier than
  // per-event rules because the threshold logic makes inferences.
  aggregate_pattern: 0.73,
  venue_quirk: 0.70,
  execution_success: 0.55,
  operational: 0.50,
};

export function getACELessonsPath(): string {
  const override = process.env.GORDON_ACE_LESSONS_PATH;
  if (override && override.trim()) return override;
  return join(homedir(), ".gordon", "ace-lessons.json");
}

function ensureParentDir(filePath: string): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function emptyStore(): ACELessonStore {
  return { version: 1, updatedAt: new Date().toISOString(), revision: 0, lessons: [] };
}

/** Stable content signature of a lesson set — id + evidence per lesson, order-independent.
 *  Used to decide whether a curation pass actually changed content (→ bump the revision). */
function lessonsSignature(lessons: ACELesson[]): string {
  return lessons
    .map((l) => `${l.id}:${l.evidenceCount}`)
    .sort()
    .join("|");
}

export function loadACELessons(): ACELessonStore {
  const path = getACELessonsPath();
  if (!existsSync(path)) return emptyStore();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<ACELessonStore>;
    if (!parsed || parsed.version !== 1 || !Array.isArray(parsed.lessons)) {
      return emptyStore();
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      // Backward-compat: files written before the content-revision field default to 0.
      revision:
        typeof parsed.revision === "number" && parsed.revision >= 0
          ? Math.floor(parsed.revision)
          : 0,
      lessons: parsed.lessons,
    };
  } catch (error) {
    logger.warn("Failed to load ACE lessons — starting fresh", {
      error: (error as Error).message,
    });
    return emptyStore();
  }
}

function lessonId(category: ACELessonCandidate["category"], text: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  return `${category}::${slug}`;
}

function scoreLesson(c: ACELessonCandidate): number {
  const base = CATEGORY_BASE_SCORE[c.category] ?? 0.5;
  const evidenceBoost = Math.min(0.2, Math.log10(1 + c.evidenceCount) * 0.1);
  // Recency boost — events within the last 7 days get the full boost.
  const ageDays = Math.max(0, (Date.now() - c.lastSeenAt) / (24 * 60 * 60 * 1000));
  const recencyBoost = ageDays < 7 ? 0.1 : ageDays < 30 ? 0.05 : 0;
  return Math.min(1, base + evidenceBoost + recencyBoost);
}

/**
 * Merge new Reflector candidates into the persisted store, rank, prune, and
 * write back. Returns the updated store. No-op when ACE is disabled.
 */
export function runCurator(reflectorOutput: ReflectorOutput): ACELessonStore {
  if (!isACEEnabled()) {
    logger.debug("ACE disabled — skipping Curator");
    return loadACELessons();
  }

  const store = loadACELessons();
  const byId = new Map<string, ACELesson>();
  for (const lesson of store.lessons) {
    byId.set(lesson.id, lesson);
  }

  const now = new Date().toISOString();
  const rejected = rejectedIds();
  const reproposedRejected: string[] = [];

  // Pre-score candidates so when we hit the edit budget, the cap takes
  // the highest-scoring NEW lessons rather than the first N encountered.
  const scoredCandidates = reflectorOutput.candidates.map((candidate) => {
    const id = lessonId(candidate.category, candidate.text);
    return { id, candidate, score: scoreLesson(candidate) };
  });
  scoredCandidates.sort((a, b) => b.score - a.score);

  // REGRESSION GATE (Self-Harness): a self-generated lesson can only promote into the cross-session
  // prompt if it survives the held-out SAFETY check — reject any lesson that would weaken a
  // safety-critical action or control BEFORE it can ship. Applies to NEW lessons; merges of
  // already-curated lessons (which passed the gate when first promoted) are refreshes, not edits.
  const gateRejected = new Map<string, string>();
  for (const r of gateLessonCandidates(reflectorOutput.candidates).rejected) {
    gateRejected.set(lessonId(r.candidate.category, r.candidate.text), r.reason);
  }

  const editBudget = getEditBudget();
  let newAdded = 0;

  for (const { id, candidate } of scoredCandidates) {
    // Rejected lessons never re-enter the store. Track repropose count so
    // the operator can see what the Reflector keeps proposing.
    if (rejected.has(id)) {
      reproposedRejected.push(id);
      continue;
    }
    const existing = byId.get(id);
    if (existing) {
      // Merges of already-curated lessons don't count against the edit
      // budget — they're refreshes, not new procedural rules.
      const merged: ACELesson = {
        ...existing,
        evidenceCount: existing.evidenceCount + candidate.evidenceCount,
        firstSeenAt: Math.min(existing.firstSeenAt, candidate.firstSeenAt),
        lastSeenAt: Math.max(existing.lastSeenAt, candidate.lastSeenAt),
        curatedAt: now,
        // EXO1 drill-down linkage — set-union with cap (newest evidence
        // surfaces last; the cap keeps the lesson record bounded).
        evidenceEntryIds: mergeEvidenceIds(
          existing.evidenceEntryIds ?? [],
          candidate.evidenceEntryIds ?? [],
        ),
      };
      merged.score = scoreLesson(merged);
      byId.set(id, merged);
    } else {
      // Repeated-signal bar: a brand-new lesson in an inferred/recurring
      // category needs ≥MIN_EVIDENCE supporting events before it becomes a
      // durable cross-session rule. Explicit / safety-critical categories
      // (PROMOTE_ON_FIRST) are ground truth on first mention and skip the bar.
      // Checked BEFORE the budget so a held one-off doesn't consume a slot.
      if (
        candidate.evidenceCount < MIN_EVIDENCE_TO_PROMOTE &&
        !PROMOTE_ON_FIRST.has(candidate.category)
      ) {
        logger.debug("ACE lesson HELD below repeated-signal bar", {
          id,
          category: candidate.category,
          evidenceCount: candidate.evidenceCount,
        });
        continue;
      }
      // New lessons are budgeted. SkillOpt's "textual learning rate" —
      // takes only the top-N candidates this cycle.
      if (newAdded >= editBudget) continue;
      // Safety regression gate: a new lesson that would weaken a safety-critical action/control
      // is NEVER promoted into the cross-session prompt (logged + recorded as rejected).
      const gateReason = gateRejected.get(id);
      if (gateReason) {
        logger.warn("ACE lesson REJECTED by safety regression gate", { id, reason: gateReason });
        continue;
      }
      byId.set(id, {
        ...candidate,
        id,
        score: scoreLesson(candidate),
        curatedAt: now,
        evidenceEntryIds: candidate.evidenceEntryIds ?? [],
      });
      newAdded++;
    }
  }

  // Record any rejected lessons the Reflector tried to re-propose so the
  // operator can see when the model keeps wanting to surface them.
  if (reproposedRejected.length > 0) {
    recordRepropose(reproposedRejected);
  }

  const ranked = [...byId.values()]
    .sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount)
    .slice(0, MAX_RETAINED_LESSONS);

  // Bump the content revision only when this pass actually changed the promoted
  // lesson set (new lesson or refreshed evidence). A no-op pass keeps the prior
  // revision so the attribution stamp stays stable.
  const contentChanged = lessonsSignature(store.lessons) !== lessonsSignature(ranked);
  const revision = contentChanged ? store.revision + 1 : store.revision;

  const updated: ACELessonStore = {
    version: 1,
    updatedAt: now,
    revision,
    lessons: ranked,
  };

  try {
    const path = getACELessonsPath();
    ensureParentDir(path);
    writeFileSync(path, JSON.stringify(updated, null, 2), "utf8");
    logger.info("ACE lessons curated", {
      count: ranked.length,
      path,
    });
  } catch (error) {
    logger.warn("Failed to write ACE lessons", { error: (error as Error).message });
  }

  return updated;
}

/**
 * EXO1 drill-down — load the raw action-log entries that produced a lesson.
 *
 * Reads the curated lesson by id, pulls its evidenceEntryIds, and resolves
 * each id through the action-log store. Missing ids (entries that aged out
 * of the log) are returned as null in the result so the caller can see the
 * attribution gap explicitly. Returns null when the lesson itself isn't
 * found.
 *
 * Designed for the "why does this lesson exist?" diagnostic — agent or
 * operator inspects a curated lesson and wants the concrete raw evidence
 * without re-running the Reflector.
 */
export function loadLessonEvidence(
  lessonOrId: string | ACELesson,
): { lesson: ACELesson; entries: Array<ActionLogEntry | null> } | null {
  const store = loadACELessons();
  const lesson =
    typeof lessonOrId === "string"
      ? store.lessons.find((l) => l.id === lessonOrId)
      : lessonOrId;
  if (!lesson) return null;

  const ids = lesson.evidenceEntryIds ?? [];
  if (ids.length === 0) return { lesson, entries: [] };

  // Fetch a generous slice of recent action-log entries and index by id.
  // This avoids a per-id round-trip; the action-log store doesn't expose
  // a get-by-id query directly.
  let recent: ActionLogEntry[] = [];
  try {
    recent = listActionLogEntries({ limit: 10_000 });
  } catch (error) {
    logger.warn("Failed to read action log for lesson evidence", {
      error: (error as Error).message,
      lessonId: lesson.id,
    });
    return { lesson, entries: ids.map(() => null) };
  }
  const byId = new Map<string, ActionLogEntry>();
  for (const entry of recent) byId.set(entry.id, entry);
  const entries = ids.map((id) => byId.get(id) ?? null);
  return { lesson, entries };
}

/**
 * Render the lesson store as a compact prompt block. Future sprints can
 * inject this into the system prompt of new sessions.
 */
export function formatACELessonsForPrompt(store: ACELessonStore, maxLessons = 12): string {
  if (!isACEEnabled() || store.lessons.length === 0) return "";
  const top = store.lessons.slice(0, maxLessons);
  const lines = [
    "[GORDON_ACE_LESSONS]",
    `Lessons accumulated across prior sessions (Reflector→Curator output) — lesson-set revision ${store.revision}:`,
    ...top.map((l) => `- [${l.category}] ${l.text} (evidence: ${l.evidenceCount}, score: ${l.score.toFixed(2)})`),
  ];
  return lines.join("\n");
}
