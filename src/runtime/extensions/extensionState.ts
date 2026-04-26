/**
 * Extension State persistence — per-session snapshot of enabled MCP
 * extensions so resuming a session restores its tool surface.
 *
 * Inspired by Goose's `load_extensions_from_session()`. Keeps the
 * file shape minimal: just the enabled IDs + a timestamp. The
 * marketplace registry is the source of truth for everything else
 * (catalog metadata, install paths, credentials).
 *
 * File: `~/.gordon/sessions/{sessionId}.extensions.json`
 *
 * Failure mode: if the file is corrupt or unreadable, `loadExtensionState`
 * returns null and the session boots with whatever the marketplace
 * registry's default-enabled list says — same effective behaviour as
 * a fresh session.
 */

import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { getGordonDir } from "../../infra/storage/paths.ts";

export interface ExtensionState {
  sessionId: string;
  /** Extension IDs enabled at the time the snapshot was taken. */
  enabledExtensionIds: string[];
  /** Wall-clock when this snapshot was written. */
  lastUpdatedAt: string;
  /** Schema version — bump on incompatible format changes. */
  version: 1;
}

let directoryOverride: string | null = null;

export function setExtensionStateDirForTesting(dir: string | null): void {
  directoryOverride = dir;
}

function dir(): string {
  return directoryOverride ?? join(getGordonDir(), "sessions");
}

function pathFor(sessionId: string): string {
  return join(dir(), `${sessionId}.extensions.json`);
}

function ensureDir(filePath: string): void {
  const parent = dirname(filePath);
  if (!existsSync(parent)) mkdirSync(parent, { recursive: true });
}

/**
 * Persist the current set of enabled extensions for a session.
 * Atomic-write via tmpfile + rename so a crash mid-write can't
 * leave a half-written JSON file.
 */
export function saveExtensionState(state: Omit<ExtensionState, "lastUpdatedAt" | "version">): void {
  const file = pathFor(state.sessionId);
  ensureDir(file);
  const payload: ExtensionState = {
    sessionId: state.sessionId,
    enabledExtensionIds: [...state.enabledExtensionIds].sort(),
    lastUpdatedAt: new Date().toISOString(),
    version: 1,
  };
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
  // rename is atomic on POSIX; on Windows it's effectively atomic for our use case.
  // Use writeFileSync + replace to avoid an unlink dance with stale handles.
  try {
    require("node:fs").renameSync(tmp, file);
  } catch {
    // Some Windows configs reject rename if target exists — fall back to overwrite.
    writeFileSync(file, JSON.stringify(payload, null, 2), { encoding: "utf-8", mode: 0o600 });
    try { unlinkSync(tmp); } catch {/* ignore */}
  }
}

/**
 * Load extension state for a session. Returns null when no snapshot
 * exists, the file is unreadable, or the schema is wrong.
 */
export function loadExtensionState(sessionId: string): ExtensionState | null {
  const file = pathFor(sessionId);
  if (!existsSync(file)) return null;
  try {
    const raw = readFileSync(file, "utf-8");
    const parsed = JSON.parse(raw) as ExtensionState;
    if (typeof parsed.sessionId !== "string" || !Array.isArray(parsed.enabledExtensionIds)) return null;
    if (parsed.version !== 1) return null;
    // Defensive: drop non-string entries the file may have collected via
    // older versions or tampering.
    const cleanIds = parsed.enabledExtensionIds.filter((x): x is string => typeof x === "string");
    return {
      sessionId: parsed.sessionId,
      enabledExtensionIds: cleanIds,
      lastUpdatedAt: typeof parsed.lastUpdatedAt === "string" ? parsed.lastUpdatedAt : new Date().toISOString(),
      version: 1,
    };
  } catch {
    return null;
  }
}

/** Remove the snapshot — used when a session ends cleanly. */
export function clearExtensionState(sessionId: string): boolean {
  const file = pathFor(sessionId);
  if (!existsSync(file)) return false;
  try {
    unlinkSync(file);
    return true;
  } catch {
    return false;
  }
}

/**
 * Compare last-saved snapshot against current enabled list. Useful
 * for "extension drift" warnings on session resume — e.g., the user
 * uninstalled an extension between sessions and the saved state still
 * references it.
 */
export interface DriftReport {
  /** IDs in the saved snapshot but not in the current enabled list. */
  missingFromCurrent: string[];
  /** IDs currently enabled that weren't in the saved snapshot. */
  newSinceSnapshot: string[];
  /** Total number of differences. */
  totalDrift: number;
}

export function computeDrift(
  saved: ExtensionState | null,
  currentEnabled: string[],
): DriftReport {
  const savedSet = new Set(saved?.enabledExtensionIds ?? []);
  const currentSet = new Set(currentEnabled);
  const missingFromCurrent = [...savedSet].filter((id) => !currentSet.has(id));
  const newSinceSnapshot = [...currentSet].filter((id) => !savedSet.has(id));
  return {
    missingFromCurrent,
    newSinceSnapshot,
    totalDrift: missingFromCurrent.length + newSinceSnapshot.length,
  };
}
