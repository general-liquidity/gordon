/**
 * Proactive State Persistence
 *
 * Saves and loads the in-memory proactive subsystem state to a JSON file so
 * feedback learning, category stats, acceptance rates, and suppression
 * windows survive across Gordon restarts. Without this the category policy
 * auto-suppression rule and the outcome tracker's precision / recall numbers
 * would reset every session and never accumulate enough samples to be
 * meaningful.
 *
 * File location: <GORDON_HOME>/proactive-state.json
 * Format: single JSON object with versioning, saved atomically via
 *         write-to-temp + rename to avoid corrupting the file on crash.
 *
 * Save triggers:
 *   - Observer shutdown (clean stop)
 *   - After user accept / dismiss (debounced, max once per 10s)
 * Load triggers:
 *   - Observer startup (before any producers land suggestions)
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { createModuleLogger } from "../../logger/index.ts";
import type { ProactiveSuggestion, ProactiveCategory, SuggestionOutcome } from "../types.ts";

const logger = createModuleLogger("proactive-persistence");

const STATE_VERSION = 1;
const DEBOUNCE_MS = 10_000;

// ============================================================================
// Types
// ============================================================================

export interface PersistedFeedbackRecord {
  suggestionId: string;
  category: ProactiveCategory;
  status: string;
  outcome?: SuggestionOutcome;
  at: number;
}

export interface PersistedOutcomeRecord {
  suggestionId: string;
  category: ProactiveCategory;
  outcome: SuggestionOutcome;
  at: number;
}

export interface PersistedCategoryPolicy {
  category: ProactiveCategory;
  cooldownMs: number;
  minConfidence: number;
  maxPerHour: number;
  lastFiredAt?: number;
  recentFireTimes: number[];
  suppressedUntil?: number;
  acceptanceRate: number;
  sampleCount: number;
}

export interface PersistedProactiveState {
  version: number;
  savedAt: string;
  suggestions: ProactiveSuggestion[];
  feedback: PersistedFeedbackRecord[];
  categoryPolicies: PersistedCategoryPolicy[];
  outcomes: PersistedOutcomeRecord[];
}

// ============================================================================
// Path resolution (mirrors experimentJournal.ts pattern)
// ============================================================================

function getGordonHome(): string {
  return process.env.GORDON_HOME ?? join(homedir(), ".gordon");
}

function getStatePath(): string {
  return join(getGordonHome(), "proactive-state.json");
}

function ensureDir(): void {
  const dir = dirname(getStatePath());
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

// ============================================================================
// Save / load
// ============================================================================

let pendingSave: NodeJS.Timeout | null = null;

/**
 * Save the full proactive state to disk. Writes to a temp file first then
 * renames for atomic replacement — crash during write won't corrupt the
 * existing file.
 */
export function saveProactiveStateNow(state: PersistedProactiveState): void {
  try {
    ensureDir();
    const path = getStatePath();
    const tmp = `${path}.tmp`;
    const payload = JSON.stringify({ ...state, version: STATE_VERSION }, null, 2);
    writeFileSync(tmp, payload, "utf8");
    renameSync(tmp, path);
    logger.debug("Proactive state saved", {
      path,
      suggestions: state.suggestions.length,
      feedback: state.feedback.length,
      outcomes: state.outcomes.length,
    });
  } catch (err) {
    logger.warn("Failed to save proactive state", { err: String(err) });
  }
}

/**
 * Debounced save. Multiple calls within DEBOUNCE_MS coalesce into a single
 * write. Useful for the accept/dismiss hot path where the user might burn
 * through many suggestions quickly.
 */
export function saveProactiveStateDebounced(collector: () => PersistedProactiveState): void {
  if (pendingSave) clearTimeout(pendingSave);
  pendingSave = setTimeout(() => {
    pendingSave = null;
    saveProactiveStateNow(collector());
  }, DEBOUNCE_MS);
  if (pendingSave.unref) pendingSave.unref();
}

/** Cancel any pending debounced save. */
export function flushPendingSave(collector: () => PersistedProactiveState): void {
  if (pendingSave) {
    clearTimeout(pendingSave);
    pendingSave = null;
    saveProactiveStateNow(collector());
  }
}

/**
 * Load persisted state from disk. Returns null if the file doesn't exist,
 * can't be parsed, or is from an incompatible version. Callers handle null
 * by using in-memory defaults.
 */
export function loadProactiveState(): PersistedProactiveState | null {
  const path = getStatePath();
  if (!existsSync(path)) return null;
  try {
    const text = readFileSync(path, "utf8");
    const parsed = JSON.parse(text) as PersistedProactiveState;
    if (parsed.version !== STATE_VERSION) {
      logger.info("Proactive state file has mismatched version — ignoring", {
        fileVersion: parsed.version,
        expected: STATE_VERSION,
      });
      return null;
    }
    if (!Array.isArray(parsed.suggestions) || !Array.isArray(parsed.feedback)) {
      logger.warn("Proactive state file has unexpected shape — ignoring");
      return null;
    }
    logger.debug("Proactive state loaded", {
      path,
      suggestions: parsed.suggestions.length,
      feedback: parsed.feedback.length,
      outcomes: parsed.outcomes?.length ?? 0,
    });
    return parsed;
  } catch (err) {
    logger.warn("Failed to load proactive state", { err: String(err) });
    return null;
  }
}
