/**
 * Tests for session-persistence module
 *
 * Tests: saveSessionState, loadSessionState, clearSessionState,
 *        updateHeartbeat, isStaleSession, saveMandateState, loadMandateState, clearMandateState
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  saveSessionState,
  loadSessionState,
  clearSessionState,
  updateHeartbeat,
  isStaleSession,
  saveMandateState,
  loadMandateState,
  clearMandateState,
  setSessionPersistenceDirForTesting,
  type PersistedSessionState,
} from "./session-persistence.ts";
import { createMandate } from "../safety/swing-mandate.ts";

let tempGordonDir = "";

// Clean up before each test to avoid cross-contamination
beforeEach(() => {
  tempGordonDir = mkdtempSync(join(tmpdir(), "gordon-session-test-"));
  setSessionPersistenceDirForTesting(tempGordonDir);
  clearSessionState();
  clearMandateState();
});

afterEach(() => {
  clearSessionState();
  clearMandateState();
  setSessionPersistenceDirForTesting(null);
  if (tempGordonDir) {
    rmSync(tempGordonDir, { recursive: true, force: true });
    tempGordonDir = "";
  }
});

describe("session state persistence", () => {
  test("save and load round-trips correctly", () => {
    const state: PersistedSessionState = {
      sessionId: "test_session_1",
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      schedulerConfig: {
        intervalMs: 60000,
        topN: 50,
        minConfidence: 0.6,
        timeframes: ["4h"],
      },
      mandateId: "mandate_test",
      scanCount: 5,
      opportunitiesFound: 2,
      activePlanIds: ["plan_1", "plan_2"],
    };

    saveSessionState(state);
    const loaded = loadSessionState();
    expect(loaded).not.toBeNull();
    expect(loaded!.sessionId).toBe("test_session_1");
    expect(loaded!.scanCount).toBe(5);
    expect(loaded!.activePlanIds).toEqual(["plan_1", "plan_2"]);
  });

  test("clear removes session state", () => {
    saveSessionState({
      sessionId: "test_clear",
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      schedulerConfig: { intervalMs: 60000, topN: 50, minConfidence: 0.6, timeframes: ["4h"] },
      scanCount: 0,
      opportunitiesFound: 0,
      activePlanIds: [],
    });
    clearSessionState();
    const loaded = loadSessionState();
    expect(loaded).toBeNull();
  });

  test("updateHeartbeat updates the timestamp", () => {
    const state: PersistedSessionState = {
      sessionId: "test_heartbeat",
      startedAt: new Date(Date.now() - 60000).toISOString(),
      lastHeartbeat: new Date(Date.now() - 60000).toISOString(),
      schedulerConfig: { intervalMs: 60000, topN: 50, minConfidence: 0.6, timeframes: ["4h"] },
      scanCount: 0,
      opportunitiesFound: 0,
      activePlanIds: [],
    };
    saveSessionState(state);

    updateHeartbeat("test_heartbeat");

    const loaded = loadSessionState();
    expect(loaded).not.toBeNull();
    // Heartbeat should be more recent than the original
    const heartbeatTime = new Date(loaded!.lastHeartbeat).getTime();
    const originalTime = new Date(state.lastHeartbeat).getTime();
    expect(heartbeatTime).toBeGreaterThan(originalTime);
  });
});

describe("isStaleSession", () => {
  test("fresh session is not stale", () => {
    const state: PersistedSessionState = {
      sessionId: "fresh",
      startedAt: new Date().toISOString(),
      lastHeartbeat: new Date().toISOString(),
      schedulerConfig: { intervalMs: 60000, topN: 50, minConfidence: 0.6, timeframes: ["4h"] },
      scanCount: 0,
      opportunitiesFound: 0,
      activePlanIds: [],
    };
    expect(isStaleSession(state)).toBe(false);
  });

  test("old heartbeat is stale", () => {
    const state: PersistedSessionState = {
      sessionId: "old",
      startedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
      lastHeartbeat: new Date(Date.now() - 35 * 60 * 1000).toISOString(), // 35 min ago > 30 min threshold
      schedulerConfig: { intervalMs: 60000, topN: 50, minConfidence: 0.6, timeframes: ["4h"] },
      scanCount: 0,
      opportunitiesFound: 0,
      activePlanIds: [],
    };
    expect(isStaleSession(state)).toBe(true);
  });
});

describe("mandate state persistence", () => {
  test("save and load mandate round-trips", () => {
    const mandate = createMandate({
      symbols: ["BTCUSDT"],
      timeframe: "1d",
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });

    saveMandateState(mandate);
    const loaded = loadMandateState();
    expect(loaded).not.toBeNull();
    expect(loaded!.id).toBe(mandate.id);
    expect(loaded!.symbols).toEqual(["BTCUSDT"]);
    expect(loaded!.timeframe).toBe("1d");
  });

  test("clear removes mandate state", () => {
    const mandate = createMandate({
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
    });
    saveMandateState(mandate);
    clearMandateState();
    const loaded = loadMandateState();
    expect(loaded).toBeNull();
  });
});
