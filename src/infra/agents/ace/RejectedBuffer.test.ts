import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getRejectedBufferPath,
  loadRejectedBuffer,
  recordRepropose,
  rejectLesson,
  rejectedIds,
  unrejectLesson,
} from "./RejectedBuffer.ts";

const TMP_PATH = join(
  tmpdir(),
  `gordon-ace-rejected-test-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.json`,
);

beforeEach(() => {
  process.env.GORDON_ACE_REJECTED_PATH = TMP_PATH;
  if (existsSync(TMP_PATH)) rmSync(TMP_PATH);
});

afterEach(() => {
  if (existsSync(TMP_PATH)) rmSync(TMP_PATH);
  delete process.env.GORDON_ACE_REJECTED_PATH;
});

describe("ACE RejectedBuffer", () => {
  test("loadRejectedBuffer returns empty store when file missing", () => {
    const store = loadRejectedBuffer();
    expect(store.version).toBe(1);
    expect(store.rejected).toEqual([]);
  });

  test("rejectLesson adds a new entry", () => {
    rejectLesson({ id: "risk_event::stop-too-tight", reason: "operator", note: "false positive" });
    const store = loadRejectedBuffer();
    expect(store.rejected.length).toBe(1);
    expect(store.rejected[0]!.id).toBe("risk_event::stop-too-tight");
    expect(store.rejected[0]!.reason).toBe("operator");
    expect(store.rejected[0]!.reproposeCount).toBe(0);
  });

  test("rejectedIds returns the set quickly", () => {
    rejectLesson({ id: "execution_failure::wrong-venue", reason: "auto" });
    rejectLesson({ id: "venue_quirk::binance-min-size", reason: "operator" });
    const ids = rejectedIds();
    expect(ids.has("execution_failure::wrong-venue")).toBe(true);
    expect(ids.has("venue_quirk::binance-min-size")).toBe(true);
    expect(ids.has("never-rejected")).toBe(false);
  });

  test("repeated rejectLesson is idempotent on id and resets repropose count", () => {
    rejectLesson({ id: "risk_event::foo", reason: "auto" });
    recordRepropose(["risk_event::foo"]);
    let store = loadRejectedBuffer();
    expect(store.rejected[0]!.reproposeCount).toBe(1);
    // Re-reject with a different reason — should reset the counter.
    rejectLesson({ id: "risk_event::foo", reason: "operator", note: "manual" });
    store = loadRejectedBuffer();
    expect(store.rejected.length).toBe(1);
    expect(store.rejected[0]!.reason).toBe("operator");
    expect(store.rejected[0]!.note).toBe("manual");
    expect(store.rejected[0]!.reproposeCount).toBe(0);
  });

  test("unrejectLesson removes an entry", () => {
    rejectLesson({ id: "user_preference::no-friday-trades", reason: "operator" });
    expect(rejectedIds().size).toBe(1);
    unrejectLesson("user_preference::no-friday-trades");
    expect(rejectedIds().size).toBe(0);
  });

  test("recordRepropose increments only matching ids", () => {
    rejectLesson({ id: "a", reason: "auto" });
    rejectLesson({ id: "b", reason: "auto" });
    recordRepropose(["a", "a", "c-not-rejected"]);
    const store = loadRejectedBuffer();
    const a = store.rejected.find((r) => r.id === "a")!;
    const b = store.rejected.find((r) => r.id === "b")!;
    expect(a.reproposeCount).toBe(1);
    expect(b.reproposeCount).toBe(0);
  });

  test("getRejectedBufferPath honors the env override", () => {
    expect(getRejectedBufferPath()).toBe(TMP_PATH);
  });
});
