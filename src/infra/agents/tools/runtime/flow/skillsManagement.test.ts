import { describe, it, expect } from "bun:test";
import { skillsManagementTool, skillsTools } from "./skillsManagement.ts";

interface ToolResult {
  subcommand: string;
  text: string;
  data?: unknown;
  error?: string;
}

async function runSubcommand(
  subcommand: "audit" | "list" | "usage" | "review",
): Promise<ToolResult> {
  return (await skillsManagementTool.execute!({ subcommand }, {} as never)) as ToolResult;
}

describe("skillsManagementTool — shape", () => {
  it("registers under id 'skills_manage'", () => {
    expect(skillsManagementTool.id).toBe("skills_manage");
  });

  it("declares all four subcommands in description", () => {
    const desc = skillsManagementTool.description;
    expect(desc).toContain("audit");
    expect(desc).toContain("list");
    expect(desc).toContain("usage");
    expect(desc).toContain("review");
  });

  it("aggregation export contains skills_manage", () => {
    expect(skillsTools.skills_manage).toBe(skillsManagementTool);
  });
});

describe("skillsManagementTool — dispatch", () => {
  it("audit subcommand returns text + structured data", async () => {
    const result = await runSubcommand("audit");
    expect(result.subcommand).toBe("audit");
    expect(typeof result.text).toBe("string");
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.text).toContain("Gordon Skill Audit");
    expect(result.data).toBeDefined();
    const data = result.data as { verdict?: string; totalSkills?: number };
    expect(data.verdict).toBeDefined();
    expect(typeof data.totalSkills).toBe("number");
  });

  it("list subcommand returns text + skills array", async () => {
    const result = await runSubcommand("list");
    expect(result.subcommand).toBe("list");
    expect(typeof result.text).toBe("string");
    expect(result.data).toBeDefined();
    const data = result.data as { skills?: Array<{ id: string; status: string; source: string }> };
    expect(Array.isArray(data.skills)).toBe(true);
    if (data.skills!.length > 0) {
      expect(data.skills![0]).toHaveProperty("id");
      expect(data.skills![0]).toHaveProperty("status");
      expect(data.skills![0]).toHaveProperty("source");
    }
  });

  it("usage subcommand returns text + stats array", async () => {
    const result = await runSubcommand("usage");
    expect(result.subcommand).toBe("usage");
    expect(typeof result.text).toBe("string");
    expect(result.data).toBeDefined();
    const data = result.data as { stats?: Array<unknown> };
    expect(Array.isArray(data.stats)).toBe(true);
  });

  it("review subcommand returns text + needsReview array", async () => {
    const result = await runSubcommand("review");
    expect(result.subcommand).toBe("review");
    expect(typeof result.text).toBe("string");
    expect(result.data).toBeDefined();
    const data = result.data as { needsReview?: Array<unknown> };
    expect(Array.isArray(data.needsReview)).toBe(true);
  });
});

describe("skillsManagementTool — text rendering", () => {
  it("list subcommand renders aligned columns", async () => {
    const result = await runSubcommand("list");
    if (!result.text.startsWith("(no skills loaded)")) {
      expect(result.text).toContain("ID");
      expect(result.text).toContain("Status");
      expect(result.text).toContain("Source");
    }
  });

  it("usage subcommand returns a text payload regardless of ledger state", async () => {
    const prev = process.env.GORDON_SKILL_USAGE_DISABLED;
    process.env.GORDON_SKILL_USAGE_DISABLED = "1";
    try {
      const result = await runSubcommand("usage");
      // Either populated from prior runs OR empty — both shapes acceptable
      expect(typeof result.text).toBe("string");
    } finally {
      if (prev !== undefined) process.env.GORDON_SKILL_USAGE_DISABLED = prev;
      else delete process.env.GORDON_SKILL_USAGE_DISABLED;
    }
  });
});
