/**
 * Session-Scoped History Filtering
 *
 * Claude Code pattern: Ctrl+R history browsing prioritizes current session
 * entries first, then other sessions. Deduped by display text, newest first.
 *
 * For Gordon: keeps each trading session's command history separate.
 * Backtest sessions vs live trading sessions don't pollute each other.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { GORDON_DIR } from "../../infra/storage/paths.ts";

// ============================================================================
// Types
// ============================================================================

export interface HistoryEntry {
  /** The command/input text. */
  text: string;
  /** ISO timestamp. */
  timestamp: string;
  /** Session this entry belongs to. */
  sessionId: string;
  /** Whether this was a slash command. */
  isCommand: boolean;
}

// ============================================================================
// Storage
// ============================================================================

const HISTORY_FILE = join(GORDON_DIR, "input-history.json");
const MAX_ENTRIES = 1000;

function ensureDir(): void {
  if (!existsSync(GORDON_DIR)) mkdirSync(GORDON_DIR, { recursive: true });
}

export function loadHistory(): HistoryEntry[] {
  if (!existsSync(HISTORY_FILE)) return [];
  try {
    return JSON.parse(readFileSync(HISTORY_FILE, "utf-8")) as HistoryEntry[];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  ensureDir();
  const trimmed = entries.slice(-MAX_ENTRIES);
  writeFileSync(HISTORY_FILE, JSON.stringify(trimmed), { encoding: "utf-8", mode: 0o600 });
}

// ============================================================================
// API
// ============================================================================

/**
 * Record a user input to session history.
 */
export function recordInput(text: string, sessionId: string): void {
  if (!text.trim()) return;
  const entries = loadHistory();
  entries.push({
    text: text.trim(),
    timestamp: new Date().toISOString(),
    sessionId,
    isCommand: text.trim().startsWith("/"),
  });
  saveHistory(entries);
}

/**
 * Get history entries for Ctrl+R browsing.
 * Current session entries come first (newest first), then other sessions.
 * Deduped by display text.
 */
export function getFilteredHistory(
  currentSessionId: string,
  filter?: string,
): HistoryEntry[] {
  const all = loadHistory();

  // Split into current session vs others
  const currentSession: HistoryEntry[] = [];
  const otherSessions: HistoryEntry[] = [];

  for (const entry of all) {
    if (entry.sessionId === currentSessionId) currentSession.push(entry);
    else otherSessions.push(entry);
  }

  // Reverse both (newest first)
  currentSession.reverse();
  otherSessions.reverse();

  // Merge: current session first, then others
  const merged = [...currentSession, ...otherSessions];

  // Dedupe by text (keep first occurrence = newest)
  const seen = new Set<string>();
  const deduped: HistoryEntry[] = [];
  for (const entry of merged) {
    if (seen.has(entry.text)) continue;
    seen.add(entry.text);
    deduped.push(entry);
  }

  // Apply filter if provided
  if (filter) {
    const lower = filter.toLowerCase();
    return deduped.filter((e) => e.text.toLowerCase().includes(lower));
  }

  return deduped;
}

/**
 * Get only slash command history (for command palette suggestions).
 */
export function getCommandHistory(currentSessionId: string): HistoryEntry[] {
  return getFilteredHistory(currentSessionId).filter((e) => e.isCommand);
}

/**
 * Clear history for a specific session.
 */
export function clearSessionHistory(sessionId: string): number {
  const entries = loadHistory();
  const filtered = entries.filter((e) => e.sessionId !== sessionId);
  const removed = entries.length - filtered.length;
  saveHistory(filtered);
  return removed;
}
