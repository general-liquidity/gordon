import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  getSkillHistoryRoot,
  listSkillHistory,
  listSkillsWithHistory,
  loadSkillSnapshot,
  recordSkillSnapshot,
} from "./history.ts";

let TMP_ROOT: string;

beforeEach(() => {
  TMP_ROOT = mkdtempSync(join(tmpdir(), "gordon-skill-history-"));
  process.env.GORDON_SKILL_HISTORY_PATH = TMP_ROOT;
});

afterEach(() => {
  if (existsSync(TMP_ROOT)) rmSync(TMP_ROOT, { recursive: true, force: true });
  delete process.env.GORDON_SKILL_HISTORY_PATH;
});

describe("skill history", () => {
  test("getSkillHistoryRoot honors env override", () => {
    expect(getSkillHistoryRoot()).toBe(TMP_ROOT);
  });

  test("listSkillHistory returns empty index for unknown skill", () => {
    const idx = listSkillHistory("brand-new");
    expect(idx.version).toBe(1);
    expect(idx.snapshots).toEqual([]);
  });

  test("recordSkillSnapshot creates an index + snapshot file", () => {
    const snap = recordSkillSnapshot({
      skillId: "dd",
      content: "# DD\n\nFirst version.",
      reason: "manual edit",
    });
    expect(snap.skillId).toBe("dd");
    expect(snap.contentHash).toMatch(/^[0-9a-f]{12}$/);
    const idx = listSkillHistory("dd");
    expect(idx.snapshots.length).toBe(1);
    expect(idx.snapshots[0]!.reason).toBe("manual edit");
    const loaded = loadSkillSnapshot("dd", snap.filename);
    expect(loaded).toBe("# DD\n\nFirst version.");
  });

  test("repeated snapshot with identical content is a no-op", () => {
    const content = "# Same\n\nidempotent.";
    const first = recordSkillSnapshot({ skillId: "x", content, reason: "first" });
    const second = recordSkillSnapshot({ skillId: "x", content, reason: "should-be-noop" });
    expect(first.contentHash).toBe(second.contentHash);
    const idx = listSkillHistory("x");
    expect(idx.snapshots.length).toBe(1);
    // Reason from the FIRST write wins — the second was suppressed.
    expect(idx.snapshots[0]!.reason).toBe("first");
  });

  test("different content produces distinct snapshots", () => {
    recordSkillSnapshot({ skillId: "y", content: "v1", reason: "init" });
    recordSkillSnapshot({ skillId: "y", content: "v2", reason: "edit" });
    const idx = listSkillHistory("y");
    expect(idx.snapshots.length).toBe(2);
    expect(idx.snapshots[0]!.contentHash).not.toBe(idx.snapshots[1]!.contentHash);
  });

  test("listSkillsWithHistory enumerates dirs", () => {
    recordSkillSnapshot({ skillId: "a", content: "1", reason: "" });
    recordSkillSnapshot({ skillId: "b", content: "2", reason: "" });
    const skills = listSkillsWithHistory().sort();
    expect(skills).toEqual(["a", "b"]);
  });

  test("loadSkillSnapshot returns null for missing file", () => {
    expect(loadSkillSnapshot("unknown", "nope.md")).toBeNull();
  });

  test("bytes + lines metadata are populated", () => {
    const content = "line1\nline2\nline3\n";
    const snap = recordSkillSnapshot({ skillId: "z", content, reason: "" });
    expect(snap.bytes).toBe(content.length);
    expect(snap.lines).toBe(4);
  });
});
