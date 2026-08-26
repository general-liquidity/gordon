import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { closeDatabase, setDatabasePathForTesting } from "../storage/database.ts";
import { appendActionLogEntry, getActionLogEntry } from "./store.ts";
import {
  resetActiveACELessonRevision,
  setActiveACELessonRevision,
} from "../agents/ace/activeRevision.ts";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "action-log-ace-"));
  setDatabasePathForTesting(join(dir, "gordon.db"));
  resetActiveACELessonRevision();
});

afterEach(() => {
  closeDatabase();
  setDatabasePathForTesting(null);
  resetActiveACELessonRevision();
  rmSync(dir, { recursive: true, force: true });
});

describe("action-log → ACE revision attribution stamp", () => {
  it("stamps the active revision into a logged entry's payload (and it survives reload)", () => {
    setActiveACELessonRevision(5);
    const entry = appendActionLogEntry({
      entryType: "tool_call",
      title: "scan_market",
      payload: { venue: "binance" },
    });
    expect(entry.payload.aceLessonRevision).toBe(5);

    const reloaded = getActionLogEntry(entry.id);
    expect(reloaded?.payload.aceLessonRevision).toBe(5);
    expect(reloaded?.payload.venue).toBe("binance");
  });

  it("does NOT stamp when ACE is inactive (revision 0)", () => {
    const entry = appendActionLogEntry({
      entryType: "tool_call",
      title: "scan_market",
      payload: { venue: "binance" },
    });
    expect(entry.payload).not.toHaveProperty("aceLessonRevision");
  });

  it("attributes an entry to its own session rather than another active session", () => {
    setActiveACELessonRevision(4, "session-a");
    setActiveACELessonRevision(9, "session-b");
    const a = appendActionLogEntry({
      sessionId: "session-a",
      entryType: "tool_call",
      title: "a",
    });
    const b = appendActionLogEntry({
      sessionId: "session-b",
      entryType: "tool_call",
      title: "b",
    });
    expect(a.payload.aceLessonRevision).toBe(4);
    expect(b.payload.aceLessonRevision).toBe(9);
  });
});
