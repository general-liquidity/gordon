import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  recordSkillUsage,
  readSkillUsage,
  getSkillUsageStats,
  neverInvokedSkills,
} from "./usage-tracker.ts";

let tempDir: string;
let usagePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-skill-usage-test-"));
  usagePath = join(tempDir, "skill-usage.jsonl");
  delete process.env.GORDON_SKILL_USAGE_DISABLED;
});

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* */
  }
});

describe("recordSkillUsage", () => {
  it("appends a JSONL row", () => {
    recordSkillUsage("test-skill", "user", undefined, usagePath);
    const records = readSkillUsage(usagePath);
    expect(records.length).toBe(1);
    expect(records[0]!.skillId).toBe("test-skill");
    expect(records[0]!.source).toBe("user");
  });

  it("appends multiple invocations", () => {
    recordSkillUsage("skill-a", "user", undefined, usagePath);
    recordSkillUsage("skill-b", "agent", undefined, usagePath);
    recordSkillUsage("skill-a", "agent", undefined, usagePath);
    const records = readSkillUsage(usagePath);
    expect(records.length).toBe(3);
  });

  it("includes optional context tag", () => {
    recordSkillUsage("skill-a", "user", "post-fed-meeting", usagePath);
    const records = readSkillUsage(usagePath);
    expect(records[0]!.context).toBe("post-fed-meeting");
  });

  it("omits context when not provided (no undefined field)", () => {
    recordSkillUsage("skill-a", "user", undefined, usagePath);
    const records = readSkillUsage(usagePath);
    expect("context" in records[0]!).toBe(false);
  });

  it("disabled via env var produces no records", () => {
    process.env.GORDON_SKILL_USAGE_DISABLED = "1";
    recordSkillUsage("skill-a", "user", undefined, usagePath);
    const records = readSkillUsage(usagePath);
    expect(records.length).toBe(0);
  });

  it("silently handles I/O failure (invalid path)", () => {
    expect(() =>
      recordSkillUsage("skill-a", "user", undefined, "/proc/cannot/write/here/x.jsonl"),
    ).not.toThrow();
  });
});

describe("readSkillUsage", () => {
  it("returns empty when file doesn't exist", () => {
    const records = readSkillUsage(join(tempDir, "does-not-exist.jsonl"));
    expect(records).toEqual([]);
  });

  it("skips malformed JSONL lines", () => {
    writeFileSync(
      usagePath,
      JSON.stringify({ timestamp: "2026-05-23T00:00:00Z", skillId: "a", source: "user" }) +
        "\nnot json\n" +
        JSON.stringify({ timestamp: "2026-05-23T01:00:00Z", skillId: "b", source: "user" }) +
        "\n",
    );
    const records = readSkillUsage(usagePath);
    expect(records.length).toBe(2);
  });

  it("skips entries missing required fields", () => {
    writeFileSync(
      usagePath,
      JSON.stringify({ skillId: "a" }) + // missing timestamp
        "\n" +
        JSON.stringify({ timestamp: "2026-05-23T00:00:00Z" }) + // missing skillId
        "\n" +
        JSON.stringify({ timestamp: "2026-05-23T00:00:00Z", skillId: "good", source: "user" }) +
        "\n",
    );
    const records = readSkillUsage(usagePath);
    expect(records.length).toBe(1);
    expect(records[0]!.skillId).toBe("good");
  });
});

describe("getSkillUsageStats", () => {
  const now = new Date("2026-05-23T00:00:00Z");

  function seed(records: Array<{ days_ago: number; skillId: string; source?: "user" | "agent" }>) {
    const lines = records.map((r) => {
      const ts = new Date(now.getTime() - r.days_ago * 24 * 60 * 60 * 1000).toISOString();
      return JSON.stringify({ timestamp: ts, skillId: r.skillId, source: r.source ?? "user" });
    });
    writeFileSync(usagePath, `${lines.join("\n")}\n`);
  }

  it("returns empty when no records", () => {
    const stats = getSkillUsageStats({ path: usagePath, now });
    expect(stats).toEqual([]);
  });

  it("aggregates total + recent invocations correctly", () => {
    seed([
      { days_ago: 1, skillId: "skill-a" },
      { days_ago: 5, skillId: "skill-a" },
      { days_ago: 60, skillId: "skill-a" }, // outside 30-day window
      { days_ago: 2, skillId: "skill-b" },
    ]);
    const stats = getSkillUsageStats({ path: usagePath, now });
    const a = stats.find((s) => s.skillId === "skill-a")!;
    const b = stats.find((s) => s.skillId === "skill-b")!;
    expect(a.totalInvocations).toBe(3);
    expect(a.recentInvocations).toBe(2);
    expect(b.totalInvocations).toBe(1);
    expect(b.recentInvocations).toBe(1);
  });

  it("sorts by recent invocations descending", () => {
    seed([
      { days_ago: 1, skillId: "skill-low" },
      { days_ago: 1, skillId: "skill-high" },
      { days_ago: 2, skillId: "skill-high" },
      { days_ago: 3, skillId: "skill-high" },
    ]);
    const stats = getSkillUsageStats({ path: usagePath, now });
    expect(stats[0]!.skillId).toBe("skill-high");
  });

  it("tracks source breakdown", () => {
    seed([
      { days_ago: 1, skillId: "a", source: "user" },
      { days_ago: 1, skillId: "a", source: "agent" },
      { days_ago: 1, skillId: "a", source: "user" },
    ]);
    const stats = getSkillUsageStats({ path: usagePath, now });
    expect(stats[0]!.bySource.user).toBe(2);
    expect(stats[0]!.bySource.agent).toBe(1);
  });

  it("tracks lastInvoked as most recent timestamp", () => {
    seed([
      { days_ago: 5, skillId: "a" },
      { days_ago: 1, skillId: "a" },
      { days_ago: 3, skillId: "a" },
    ]);
    const stats = getSkillUsageStats({ path: usagePath, now });
    const expectedLast = new Date(now.getTime() - 1 * 24 * 60 * 60 * 1000).toISOString();
    expect(stats[0]!.lastInvoked).toBe(expectedLast);
  });

  it("respects custom window size", () => {
    const ts = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
    writeFileSync(
      usagePath,
      `${[
        { timestamp: ts(1), skillId: "a", source: "user" },
        { timestamp: ts(5), skillId: "a", source: "user" },
        { timestamp: ts(15), skillId: "a", source: "user" },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n")}\n`,
    );
    const sevenDayWindow = getSkillUsageStats({ path: usagePath, now, windowDays: 7 });
    expect(sevenDayWindow[0]!.recentInvocations).toBe(2); // days 1 + 5 within 7-day window
  });
});

describe("neverInvokedSkills", () => {
  it("returns skills from registry that have zero invocations", () => {
    writeFileSync(
      usagePath,
      JSON.stringify({ timestamp: "2026-05-23T00:00:00Z", skillId: "used-a", source: "user" }) +
        "\n",
    );
    const result = neverInvokedSkills(["used-a", "unused-b", "unused-c"], { path: usagePath });
    expect(result).toEqual(["unused-b", "unused-c"]);
  });

  it("returns all skill IDs when usage ledger is empty", () => {
    const result = neverInvokedSkills(["a", "b"], { path: usagePath });
    expect(result).toEqual(["a", "b"]);
  });

  it("excludes orphan entries (ledger has skill not in registry)", () => {
    writeFileSync(
      usagePath,
      `${JSON.stringify({
        timestamp: "2026-05-23T00:00:00Z",
        skillId: "deleted-skill",
        source: "user",
      })}\n`,
    );
    // 'deleted-skill' is in ledger but not in registry — not surfaced
    const result = neverInvokedSkills(["a", "b"], { path: usagePath });
    expect(result).toEqual(["a", "b"]);
  });
});
