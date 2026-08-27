import { describe, it, expect } from "bun:test";
import {
  assessSkillStaleness,
  skillStatus,
  summarizeSkillStatuses,
  skillsNeedingReview,
} from "./governance.ts";
import type { Skill, SkillStatus } from "./types.ts";

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

describe("skillStatus", () => {
  it("returns the explicit status when set", () => {
    expect(skillStatus(makeSkill("a", { status: "active" }))).toBe("active");
    expect(skillStatus(makeSkill("b", { status: "deprecated" }))).toBe("deprecated");
  });

  it("defaults to experimental when unset", () => {
    expect(skillStatus(makeSkill("c"))).toBe("experimental");
  });
});

describe("assessSkillStaleness — never_reviewed path", () => {
  it("returns never_reviewed when lastReviewed is absent", () => {
    const result = assessSkillStaleness(makeSkill("a"));
    expect(result.verdict).toBe("never_reviewed");
    expect(result.daysSinceReview).toBeNull();
    expect(result.lastReviewed).toBeNull();
  });

  it("returns never_reviewed when lastReviewed is not a valid date", () => {
    const result = assessSkillStaleness(makeSkill("a", { lastReviewed: "not-a-date" }));
    expect(result.verdict).toBe("never_reviewed");
    expect(result.daysSinceReview).toBeNull();
  });
});

describe("assessSkillStaleness — verdict bands", () => {
  const now = new Date("2026-05-23T00:00:00Z");

  it("fresh when reviewed within 30 days", () => {
    const skill = makeSkill("a", { lastReviewed: "2026-05-10T00:00:00Z" });
    const result = assessSkillStaleness(skill, { now });
    expect(result.verdict).toBe("fresh");
    expect(result.daysSinceReview).toBe(13);
  });

  it("recent when reviewed within 90 days but more than 30", () => {
    const skill = makeSkill("a", { lastReviewed: "2026-03-15T00:00:00Z" });
    const result = assessSkillStaleness(skill, { now });
    expect(result.verdict).toBe("recent");
    expect(result.daysSinceReview).toBeGreaterThan(30);
    expect(result.daysSinceReview).toBeLessThanOrEqual(90);
  });

  it("stale when reviewed more than 90 days ago", () => {
    const skill = makeSkill("a", { lastReviewed: "2025-01-01T00:00:00Z" });
    const result = assessSkillStaleness(skill, { now });
    expect(result.verdict).toBe("stale");
    expect(result.daysSinceReview).toBeGreaterThan(90);
  });

  it("respects custom thresholds", () => {
    const skill = makeSkill("a", { lastReviewed: "2026-05-01T00:00:00Z" });
    const result = assessSkillStaleness(skill, {
      now,
      freshDays: 5,
      recentDays: 10,
    });
    // 22 days since review > 10 → stale
    expect(result.verdict).toBe("stale");
  });
});

describe("summarizeSkillStatuses", () => {
  it("counts by status, unspecified separately", () => {
    const skills = [
      makeSkill("a", { status: "active" }),
      makeSkill("b", { status: "active" }),
      makeSkill("c", { status: "experimental" }),
      makeSkill("d", { status: "deprecated" }),
      makeSkill("e"), // unspecified
    ];
    const breakdown = summarizeSkillStatuses(skills);
    expect(breakdown.active).toBe(2);
    expect(breakdown.experimental).toBe(1);
    expect(breakdown.deprecated).toBe(1);
    expect(breakdown.unspecified).toBe(1);
    expect(breakdown.total).toBe(5);
  });

  it("handles empty input", () => {
    const breakdown = summarizeSkillStatuses([]);
    expect(breakdown.total).toBe(0);
    expect(
      breakdown.active + breakdown.experimental + breakdown.deprecated + breakdown.unspecified,
    ).toBe(0);
  });
});

describe("skillsNeedingReview", () => {
  const now = new Date("2026-05-23T00:00:00Z");

  it("returns stale + never-reviewed skills only", () => {
    const skills = [
      makeSkill("fresh-a", { lastReviewed: "2026-05-10T00:00:00Z" }),
      makeSkill("recent-b", { lastReviewed: "2026-03-15T00:00:00Z" }),
      makeSkill("stale-c", { lastReviewed: "2025-01-01T00:00:00Z" }),
      makeSkill("never-d"),
    ];
    const review = skillsNeedingReview(skills, { now });
    const ids = review.map((r) => r.skillId);
    expect(ids).toContain("stale-c");
    expect(ids).toContain("never-d");
    expect(ids).not.toContain("fresh-a");
    expect(ids).not.toContain("recent-b");
    expect(review.length).toBe(2);
  });

  it("sorts stale by days descending, never-reviewed last", () => {
    const skills = [
      makeSkill("older-stale", { lastReviewed: "2024-01-01T00:00:00Z" }),
      makeSkill("newer-stale", { lastReviewed: "2025-01-01T00:00:00Z" }),
      makeSkill("never"),
    ];
    const review = skillsNeedingReview(skills, { now });
    expect(review[0]!.skillId).toBe("older-stale");
    expect(review[1]!.skillId).toBe("newer-stale");
    expect(review[2]!.skillId).toBe("never");
  });
});
