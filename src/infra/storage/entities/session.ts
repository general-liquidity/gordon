/**
 * Session Storage
 * Manages persistent session state for Mastra agent threadId and resourceId
 *
 * This enables session resume functionality where users can continue
 * previous conversations with full context from semantic memory.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { GORDON_DIR } from "../paths.ts";

// SESSION_FILE is computed via a getter so tests can swap the path
// per-test via setSessionPathForTesting. Production callers see the
// usual ~/.gordon/session.json behavior.
let sessionFileOverride: string | null = null;
function sessionFilePath(): string {
  return sessionFileOverride ?? join(GORDON_DIR, "session.json");
}

/** Test-only seam — swap the on-disk session path for isolated tests.
 *  Pass `null` to restore the production path. */
export function setSessionPathForTesting(path: string | null): void {
  sessionFileOverride = path;
}

/**
 * Per-thread record. Stored in the `threads` array so the operator can
 * list, switch, and fork past conversations — not just resume the most
 * recent one. Pattern from claude-code-from-scratch s17 (MIT).
 */
export interface ThreadRecord {
  /** Thread ID — the same string used by Mastra for memory namespacing. */
  threadId: string;
  /** When this thread was first opened. */
  startedAt: string;
  /** Last time a message was added to this thread. */
  lastActiveAt: string;
  /** Operator-supplied human-readable label. Optional; defaults to ''. */
  title: string;
  /** Source thread when this one was forked from an existing thread.
   *  null for original threads. */
  forkedFrom: string | null;
}

/**
 * Session state persisted to disk
 */
export interface SessionState {
  /** Unique user/resource ID (persistent across sessions) */
  resourceId: string;
  /** Current thread ID for conversation continuity */
  threadId: string | null;
  /** When the current thread was started */
  threadStartedAt: string | null;
  /** When the session was last active */
  lastActiveAt: string;
  /** Total number of sessions created */
  sessionCount: number;
  /** All threads tracked locally. May be empty in legacy installs that
   *  predate multi-thread tracking — the migration path fills it in
   *  lazily when threads are touched. Sorted by lastActiveAt desc. */
  threads?: ThreadRecord[];
}

/**
 * Session info returned when loading/creating sessions
 */
export interface SessionInfo {
  resourceId: string;
  threadId: string;
  isNewSession: boolean;
  previousThreadId: string | null;
}

/**
 * Ensure the parent directory of the session file exists.
 * Uses sessionFilePath() so tests with overridden paths also pre-create
 * the right scratch dir.
 */
async function ensureGordonDir(): Promise<void> {
  await mkdir(dirname(sessionFilePath()), { recursive: true });
}

/**
 * Generate a new resource ID for the user
 * This ID is persistent and identifies the user across all sessions
 */
function generateResourceId(): string {
  return `user-${randomUUID().slice(0, 8)}`;
}

/**
 * Generate a new thread ID for a conversation
 * Each session gets a unique thread ID for memory isolation
 */
export function generateThreadId(resourceId: string): string {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 6);
  return `thread-${resourceId}-${timestamp}-${random}`;
}

/**
 * Get default session state for new installations
 */
function getDefaultSessionState(): SessionState {
  const resourceId = generateResourceId();
  return {
    resourceId,
    threadId: null,
    threadStartedAt: null,
    lastActiveAt: new Date().toISOString(),
    sessionCount: 0,
  };
}

/**
 * Load the current session state from disk
 * Creates a new session state if none exists
 */
export async function loadSessionState(): Promise<SessionState> {
  await ensureGordonDir();

  try {
    const content = await readFile(sessionFilePath(), "utf-8");
    const state = JSON.parse(content) as SessionState;

    // Validate required fields
    if (!state.resourceId) {
      state.resourceId = generateResourceId();
    }

    return state;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist, create default state
      const defaultState = getDefaultSessionState();
      await saveSessionState(defaultState);
      return defaultState;
    }
    throw error;
  }
}

/**
 * Save session state to disk
 */
export async function saveSessionState(state: SessionState): Promise<void> {
  await ensureGordonDir();
  await writeFile(sessionFilePath(), JSON.stringify(state, null, 2), "utf-8");
}

/**
 * Add or update a thread record in the SessionState. Idempotent on
 * threadId. Defensive — accepts SessionStates that don't yet have the
 * `threads` field (older session.json files) and creates it on first
 * write.
 */
function upsertThreadRecord(state: SessionState, record: ThreadRecord): void {
  if (!state.threads) state.threads = [];
  const existing = state.threads.findIndex((t) => t.threadId === record.threadId);
  if (existing >= 0) {
    state.threads[existing] = { ...state.threads[existing], ...record };
  } else {
    state.threads.push(record);
  }
  // Keep newest-first ordering — cheap for the small N we expect.
  state.threads.sort(
    (a, b) => Date.parse(b.lastActiveAt) - Date.parse(a.lastActiveAt),
  );
}

/**
 * Initialize or resume a session
 *
 * If autoResume is true, it will try to resume the last thread.
 * Otherwise, it creates a new thread.
 *
 * @param options - Session initialization options
 * @returns Session info with threadId and resourceId
 */
export async function initializeSession(options: {
  autoResume?: boolean;
  forceNewThread?: boolean;
} = {}): Promise<SessionInfo> {
  const { autoResume = false, forceNewThread = false } = options;

  const state = await loadSessionState();
  const previousThreadId = state.threadId;

  // Determine if we should create a new thread
  const shouldCreateNewThread = forceNewThread || !state.threadId || !autoResume;

  let threadId: string;
  let isNewSession: boolean;

  if (shouldCreateNewThread) {
    // Create a new thread
    threadId = generateThreadId(state.resourceId);
    isNewSession = true;

    // Update state with new thread
    state.threadId = threadId;
    state.threadStartedAt = new Date().toISOString();
    state.sessionCount += 1;

    upsertThreadRecord(state, {
      threadId,
      startedAt: state.threadStartedAt,
      lastActiveAt: state.threadStartedAt,
      title: "",
      forkedFrom: null,
    });
  } else {
    // Resume existing thread
    threadId = state.threadId!;
    isNewSession = false;
  }

  // Update last active time
  state.lastActiveAt = new Date().toISOString();
  if (state.threadId) {
    // Touch the current thread's lastActiveAt in the threads list too.
    const startedAt =
      state.threads?.find((t) => t.threadId === state.threadId)?.startedAt ??
      state.threadStartedAt ??
      new Date().toISOString();
    upsertThreadRecord(state, {
      threadId: state.threadId,
      startedAt,
      lastActiveAt: state.lastActiveAt,
      title: state.threads?.find((t) => t.threadId === state.threadId)?.title ?? "",
      forkedFrom: state.threads?.find((t) => t.threadId === state.threadId)?.forkedFrom ?? null,
    });
  }

  await saveSessionState(state);

  return {
    resourceId: state.resourceId,
    threadId,
    isNewSession,
    previousThreadId: isNewSession ? previousThreadId : null,
  };
}

/**
 * List all locally-tracked threads, newest first. Returns an empty
 * array when no threads have been opened yet on this install.
 */
export async function listThreads(): Promise<ThreadRecord[]> {
  const state = await loadSessionState();
  return [...(state.threads ?? [])];
}

/**
 * Fork from an existing thread. Creates a new threadId that records
 * the source via `forkedFrom`. Does NOT copy Mastra's conversation
 * memory — the caller is responsible for asking Mastra to seed the new
 * thread from the source (typically the orchestrator does this on
 * first turn of the new thread). What this function DOES do is:
 *
 *   - Generate a new threadId
 *   - Create a ThreadRecord with forkedFrom set
 *   - Switch the active threadId to the new one
 *
 * Use case: "I want to explore an alternate path from this point in
 * the conversation without losing the original thread."
 */
export async function forkThread(sourceThreadId: string, title = ""): Promise<SessionInfo> {
  const state = await loadSessionState();
  const source = state.threads?.find((t) => t.threadId === sourceThreadId);
  if (!source) {
    throw new Error(`Cannot fork: thread ${sourceThreadId} not found in local registry`);
  }
  const newThreadId = generateThreadId(state.resourceId);
  const now = new Date().toISOString();
  const previousThreadId = state.threadId;
  state.threadId = newThreadId;
  state.threadStartedAt = now;
  state.lastActiveAt = now;
  state.sessionCount += 1;
  upsertThreadRecord(state, {
    threadId: newThreadId,
    startedAt: now,
    lastActiveAt: now,
    title,
    forkedFrom: sourceThreadId,
  });
  await saveSessionState(state);
  return {
    resourceId: state.resourceId,
    threadId: newThreadId,
    isNewSession: true,
    previousThreadId,
  };
}

/**
 * Switch the active thread to one already in the local registry.
 * Returns null when the threadId is unknown. Operator-facing — they
 * pick from `listThreads()` and switch by id.
 */
export async function switchThread(threadId: string): Promise<SessionInfo | null> {
  const state = await loadSessionState();
  const target = state.threads?.find((t) => t.threadId === threadId);
  if (!target) return null;
  const previousThreadId = state.threadId;
  state.threadId = threadId;
  state.threadStartedAt = target.startedAt;
  state.lastActiveAt = new Date().toISOString();
  upsertThreadRecord(state, {
    ...target,
    lastActiveAt: state.lastActiveAt,
  });
  await saveSessionState(state);
  return {
    resourceId: state.resourceId,
    threadId,
    isNewSession: false,
    previousThreadId,
  };
}

/**
 * Set a human-readable title on a thread. Returns true on success,
 * false if the threadId is unknown.
 */
export async function setThreadTitle(threadId: string, title: string): Promise<boolean> {
  const state = await loadSessionState();
  const target = state.threads?.find((t) => t.threadId === threadId);
  if (!target) return false;
  target.title = title.trim();
  state.lastActiveAt = new Date().toISOString();
  await saveSessionState(state);
  return true;
}

/**
 * Resume the previous session if one exists
 *
 * @returns Session info with the previous thread ID, or null if no previous session
 */
export async function resumeSession(): Promise<SessionInfo | null> {
  const state = await loadSessionState();

  if (!state.threadId) {
    return null;
  }

  // Update last active time
  state.lastActiveAt = new Date().toISOString();
  await saveSessionState(state);

  return {
    resourceId: state.resourceId,
    threadId: state.threadId,
    isNewSession: false,
    previousThreadId: null,
  };
}

/**
 * Start a new session (creates a new thread)
 * Preserves the resourceId but creates a fresh thread
 */
export async function startNewSession(): Promise<SessionInfo> {
  return initializeSession({ forceNewThread: true });
}

/**
 * Get the current session info without modifying state
 */
export async function getCurrentSession(): Promise<{
  resourceId: string;
  threadId: string | null;
  threadStartedAt: string | null;
  lastActiveAt: string;
  sessionCount: number;
}> {
  const state = await loadSessionState();
  return {
    resourceId: state.resourceId,
    threadId: state.threadId,
    threadStartedAt: state.threadStartedAt,
    lastActiveAt: state.lastActiveAt,
    sessionCount: state.sessionCount,
  };
}

/**
 * Update the current thread ID
 * Useful when switching threads or after agent operations
 */
export async function updateThreadId(threadId: string): Promise<void> {
  const state = await loadSessionState();
  state.threadId = threadId;
  state.lastActiveAt = new Date().toISOString();
  await saveSessionState(state);
}

/**
 * Clear the current session (but preserve resourceId)
 * Used when explicitly ending a session
 */
export async function clearSession(): Promise<void> {
  const state = await loadSessionState();
  state.threadId = null;
  state.threadStartedAt = null;
  state.lastActiveAt = new Date().toISOString();
  await saveSessionState(state);
}

/**
 * Get session age in milliseconds
 * Returns null if no active session
 */
export async function getSessionAge(): Promise<number | null> {
  const state = await loadSessionState();

  if (!state.threadStartedAt) {
    return null;
  }

  const startTime = new Date(state.threadStartedAt).getTime();
  return Date.now() - startTime;
}

/**
 * Check if the current session is stale (older than maxHours)
 */
export async function isSessionStale(maxHours: number = 24): Promise<boolean> {
  const age = await getSessionAge();

  if (age === null) {
    return true; // No session is considered stale
  }

  const maxAgeMs = maxHours * 60 * 60 * 1000;
  return age > maxAgeMs;
}
