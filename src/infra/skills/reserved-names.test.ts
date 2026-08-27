import { describe, it, expect } from "bun:test";
import { validateSkillFrontmatter } from "./loader.ts";

describe("validateSkillFrontmatter — reserved name guard", () => {
  it("rejects skill named 'skills' (collides with /skills namespace)", () => {
    const issues = validateSkillFrontmatter(
      { name: "skills", description: "test description" },
      "skills",
    );
    const reservedError = issues.find(
      (i) => i.severity === "error" && i.field === "name" && i.message.includes("reserved"),
    );
    expect(reservedError).toBeDefined();
    expect(reservedError!.message).toContain("/skills");
  });

  it("allows skill names that don't collide with namespace commands", () => {
    const issues = validateSkillFrontmatter(
      { name: "ccxt", description: "test description" },
      "ccxt",
    );
    const reservedError = issues.find((i) => i.message.includes("reserved"));
    expect(reservedError).toBeUndefined();
  });

  it("allows skill names that contain 'skills' as substring", () => {
    // "learn-skills" should not collide because exact-match only
    const issues = validateSkillFrontmatter(
      { name: "learn-skills", description: "test description" },
      "learn-skills",
    );
    const reservedError = issues.find((i) => i.message.includes("reserved"));
    expect(reservedError).toBeUndefined();
  });
});
