/**
 * Session Persistence
 * Persists Gordon session state to disk for long-running sessions and crash recovery
 */

import { createModuleLogger } from "../infra/logger/index.ts";
import * as fs from "node:fs";
import * as path from "node:path";
import { GORDON_DIR } from "../infra/storage/paths.ts";

const logger = createModuleLogger("session-persistence");
const SESSION_FILE = path.join(GORDON_DIR, "session-state.json");
const MANDATE_FILE = path.join(GORDON_DIR, "active-mandate.json");

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
  if (!fs.existsSync(GORDON_DIR)) {
    fs.mkdirSync(GORDON_DIR, { recursive: true });
    logger.info("Created .gordon directory", { path: GORDON_DIR });
  }
}

// ============================================================================
// Session State
// ============================================================================

export function saveSessionState(state: PersistedSessionState): void {
  try {
    ensureGordonDir();
    fs.writeFileSync(SESSION_FILE, JSON.stringify(state, null, 2), "utf-8");
    logger.debug("Session state saved", { sessionId: state.sessionId });
  } catch (error) {
    logger.error("Failed to save session state", error as Error);
  }
}

export function loadSessionState(): PersistedSessionState | null {
  try {
    if (!fs.existsSync(SESSION_FILE)) return null;
    const data = fs.readFileSync(SESSION_FILE, "utf-8");
    return JSON.parse(data) as PersistedSessionState;
  } catch (error) {
    logger.error("Failed to load session state", error as Error);
    return null;
  }
}

export function clearSessionState(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      fs.unlinkSync(SESSION_FILE);
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

import type { SwingMandate } from "./swing-mandate.ts";

export function saveMandateState(mandate: SwingMandate): void {
  try {
    ensureGordonDir();
    fs.writeFileSync(MANDATE_FILE, JSON.stringify(mandate, null, 2), "utf-8");
    logger.info("Mandate state saved", { mandateId: mandate.id });
  } catch (error) {
    logger.error("Failed to save mandate state", error as Error);
  }
}

export function loadMandateState(): SwingMandate | null {
  try {
    if (!fs.existsSync(MANDATE_FILE)) return null;
    const data = fs.readFileSync(MANDATE_FILE, "utf-8");
    return JSON.parse(data) as SwingMandate;
  } catch (error) {
    logger.error("Failed to load mandate state", error as Error);
    return null;
  }
}

export function clearMandateState(): void {
  try {
    if (fs.existsSync(MANDATE_FILE)) {
      fs.unlinkSync(MANDATE_FILE);
      logger.info("Mandate state cleared");
    }
  } catch (error) {
    logger.error("Failed to clear mandate state", error as Error);
  }
}
