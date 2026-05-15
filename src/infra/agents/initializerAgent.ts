/**
 * Initializer Agent (GORDON_INITIALIZER_AGENT).
 *
 * Trading-domain port of Anthropic's "initializer agent" pattern from
 * "Effective harnesses for long-running agents" (2026). The initializer
 * runs ONCE on the very first session of a new Gordon environment and
 * writes the durable contracts that subsequent sessions read:
 *
 *   - the initial sprint contract (scope / standards / exclusions)
 *   - the initial active mandate (risk envelope)
 *   - the initial trading feature list (target capabilities)
 *
 * Anthropic's version generates an `init.sh` + `claude-progress.txt`. The
 * trading-domain version writes structured JSON artifacts instead — the
 * shapes are caller-defined; this primitive only enforces the
 * one-shot semantics.
 *
 * Subsequent sessions check `isInitialized()` and skip the initializer
 * entirely. The marker file at `~/.gordon/initialized.json` records:
 *
 *   { initializedAt, version, configHash, artifactsWritten[] }
 *
 * This module is the **state machine only**. It does NOT call any LLM.
 * The caller decides how to generate the initial artifacts (LLM, defaults,
 * user input) and supplies them via `runInitializer(payload)`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

export const INITIALIZER_AGENT_FLAG_ENV = "GORDON_INITIALIZER_AGENT";
export const INITIALIZER_MARKER_PATH_ENV = "GORDON_INITIALIZER_MARKER_PATH";

export interface InitializationMarker {
  /** ISO timestamp of when the initializer ran. */
  initializedAt: string;
  /** Schema version of the marker file. */
  version: number;
  /** Stable hash of the initial config (sprint contract + mandate + feature list). */
  configHash: string;
  /** Paths of the artifacts the initializer wrote. */
  artifactsWritten: string[];
  /** Optional free-form notes. */
  notes?: string[];
}

export interface InitializerPayload {
  /** Hash of the initial config for change-detection. */
  configHash: string;
  /** Paths of artifacts that were written this initialization run. */
  artifactsWritten: string[];
  notes?: string[];
}

export interface RunInitializerOptions {
  /** Marker file path (default ~/.gordon/initialized.json). */
  markerPath?: string;
  /** Override clock for tests. */
  now?: string;
  /**
   * Force re-initialization even if a marker exists. The new marker's
   * `notes` get a "re-initialized: <reason>" entry.
   */
  force?: boolean;
  forceReason?: string;
}

export interface RunInitializerResult {
  ran: boolean;
  reason: "first_session" | "forced" | "already_initialized";
  marker: InitializationMarker | null;
}

export function isInitializerAgentEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    env[INITIALIZER_AGENT_FLAG_ENV] === "1" ||
    env[INITIALIZER_AGENT_FLAG_ENV] === "true"
  );
}

export function defaultInitializerMarkerPath(env: NodeJS.ProcessEnv = process.env): string {
  return env[INITIALIZER_MARKER_PATH_ENV] ?? join(homedir(), ".gordon", "initialized.json");
}

function ensureParentDir(path: string): void {
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

/** Has the initializer run for this Gordon environment? */
export function isInitialized(markerPath?: string): boolean {
  const target = markerPath ?? defaultInitializerMarkerPath();
  if (!existsSync(target)) return false;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as InitializationMarker;
    return typeof parsed.initializedAt === "string" && typeof parsed.version === "number";
  } catch {
    return false;
  }
}

export function loadInitializationMarker(markerPath?: string): InitializationMarker | null {
  const target = markerPath ?? defaultInitializerMarkerPath();
  if (!existsSync(target)) return null;
  try {
    const parsed = JSON.parse(readFileSync(target, "utf8")) as InitializationMarker;
    if (typeof parsed.initializedAt !== "string" || typeof parsed.version !== "number") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeInitializationMarker(
  marker: InitializationMarker,
  markerPath?: string,
): void {
  const target = markerPath ?? defaultInitializerMarkerPath();
  ensureParentDir(target);
  writeFileSync(target, JSON.stringify(marker, null, 2), "utf8");
}

/**
 * One-shot initializer state machine. Subsequent calls are no-ops unless
 * `force=true`. Returns `ran=true` only when the initializer actually
 * ran (first session, or forced).
 *
 * Important: this function does NOT generate any content. The caller
 * writes the actual artifacts (sprint contract, mandate, feature list)
 * BEFORE calling `runInitializer` and supplies their paths in
 * `payload.artifactsWritten`. The function records the marker.
 */
export function runInitializer(
  payload: InitializerPayload,
  opts: RunInitializerOptions = {},
): RunInitializerResult {
  const target = opts.markerPath ?? defaultInitializerMarkerPath();

  if (!opts.force && isInitialized(target)) {
    return {
      ran: false,
      reason: "already_initialized",
      marker: loadInitializationMarker(target),
    };
  }

  const reason: "first_session" | "forced" = opts.force ? "forced" : "first_session";
  const notes: string[] = [...(payload.notes ?? [])];
  if (opts.force && opts.forceReason) {
    notes.push(`re-initialized: ${opts.forceReason}`);
  }

  const marker: InitializationMarker = {
    initializedAt: opts.now ?? new Date().toISOString(),
    version: 1,
    configHash: payload.configHash,
    artifactsWritten: [...payload.artifactsWritten],
    notes: notes.length > 0 ? notes : undefined,
  };
  writeInitializationMarker(marker, target);

  return { ran: true, reason, marker };
}

/**
 * Stable hash of a payload object. Used as `configHash` so subsequent
 * sessions can detect drift between expected and actual config.
 */
export function hashInitConfig(payload: Record<string, unknown>): string {
  const s = JSON.stringify(payload);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).padStart(8, "0");
}

export function markerToPayload(marker: InitializationMarker): Record<string, unknown> {
  return {
    kind: "initializer.marker_recorded",
    initializedAt: marker.initializedAt,
    version: marker.version,
    configHash: marker.configHash,
    artifactCount: marker.artifactsWritten.length,
  };
}
