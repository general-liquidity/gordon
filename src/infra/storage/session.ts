/**
 * Session Storage
 * Manages persistent session state for Mastra agent threadId and resourceId
 *
 * This enables session resume functionality where users can continue
 * previous conversations with full context from semantic memory.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { GORDON_DIR } from "./paths.ts";
const SESSION_FILE = join(GORDON_DIR, "session.json");

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
 * Ensure the gordon directory exists
 */
async function ensureGordonDir(): Promise<void> {
  await mkdir(GORDON_DIR, { recursive: true });
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
    const content = await readFile(SESSION_FILE, "utf-8");
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
  await writeFile(SESSION_FILE, JSON.stringify(state, null, 2), "utf-8");
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
  } else {
    // Resume existing thread
    threadId = state.threadId!;
    isNewSession = false;
  }

  // Update last active time
  state.lastActiveAt = new Date().toISOString();

  await saveSessionState(state);

  return {
    resourceId: state.resourceId,
    threadId,
    isNewSession,
    previousThreadId: isNewSession ? previousThreadId : null,
  };
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
