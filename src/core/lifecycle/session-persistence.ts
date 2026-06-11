/**
 * Session Persistence
 * Persists Gordon session state to disk for long-running sessions and crash recovery
 */

import { createModuleLogger } from "../../infra/logger/index.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { getGordonDir } from "../../infra/storage/paths.ts";

const logger = createModuleLogger("session-persistence");
let persistenceDirOverride: string | null = null;

function getPersistenceDir(): string {
  return persistenceDirOverride ?? getGordonDir();
}

function getSessionFilePath(): string {
  return path.join(getPersistenceDir(), "session-state.json");
}

function getMandateFilePath(): string {
  return path.join(getPersistenceDir(), "active-mandate.json");
}

export function setSessionPersistenceDirForTesting(directory: string | null): void {
  persistenceDirOverride = directory;
}

// ============================================================================
// Types
// ============================================================================

export interface PersistedSessionState {
  sessionId: string;
  startedAt: string;
  lastHeartbeat: string;
  schedulerConfig?: {
    intervalMs: number;
    topN: number;
    minConfidence: number;
    timeframes: string[];
  };
  mandateId?: string;
  scanCount: number;
  opportunitiesFound: number;
  activePlanIds: string[];
}

// ============================================================================
// Directory Management
// ============================================================================

function ensureGordonDir(): void {
  const gordonDir = getPersistenceDir();
  if (!fs.existsSync(gordonDir)) {
    fs.mkdirSync(gordonDir, { recursive: true });
    logger.info("Created .gordon directory", { path: gordonDir });
  }
}

// ============================================================================
// Session State
// ============================================================================

export function saveSessionState(state: PersistedSessionState): void {
  try {
    ensureGordonDir();
    fs.writeFileSync(getSessionFilePath(), JSON.stringify(state, null, 2), "utf-8");
    logger.debug("Session state saved", { sessionId: state.sessionId });
  } catch (error) {
    logger.error("Failed to save session state", error as Error);
  }
}

export function loadSessionState(): PersistedSessionState | null {
  try {
    const sessionFile = getSessionFilePath();
    if (!fs.existsSync(sessionFile)) return null;
    const data = fs.readFileSync(sessionFile, "utf-8");
    return JSON.parse(data) as PersistedSessionState;
  } catch (error) {
    logger.error("Failed to load session state", error as Error);
    return null;
  }
}

export function clearSessionState(): void {
  try {
    const sessionFile = getSessionFilePath();
    if (fs.existsSync(sessionFile)) {
      fs.unlinkSync(sessionFile);
      logger.info("Session state cleared");
    }
  } catch (error) {
    logger.error("Failed to clear session state", error as Error);
  }
}

export function updateHeartbeat(sessionId: string): void {
  const state = loadSessionState();
  if (state && state.sessionId === sessionId) {
    state.lastHeartbeat = new Date().toISOString();
    saveSessionState(state);
  }
}

export function isStaleSession(state: PersistedSessionState, maxAgeMs: number = 30 * 60 * 1000): boolean {
  const lastBeat = new Date(state.lastHeartbeat).getTime();
  return Date.now() - lastBeat > maxAgeMs;
}

// ============================================================================
// Mandate Persistence
// ============================================================================

import type { SwingMandate } from "../safety/swing-mandate.ts";

export function saveMandateState(mandate: SwingMandate): void {
  try {
    ensureGordonDir();
    fs.writeFileSync(getMandateFilePath(), JSON.stringify(mandate, null, 2), "utf-8");
    logger.info("Mandate state saved", { mandateId: mandate.id });
  } catch (error) {
    logger.error("Failed to save mandate state", error as Error);
  }
}

export function loadMandateState(): SwingMandate | null {
  try {
    const mandateFile = getMandateFilePath();
    if (!fs.existsSync(mandateFile)) return null;
    const data = fs.readFileSync(mandateFile, "utf-8");
    return JSON.parse(data) as SwingMandate;
  } catch (error) {
    logger.error("Failed to load mandate state", error as Error);
    return null;
  }
}

export function clearMandateState(): void {
  try {
    const mandateFile = getMandateFilePath();
    if (fs.existsSync(mandateFile)) {
      fs.unlinkSync(mandateFile);
      logger.info("Mandate state cleared");
    }
  } catch (error) {
    logger.error("Failed to clear mandate state", error as Error);
  }
}
