import { beforeEach, describe, expect, test } from "bun:test";
import { appendFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  DEFAULT_FRICTION_THRESHOLD,
  TURN_IDLE_RESET_MS,
  __resetAllToolFrictionStateForTests,
  appendToolFrictionEvent,
  defaultToolFrictionPath,
  readToolFrictionEvents,
  recordToolCallForFriction,
  recordUserTurnStart,
  resetToolFrictionForThread,
} from "./toolFrictionTracker.ts";
import type { GordonContext } from "../types.ts";

function makeContext(threadId = "test-thread"): GordonContext {
  // Only threadId is read by the tracker; the rest is irrelevant.
  return { threadId } as unknown as GordonContext;
}

let counter = 0;
function tempJsonlPath(): string {
  counter += 1;
  return join(tmpdir(), `gordon-tool-friction-${process.pid}-${counter}-${Date.now()}.jsonl`);
}

function safeUnlink(path: string): void {
  try {
    if (existsSync(path)) rmSync(path, { force: true });
  } catch {
    // ignore
  }
}

beforeEach(() => {
  __resetAllToolFrictionStateForTests();
});

describe("toolFrictionTracker — threshold + dedup", () => {
  test("does not fire below the default threshold", () => {
    const ctx = makeContext();
    for (let i = 0; i < DEFAULT_FRICTION_THRESHOLD - 1; i++) {
      const r = recordToolCallForFriction(ctx, `tool_${i}`, { suppressFire: true });
      expect(r.frictionTriggered).toBe(false);
    }
  });

  test("fires exactly on the threshold call, dedupes afterwards", () => {
    const ctx = makeContext();
    let firedCount = 0;
    for (let i = 0; i < DEFAULT_FRICTION_THRESHOLD + 3; i++) {
      const r = recordToolCallForFriction(ctx, `tool_${i}`, { suppressFire: true });
      if (r.frictionTriggered) firedCount += 1;
    }
    expect(firedCount).toBe(1);
  });

  test("explicit thresholdOverride respected", () => {
    const ctx = makeContext();
    const r1 = recordToolCallForFriction(ctx, "a", { thresholdOverride: 2, suppressFire: true });
    expect(r1.frictionTriggered).toBe(false);
    expect(r1.threshold).toBe(2);
    const r2 = recordToolCallForFriction(ctx, "b", { thresholdOverride: 2, suppressFire: true });
    expect(r2.frictionTriggered).toBe(true);
  });

  test("records the tool name sequence in order", () => {
    const ctx = makeContext();
    const seq = ["alpha", "beta", "gamma", "delta", "epsilon"];
    let last;
    for (const t of seq) last = recordToolCallForFriction(ctx, t, { suppressFire: true });
    expect(last!.toolNames).toEqual(seq);
  });
});

describe("toolFrictionTracker — turn boundaries", () => {
  test("recordUserTurnStart resets the counter", () => {
    const ctx = makeContext();
    for (let i = 0; i < 3; i++) recordToolCallForFriction(ctx, "x", { suppressFire: true });
    recordUserTurnStart(ctx, "new question");
    const r = recordToolCallForFriction(ctx, "y", { suppressFire: true });
    expect(r.count).toBe(1);
    expect(r.userMessage).toBe("new question");
  });

  test("recordUserTurnStart re-arms the friction flag for the new turn", () => {
    const ctx = makeContext();
    let firedFirstTurn = 0;
    let firedSecondTurn = 0;
    for (let i = 0; i < DEFAULT_FRICTION_THRESHOLD + 2; i++) {
      if (recordToolCallForFriction(ctx, `t${i}`, { suppressFire: true }).frictionTriggered) firedFirstTurn += 1;
    }
    expect(firedFirstTurn).toBe(1);

    recordUserTurnStart(ctx);
    for (let i = 0; i < DEFAULT_FRICTION_THRESHOLD + 2; i++) {
      if (recordToolCallForFriction(ctx, `u${i}`, { suppressFire: true }).frictionTriggered) firedSecondTurn += 1;
    }
    expect(firedSecondTurn).toBe(1);
  });

  test("each thread has independent state", () => {
    const a = makeContext("thread-a");
    const b = makeContext("thread-b");
    for (let i = 0; i < DEFAULT_FRICTION_THRESHOLD - 1; i++) {
      recordToolCallForFriction(a, "x", { suppressFire: true });
    }
    const rA = recordToolCallForFriction(a, "x", { suppressFire: true });
    expect(rA.frictionTriggered).toBe(true);
    const rB = recordToolCallForFriction(b, "y", { suppressFire: true });
    expect(rB.frictionTriggered).toBe(false);
    expect(rB.count).toBe(1);
  });

  test("idle reset boundary constant is 30 seconds", () => {
    // Sanity check on the documented heuristic constant.
    expect(TURN_IDLE_RESET_MS).toBe(30_000);
  });

  test("resetToolFrictionForThread clears state for that thread only", () => {
    const a = makeContext("thread-a");
    const b = makeContext("thread-b");
    recordToolCallForFriction(a, "x", { suppressFire: true });
    recordToolCallForFriction(b, "y", { suppressFire: true });
    resetToolFrictionForThread(a);
    const rA = recordToolCallForFriction(a, "x2", { suppressFire: true });
    const rB = recordToolCallForFriction(b, "y2", { suppressFire: true });
    expect(rA.count).toBe(1);
    expect(rB.count).toBe(2);
  });
});

describe("toolFrictionTracker — persistence", () => {
  test("appendToolFrictionEvent writes a JSONL line that round-trips", () => {
    const path = tempJsonlPath();
    try {
      const entry = {
        observedAt: new Date().toISOString(),
        threadId: "t1",
        userMessage: "find me a swing trade",
        toolNames: ["a", "b", "c", "d", "e"],
        count: 5,
        threshold: 5,
        turnDurationMs: 1234,
      };
      const result = appendToolFrictionEvent(entry, path);
      expect(result.written).toBe(true);
      const round = readToolFrictionEvents(path);
      expect(round.length).toBe(1);
      expect(round[0]).toEqual(entry);
    } finally {
      safeUnlink(path);
    }
  });

  test("readToolFrictionEvents returns [] when the file is missing", () => {
    const path = tempJsonlPath();
    safeUnlink(path);
    expect(readToolFrictionEvents(path)).toEqual([]);
  });

  test("readToolFrictionEvents skips malformed lines", () => {
    const path = tempJsonlPath();
    try {
      appendToolFrictionEvent(
        {
          observedAt: new Date().toISOString(),
          threadId: "t1",
          toolNames: ["a"],
          count: 1,
          threshold: 1,
          turnDurationMs: 1,
        },
        path,
      );
      appendFileSync(path, "not json\n", { encoding: "utf-8" });
      const events = readToolFrictionEvents(path);
      expect(events.length).toBe(1);
    } finally {
      safeUnlink(path);
    }
  });

  test("env var override flows through to defaultToolFrictionPath", () => {
    const original = process.env.GORDON_TOOL_FRICTION_PATH;
    const overridden = join(tmpdir(), `gordon-friction-env-${process.pid}.jsonl`);
    process.env.GORDON_TOOL_FRICTION_PATH = overridden;
    try {
      expect(defaultToolFrictionPath()).toBe(overridden);
    } finally {
      if (original === undefined) delete process.env.GORDON_TOOL_FRICTION_PATH;
      else process.env.GORDON_TOOL_FRICTION_PATH = original;
    }
  });

  test("recordToolCallForFriction (no suppressFire) appends to the jsonl on fire", () => {
    const path = tempJsonlPath();
    const original = process.env.GORDON_TOOL_FRICTION_PATH;
    process.env.GORDON_TOOL_FRICTION_PATH = path;
    try {
      const ctx = makeContext("persistence-thread");
      recordUserTurnStart(ctx, "user question goes here");
      for (let i = 0; i < DEFAULT_FRICTION_THRESHOLD - 1; i++) {
        recordToolCallForFriction(ctx, `t${i}`);
      }
      const fired = recordToolCallForFriction(ctx, "final");
      expect(fired.frictionTriggered).toBe(true);
      const events = readToolFrictionEvents(path);
      expect(events.length).toBe(1);
      expect(events[0]!.userMessage).toBe("user question goes here");
      expect(events[0]!.toolNames.length).toBe(DEFAULT_FRICTION_THRESHOLD);
    } finally {
      if (original === undefined) delete process.env.GORDON_TOOL_FRICTION_PATH;
      else process.env.GORDON_TOOL_FRICTION_PATH = original;
      safeUnlink(path);
    }
  });
});
