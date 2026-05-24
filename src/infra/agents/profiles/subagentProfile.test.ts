import { describe, expect, test } from "bun:test";
import {
  SubagentProfileSchema,
  summarizeSubagentProfile,
  validateSubagentProfile,
} from "./subagentProfile.ts";

const VALID = {
  name: "regulatory-risk-analyst",
  description: "Specialist for assessing regulatory/compliance risk",
  instructions: "You are a regulatory risk analyst...",
  tools: ["scan_market", "list_skills"],
};

describe("FW7 — SubagentProfileSchema", () => {
  test("accepts a minimal valid profile", () => {
    const result = validateSubagentProfile(VALID);
    expect(result.profile?.name).toBe("regulatory-risk-analyst");
    expect(result.issues).toEqual([]);
  });

  test("accepts all optional fields", () => {
    const result = validateSubagentProfile({
      ...VALID,
      model: "anthropic:claude-haiku-4-5",
      maxTurns: 15,
      tags: ["risk", "compliance"],
      status: "experimental",
      owner: "tibi",
    });
    expect(result.profile?.maxTurns).toBe(15);
    expect(result.profile?.status).toBe("experimental");
    expect(result.issues).toEqual([]);
  });

  test("rejects kebab-case violations in name", () => {
    const result = validateSubagentProfile({ ...VALID, name: "Bad_Name" });
    expect(result.profile).toBeUndefined();
    expect(result.issues.some((i) => i.field === "name")).toBe(true);
  });

  test("rejects empty instructions", () => {
    const result = validateSubagentProfile({ ...VALID, instructions: "" });
    expect(result.profile).toBeUndefined();
    expect(result.issues.some((i) => i.field === "instructions")).toBe(true);
  });

  test("rejects too many tools (> 64)", () => {
    const tools = Array.from({ length: 65 }, (_, i) => `tool_${i}`);
    const result = validateSubagentProfile({ ...VALID, tools });
    expect(result.profile).toBeUndefined();
  });

  test("rejects maxTurns over 50", () => {
    const result = validateSubagentProfile({ ...VALID, maxTurns: 100 });
    expect(result.profile).toBeUndefined();
  });

  test("rejects maxTurns under 1", () => {
    const result = validateSubagentProfile({ ...VALID, maxTurns: 0 });
    expect(result.profile).toBeUndefined();
  });

  test("expectedName mismatch is an error", () => {
    const result = validateSubagentProfile(VALID, { expectedName: "different-name" });
    expect(result.profile).toBeUndefined();
    expect(result.issues.some((i) => i.message.includes("does not match"))).toBe(true);
  });

  test("expectedName match passes silently", () => {
    const result = validateSubagentProfile(VALID, {
      expectedName: "regulatory-risk-analyst",
    });
    expect(result.profile).toBeDefined();
  });

  test("model field with leading colon emits warning, not error", () => {
    const result = validateSubagentProfile({ ...VALID, model: ":only-model" });
    expect(result.profile).toBeDefined();
    expect(result.issues.some((i) => i.severity === "warning" && i.field === "model")).toBe(true);
  });

  test("description over 1024 chars rejected", () => {
    const result = validateSubagentProfile({
      ...VALID,
      description: "x".repeat(1025),
    });
    expect(result.profile).toBeUndefined();
  });

  test("schema export round-trips parse", () => {
    expect(SubagentProfileSchema.safeParse(VALID).success).toBe(true);
  });
});

describe("summarizeSubagentProfile", () => {
  test("basic profile", () => {
    const summary = summarizeSubagentProfile({
      ...VALID,
      tools: ["a", "b", "c"],
    });
    expect(summary).toContain("regulatory-risk-analyst");
    expect(summary).toContain("3 tools");
  });

  test("singular tool", () => {
    const summary = summarizeSubagentProfile({ ...VALID, tools: ["only_one"] });
    expect(summary).toContain("1 tool");
    expect(summary).not.toContain("tools");
  });

  test("tags rendered", () => {
    const summary = summarizeSubagentProfile({
      ...VALID,
      tags: ["risk", "compliance"],
    });
    expect(summary).toContain("[risk,compliance]");
  });

  test("deprecated status surfaces", () => {
    const summary = summarizeSubagentProfile({ ...VALID, status: "deprecated" });
    expect(summary).toContain("(deprecated)");
  });

  test("active status does not render", () => {
    const summary = summarizeSubagentProfile({ ...VALID, status: "active" });
    expect(summary).not.toContain("(active)");
  });
});
