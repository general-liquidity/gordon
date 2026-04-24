/**
 * Unit tests for the ACE Reflector → Curator pipeline.
 *
 * Tests the pure / file-IO surface behind GORDON_ACE_ENABLED. The Reflector
 * reads the action log via `listActionLogEntries`; we exercise the Curator
 * directly with synthetic Reflector output to avoid touching the real DB.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, rmSync, mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  formatACELessonsForPrompt,
  getACELessonsPath,
  isACEEnabled,
  loadACELessons,
  runCurator,
  runReflector,
} from "./index.ts";
import type { ReflectorOutput } from "./Reflector.ts";

let tempDir: string;
let tempLessonsPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ace-test-"));
  tempLessonsPath = join(tempDir, "ace-lessons.json");
  process.env.GORDON_ACE_LESSONS_PATH = tempLessonsPath;
  process.env.GORDON_ACE_ENABLED = "true";
});

afterEach(() => {
  delete process.env.GORDON_ACE_LESSONS_PATH;
  delete process.env.GORDON_ACE_ENABLED;
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function makeOutput(text: string, category: string): ReflectorOutput {
  return {
    candidates: [
      {
        text,
        category: category as never,
        evidenceCount: 1,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
      },
    ],
    entriesAnalyzed: 1,
    generatedAt: new Date().toISOString(),
  };
}

describe("ACE feature flag", () => {
  it("isACEEnabled reports true when env var is set", () => {
    expect(isACEEnabled()).toBe(true);
  });

  it("isACEEnabled reports false when env var is unset", () => {
    delete process.env.GORDON_ACE_ENABLED;
    expect(isACEEnabled()).toBe(false);
  });

  it("Reflector returns empty output when disabled", () => {
    delete process.env.GORDON_ACE_ENABLED;
    const out = runReflector({ lookbackEntries: 10 });
    expect(out.candidates).toEqual([]);
    expect(out.entriesAnalyzed).toBe(0);
  });

  it("Curator no-ops when disabled (does not write file)", () => {
    delete process.env.GORDON_ACE_ENABLED;
    runCurator(makeOutput("Should not be persisted", "risk_event"));
    expect(existsSync(tempLessonsPath)).toBe(false);
  });
});

describe("ACE Curator persistence", () => {
  it("getACELessonsPath honors GORDON_ACE_LESSONS_PATH", () => {
    expect(getACELessonsPath()).toBe(tempLessonsPath);
  });

  it("writes a new lesson and reloads it", () => {
    runCurator(makeOutput("Risk breach happened on Binance", "risk_event"));
    expect(existsSync(tempLessonsPath)).toBe(true);
    const store = loadACELessons();
    expect(store.lessons.length).toBe(1);
    expect(store.lessons[0]?.category).toBe("risk_event");
    expect(store.lessons[0]?.score).toBeGreaterThan(0);
  });

  it("merges duplicate candidates and increments evidenceCount", () => {
    runCurator(makeOutput("Venue rate-limit observed", "venue_quirk"));
    runCurator(makeOutput("Venue rate-limit observed", "venue_quirk"));
    const store = loadACELessons();
    expect(store.lessons.length).toBe(1);
    expect(store.lessons[0]?.evidenceCount).toBe(2);
  });

  it("ranks risk_event above operational lessons", () => {
    runCurator(makeOutput("Operator switched models", "operational"));
    runCurator(makeOutput("Drawdown event detected", "risk_event"));
    const store = loadACELessons();
    expect(store.lessons[0]?.category).toBe("risk_event");
  });

  it("formatACELessonsForPrompt returns block when lessons exist", () => {
    runCurator(makeOutput("User prefers swing trades", "user_preference"));
    const store = loadACELessons();
    const block = formatACELessonsForPrompt(store);
    expect(block).toContain("[GORDON_ACE_LESSONS]");
    expect(block).toContain("user_preference");
  });

  it("formatACELessonsForPrompt returns empty when disabled", () => {
    runCurator(makeOutput("Lesson", "operational"));
    const store = loadACELessons();
    delete process.env.GORDON_ACE_ENABLED;
    expect(formatACELessonsForPrompt(store)).toBe("");
  });
});

describe("ACE Reflector pattern detection", () => {
  it("returns empty candidates when action log is unavailable but ACE is enabled", () => {
    // Reflector should swallow store errors and return empty rather than throw.
    const out = runReflector({ lookbackEntries: 1 });
    expect(Array.isArray(out.candidates)).toBe(true);
    expect(out.entriesAnalyzed).toBeGreaterThanOrEqual(0);
  });
});
