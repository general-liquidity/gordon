import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCurator, loadACELessons } from "./Curator.ts";
import { rejectLesson, loadRejectedBuffer } from "./RejectedBuffer.ts";
import type { ACELessonCandidate, ReflectorOutput } from "./Reflector.ts";

const LESSONS_PATH = join(tmpdir(), `gordon-ace-lessons-budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);
const REJECTED_PATH = join(tmpdir(), `gordon-ace-rejected-budget-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`);

function candidate(category: ACELessonCandidate["category"], text: string, evidence = 1): ACELessonCandidate {
  return {
    category,
    text,
    evidenceCount: evidence,
    firstSeenAt: Date.now() - 60_000,
    lastSeenAt: Date.now(),
    evidenceEntryIds: [],
  };
}

function makeOutput(candidates: ACELessonCandidate[]): ReflectorOutput {
  return {
    candidates,
    entriesAnalyzed: candidates.length,
    generatedAt: new Date().toISOString(),
  };
}

beforeEach(() => {
  process.env.GORDON_ACE_ENABLED = "true";
  process.env.GORDON_ACE_LESSONS_PATH = LESSONS_PATH;
  process.env.GORDON_ACE_REJECTED_PATH = REJECTED_PATH;
  if (existsSync(LESSONS_PATH)) rmSync(LESSONS_PATH);
  if (existsSync(REJECTED_PATH)) rmSync(REJECTED_PATH);
});

afterEach(() => {
  if (existsSync(LESSONS_PATH)) rmSync(LESSONS_PATH);
  if (existsSync(REJECTED_PATH)) rmSync(REJECTED_PATH);
  delete process.env.GORDON_ACE_ENABLED;
  delete process.env.GORDON_ACE_LESSONS_PATH;
  delete process.env.GORDON_ACE_REJECTED_PATH;
  delete process.env.GORDON_ACE_EDIT_BUDGET;
});

describe("ACE edit budget + rejected filter", () => {
  test("caps NEW lessons per cycle to the default budget of 4", () => {
    runCurator(
      makeOutput([
        candidate("risk_event", "lesson A", 5),
        candidate("risk_event", "lesson B", 4),
        candidate("execution_failure", "lesson C", 3),
        candidate("execution_failure", "lesson D", 2),
        candidate("user_preference", "lesson E", 1),
        candidate("user_preference", "lesson F", 1),
      ]),
    );
    expect(loadACELessons().lessons.length).toBe(4);
  });

  test("env override widens the budget", () => {
    process.env.GORDON_ACE_EDIT_BUDGET = "6";
    runCurator(
      makeOutput([
        candidate("risk_event", "a", 5),
        candidate("risk_event", "b", 4),
        candidate("execution_failure", "c", 3),
        candidate("execution_failure", "d", 2),
        candidate("user_preference", "e", 1),
        candidate("user_preference", "f", 1),
      ]),
    );
    expect(loadACELessons().lessons.length).toBe(6);
  });

  test("merges of existing lessons do NOT count against the budget", () => {
    // Inferred categories (execution_failure, strategy_decay) carry evidence>=2
    // so they clear the repeated-signal bar — this test isolates the BUDGET path.
    runCurator(
      makeOutput([
        candidate("risk_event", "alpha", 1),
        candidate("risk_event", "beta", 1),
        candidate("execution_failure", "gamma", 2),
        candidate("user_preference", "delta", 1),
      ]),
    );
    expect(loadACELessons().lessons.length).toBe(4);
    runCurator(
      makeOutput([
        candidate("risk_event", "alpha", 1),
        candidate("risk_event", "beta", 1),
        candidate("execution_failure", "gamma", 2),
        candidate("user_preference", "delta", 1),
        candidate("strategy_decay", "new1", 2),
        candidate("strategy_decay", "new2", 2),
        candidate("strategy_decay", "new3", 2),
        candidate("strategy_decay", "new4", 2),
        candidate("strategy_decay", "new5", 2),
      ]),
    );
    expect(loadACELessons().lessons.length).toBe(8);
  });

  test("rejected lessons never enter the store", () => {
    rejectLesson({ id: "risk_event::stop-too-tight", reason: "operator" });
    runCurator(
      makeOutput([
        candidate("risk_event", "stop too tight", 5),
        candidate("execution_failure", "other lesson", 3),
      ]),
    );
    const ids = loadACELessons().lessons.map((l) => l.id);
    expect(ids).not.toContain("risk_event::stop-too-tight");
    expect(ids.length).toBe(1);
  });

  test("re-proposed rejected lessons bump the repropose counter", () => {
    rejectLesson({ id: "venue_quirk::min-size", reason: "auto" });
    runCurator(
      makeOutput([
        candidate("venue_quirk", "min size", 1),
        candidate("venue_quirk", "min size", 1),
      ]),
    );
    const entry = loadRejectedBuffer().rejected.find((r) => r.id === "venue_quirk::min-size")!;
    expect(entry.reproposeCount).toBeGreaterThanOrEqual(1);
  });

  test("budget selects highest-scoring candidates when over cap", () => {
    process.env.GORDON_ACE_EDIT_BUDGET = "2";
    runCurator(
      makeOutput([
        candidate("user_preference", "low signal", 1),
        candidate("risk_event", "high signal", 10),
        candidate("execution_failure", "mid signal", 5),
      ]),
    );
    const lessons = loadACELessons().lessons;
    expect(lessons.length).toBe(2);
    const texts = new Set(lessons.map((l) => l.text));
    expect(texts.has("high signal")).toBe(true);
    expect(texts.has("mid signal")).toBe(true);
    expect(texts.has("low signal")).toBe(false);
  });
});
