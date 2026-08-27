import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runSkillAudit, formatAuditReport } from "./audit.ts";
import type { Skill, SkillStatus } from "./types.ts";

let tempDir: string;
let usagePath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-skill-audit-test-"));
  usagePath = join(tempDir, "skill-usage.jsonl");
});

afterEach(() => {
  try {
    rmSync(tempDir, { recursive: true, force: true });
  } catch {
    /* */
  }
});

function makeSkill(
  id: string,
  overrides: { status?: SkillStatus; lastReviewed?: string } = {},
): Skill {
  return {
    id,
    name: id,
    description: `${id} description`,
    body: "body",
    frontmatter: {
      name: id,
      description: `${id} description`,
      status: overrides.status,
      lastReviewed: overrides.lastReviewed,
    },
    source: "builtin",
    filePath: `/skills/${id}/SKILL.md`,
  };
}

describe("runSkillAudit — verdict bands", () => {
  const now = new Date("2026-05-23T00:00:00Z");

  it("clean when most skills are recent + actively used", () => {
    const skills = [
      makeSkill("a", { status: "active", lastReviewed: "2026-05-10T00:00:00Z" }),
      makeSkill("b", { status: "active", lastReviewed: "2026-05-15T00:00:00Z" }),
      makeSkill("c", { status: "active", lastReviewed: "2026-05-12T00:00:00Z" }),
    ];
    writeFileSync(
      usagePath,
      `${[
        { timestamp: "2026-05-22T00:00:00Z", skillId: "a", source: "user" },
        { timestamp: "2026-05-21T00:00:00Z", skillId: "b", source: "user" },
        { timestamp: "2026-05-20T00:00:00Z", skillId: "c", source: "user" },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n")}\n`,
    );
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.verdict).toBe("clean");
  });

  it("needs_attention when stale ratio exceeds threshold (but usage saves it from degraded)", () => {
    const skills = [
      makeSkill("stale1", { status: "active", lastReviewed: "2024-01-01T00:00:00Z" }),
      makeSkill("stale2", { status: "active", lastReviewed: "2024-02-01T00:00:00Z" }),
      makeSkill("ok", { status: "active", lastReviewed: "2026-05-15T00:00:00Z" }),
    ];
    // Record usage for 2 of 3 skills so the unused-ratio stays below 0.5,
    // keeping the verdict at needs_attention rather than escalating to
    // degraded (which requires high stale ratio AND high unused ratio).
    writeFileSync(
      usagePath,
      `${[
        { timestamp: "2026-05-22T00:00:00Z", skillId: "stale1", source: "user" },
        { timestamp: "2026-05-22T00:00:00Z", skillId: "ok", source: "user" },
      ]
        .map((r) => JSON.stringify(r))
        .join("\n")}\n`,
    );
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.verdict).toBe("needs_attention");
  });

  it("needs_attention when majority is unspecified status", () => {
    const skills = [
      makeSkill("a"),
      makeSkill("b"),
      makeSkill("c"),
      makeSkill("d", { status: "active", lastReviewed: "2026-05-15T00:00:00Z" }),
    ];
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.verdict).toBe("needs_attention");
  });

  it("degraded when both stale ratio + unused ratio are high", () => {
    const skills = [
      makeSkill("s1", { status: "active", lastReviewed: "2024-01-01T00:00:00Z" }),
      makeSkill("s2", { status: "active", lastReviewed: "2024-02-01T00:00:00Z" }),
      makeSkill("s3", { status: "active", lastReviewed: "2024-03-01T00:00:00Z" }),
      makeSkill("s4", { status: "active", lastReviewed: "2024-04-01T00:00:00Z" }),
    ];
    // No usage records → all unused
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.verdict).toBe("degraded");
  });
});

describe("runSkillAudit — fields", () => {
  const now = new Date("2026-05-23T00:00:00Z");

  it("populates statusBreakdown", () => {
    const skills = [
      makeSkill("a", { status: "active" }),
      makeSkill("b", { status: "experimental" }),
      makeSkill("c", { status: "deprecated" }),
    ];
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.statusBreakdown.active).toBe(1);
    expect(report.statusBreakdown.experimental).toBe(1);
    expect(report.statusBreakdown.deprecated).toBe(1);
    expect(report.totalSkills).toBe(3);
  });

  it("populates staleness buckets", () => {
    const skills = [
      makeSkill("fresh-a", { lastReviewed: "2026-05-10T00:00:00Z" }),
      makeSkill("recent-b", { lastReviewed: "2026-03-15T00:00:00Z" }),
      makeSkill("stale-c", { lastReviewed: "2025-01-01T00:00:00Z" }),
      makeSkill("never-d"),
    ];
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.staleness.fresh).toBe(1);
    expect(report.staleness.recent).toBe(1);
    expect(report.staleness.stale).toBe(1);
    expect(report.staleness.neverReviewed).toBe(1);
  });

  it("populates needsReview list sorted by daysSinceReview", () => {
    const skills = [
      makeSkill("a", { lastReviewed: "2026-05-15T00:00:00Z" }), // fresh
      makeSkill("b", { lastReviewed: "2024-01-01T00:00:00Z" }), // very stale
      makeSkill("c"), // never
    ];
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.needsReview.length).toBe(2);
    expect(report.needsReview[0]!.skillId).toBe("b"); // stale before never
  });

  it("populates neverInvoked list", () => {
    const skills = [makeSkill("a"), makeSkill("b"), makeSkill("c")];
    writeFileSync(
      usagePath,
      `${JSON.stringify({ timestamp: "2026-05-22T00:00:00Z", skillId: "a", source: "user" })}\n`,
    );
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.neverInvoked).toEqual(["b", "c"]);
  });

  it("empty registry returns clean verdict", () => {
    const report = runSkillAudit([], { now, path: usagePath });
    expect(report.totalSkills).toBe(0);
    expect(report.verdict).toBe("clean");
  });
});

describe("runSkillAudit — summary text", () => {
  const now = new Date("2026-05-23T00:00:00Z");

  it("includes total + status breakdown + verdict", () => {
    const skills = [makeSkill("a", { status: "active", lastReviewed: "2026-05-15T00:00:00Z" })];
    const report = runSkillAudit(skills, { now, path: usagePath });
    expect(report.summary).toContain("1 skills");
    expect(report.summary).toContain("active");
    expect(report.summary).toContain(report.verdict);
  });
});

describe("formatAuditReport", () => {
  const now = new Date("2026-05-23T00:00:00Z");

  it("renders headers + sections", () => {
    const skills = [
      makeSkill("a", { status: "active", lastReviewed: "2026-05-10T00:00:00Z" }),
      makeSkill("stale-b", { status: "active", lastReviewed: "2024-01-01T00:00:00Z" }),
      makeSkill("never-c"),
    ];
    const report = runSkillAudit(skills, { now, path: usagePath });
    const text = formatAuditReport(report);
    expect(text).toContain("Gordon Skill Audit");
    expect(text).toContain("Status Breakdown");
    expect(text).toContain("Staleness");
    expect(text).toContain("candidates for review");
  });

  it("includes usage section when usage exists", () => {
    const skills = [makeSkill("a")];
    writeFileSync(
      usagePath,
      `${JSON.stringify({ timestamp: "2026-05-22T00:00:00Z", skillId: "a", source: "user" })}\n`,
    );
    const report = runSkillAudit(skills, { now, path: usagePath });
    const text = formatAuditReport(report);
    expect(text).toContain("Most-used");
  });

  it("includes never-invoked section + truncation note when > 5", () => {
    const skills = Array.from({ length: 7 }, (_, i) => makeSkill(`unused-${i}`));
    const report = runSkillAudit(skills, { now, path: usagePath });
    const text = formatAuditReport(report);
    expect(text).toContain("Never invoked");
    expect(text).toContain("and 2 more"); // 7 - 5 = 2 truncated
  });
});
