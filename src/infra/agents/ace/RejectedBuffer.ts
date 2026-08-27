/**
 * ACE Rejected-Lesson Buffer.
 *
 * Persistent list of lesson IDs that have been rejected — either by the
 * operator explicitly or auto-rejected by the Curator after repeatedly
 * proposing the same lesson without it gaining traction.
 *
 * Mirrors SkillOpt's per-epoch rejected-edit memory: lessons that hurt
 * (or that the operator chose to remove) shouldn't be silently re-proposed
 * by the next Reflector cycle. Storage lives at:
 *   ~/.gordon/ace-rejected.json
 *
 * Each entry carries:
 *   - id: the lesson id (category::slug — same scheme as Curator)
 *   - reason: "operator" | "auto" with optional free-form note
 *   - rejectedAt: ISO timestamp
 *   - reproposeCount: how many times Reflector has re-proposed this since rejection
 *
 * The buffer is consulted by the Curator BEFORE merging new candidates,
 * so rejected lessons never enter the store. The reproposeCount counter
 * lets us surface "this rejection has been reproposed N times" — useful
 * for the operator to see what the model keeps wanting to say.
 */

import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createModuleLogger } from "../../logger/index.ts";

const logger = createModuleLogger("ace-rejected-buffer");

export interface RejectedLesson {
  /** Lesson id (category::slug) matching the Curator's scheme. */
  id: string;
  /** Why this was rejected. */
  reason: "operator" | "auto";
  /** ISO timestamp of the most recent rejection. */
  rejectedAt: string;
  /** Optional free-form note (operator message, auto-rejection rule, etc.). */
  note?: string;
  /** Reflector re-proposal counter since rejection. */
  reproposeCount: number;
}

export interface RejectedBufferStore {
  version: 1;
  updatedAt: string;
  rejected: RejectedLesson[];
}

export function getRejectedBufferPath(): string {
  const override = process.env.GORDON_ACE_REJECTED_PATH;
  if (override?.trim()) return override;
  return join(homedir(), ".gordon", "ace-rejected.json");
}

function emptyStore(): RejectedBufferStore {
  return { version: 1, updatedAt: new Date().toISOString(), rejected: [] };
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

export function loadRejectedBuffer(): RejectedBufferStore {
  const path = getRejectedBufferPath();
  if (!existsSync(path)) return emptyStore();
  try {
    const raw = readFileSync(path, "utf8");
    const parsed = JSON.parse(raw) as Partial<RejectedBufferStore>;
    if (parsed?.version !== 1 || !Array.isArray(parsed.rejected)) {
      return emptyStore();
    }
    return {
      version: 1,
      updatedAt: parsed.updatedAt ?? new Date().toISOString(),
      rejected: parsed.rejected,
    };
  } catch (error) {
    logger.warn("Failed to load ACE rejected buffer — starting fresh", {
      error: (error as Error).message,
    });
    return emptyStore();
  }
}

function saveStore(store: RejectedBufferStore): void {
  try {
    const path = getRejectedBufferPath();
    ensureParentDir(path);
    writeFileSync(path, JSON.stringify(store, null, 2), "utf8");
  } catch (error) {
    logger.warn("Failed to write ACE rejected buffer", {
      error: (error as Error).message,
    });
  }
}

/** Returns the set of currently-rejected lesson ids for fast lookup. */
export function rejectedIds(): Set<string> {
  const store = loadRejectedBuffer();
  return new Set(store.rejected.map((r) => r.id));
}

/** Record a rejection. Idempotent on (id, reason): updates the existing
 *  entry's timestamp and resets the repropose counter. */
export function rejectLesson(input: {
  id: string;
  reason: "operator" | "auto";
  note?: string;
}): RejectedBufferStore {
  const store = loadRejectedBuffer();
  const now = new Date().toISOString();
  const existing = store.rejected.find((r) => r.id === input.id);
  if (existing) {
    existing.reason = input.reason;
    existing.rejectedAt = now;
    if (input.note !== undefined) existing.note = input.note;
    existing.reproposeCount = 0;
  } else {
    store.rejected.push({
      id: input.id,
      reason: input.reason,
      rejectedAt: now,
      ...(input.note !== undefined && { note: input.note }),
      reproposeCount: 0,
    });
  }
  store.updatedAt = now;
  saveStore(store);
  return store;
}

/** Remove a rejection so the lesson can be re-proposed again. */
export function unrejectLesson(id: string): RejectedBufferStore {
  const store = loadRejectedBuffer();
  const before = store.rejected.length;
  store.rejected = store.rejected.filter((r) => r.id !== id);
  if (store.rejected.length !== before) {
    store.updatedAt = new Date().toISOString();
    saveStore(store);
  }
  return store;
}

/** Bump repropose counters for any rejected ids that the Reflector tried
 *  to surface again. Returns the updated store. Best-effort — file write
 *  failure does not propagate. */
export function recordRepropose(reproposedIds: ReadonlyArray<string>): RejectedBufferStore {
  if (reproposedIds.length === 0) return loadRejectedBuffer();
  const store = loadRejectedBuffer();
  const reproposed = new Set(reproposedIds);
  let changed = false;
  for (const r of store.rejected) {
    if (reproposed.has(r.id)) {
      r.reproposeCount += 1;
      changed = true;
    }
  }
  if (changed) {
    store.updatedAt = new Date().toISOString();
    saveStore(store);
  }
  return store;
}
