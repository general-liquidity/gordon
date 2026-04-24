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
  type ACELessonCandidate,
  type ReflectorOutput,
} from "./Reflector.ts";

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
  venue_quirk: 0.70,
  user_preference: 0.75,
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
      };
      merged.score = scoreLesson(merged);
      byId.set(id, merged);
    } else {
      byId.set(id, {
        ...candidate,
        id,
        score: scoreLesson(candidate),
        curatedAt: now,
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
