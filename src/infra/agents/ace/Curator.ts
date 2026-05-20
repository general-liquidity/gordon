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

const logger = createModuleLogger("ace-curator");

export interface ACELesson extends ACELessonCandidate {
  /** Stable id derived from category + dedupe key */
  id: string;
  /** Curator score (0–1). Higher = surface more aggressively. */
  score: number;
  /** Last time this lesson was written or refreshed */
  curatedAt: string;
}

export interface ACELessonStore {
  version: 1;
  updatedAt: string;
  lessons: ACELesson[];
}

const MAX_RETAINED_LESSONS = 50;

const CATEGORY_BASE_SCORE: Record<ACELessonCandidate["category"], number> = {
  risk_event: 0.95,
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
  return { version: 1, updatedAt: new Date().toISOString(), lessons: [] };
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

  for (const candidate of reflectorOutput.candidates) {
    const id = lessonId(candidate.category, candidate.text);
    const existing = byId.get(id);
    if (existing) {
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
      byId.set(id, {
        ...candidate,
        id,
        score: scoreLesson(candidate),
        curatedAt: now,
        evidenceEntryIds: candidate.evidenceEntryIds ?? [],
      });
    }
  }

  const ranked = [...byId.values()]
    .sort((a, b) => b.score - a.score || b.evidenceCount - a.evidenceCount)
    .slice(0, MAX_RETAINED_LESSONS);

  const updated: ACELessonStore = {
    version: 1,
    updatedAt: now,
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
    "Lessons accumulated across prior sessions (Reflector→Curator output):",
    ...top.map((l) => `- [${l.category}] ${l.text} (evidence: ${l.evidenceCount}, score: ${l.score.toFixed(2)})`),
  ];
  return lines.join("\n");
}
