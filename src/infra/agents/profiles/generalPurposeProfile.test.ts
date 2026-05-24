import { describe, expect, test } from "bun:test";
import {
  applyGeneralPurposeFallback,
  GENERAL_PURPOSE_PROFILE,
  GENERAL_PURPOSE_PROFILE_NAME,
  isGeneralPurposeDisabled,
} from "./generalPurposeProfile.ts";
import type { SubagentProfile } from "./subagentProfile.ts";

const SAMPLE_OPERATOR: SubagentProfile = {
  name: "operator-analyst",
  description: "test",
  instructions: "x",
  tools: ["scan_market"],
};

describe("Patch 2 — isGeneralPurposeDisabled", () => {
  test("false when env unset", () => {
    expect(isGeneralPurposeDisabled({})).toBe(false);
  });

  test("true for '1'", () => {
    expect(isGeneralPurposeDisabled({ GORDON_DYNAMIC_SUBAGENTS_NO_GP: "1" })).toBe(true);
  });

  test("true for 'true'", () => {
    expect(isGeneralPurposeDisabled({ GORDON_DYNAMIC_SUBAGENTS_NO_GP: "true" })).toBe(true);
  });

  test("case-insensitive", () => {
    expect(isGeneralPurposeDisabled({ GORDON_DYNAMIC_SUBAGENTS_NO_GP: "TRUE" })).toBe(true);
  });

  test("false for arbitrary string", () => {
    expect(isGeneralPurposeDisabled({ GORDON_DYNAMIC_SUBAGENTS_NO_GP: "off" })).toBe(false);
  });
});

describe("Patch 2 — applyGeneralPurposeFallback", () => {
  test("empty operator profiles + env unset → injects general-purpose", () => {
    const result = applyGeneralPurposeFallback(new Map(), {});
    expect(result.size).toBe(1);
    expect(result.get(GENERAL_PURPOSE_PROFILE_NAME)).toBeDefined();
  });

  test("empty operator profiles + opt-out → returns empty unchanged", () => {
    const result = applyGeneralPurposeFallback(new Map(), {
      GORDON_DYNAMIC_SUBAGENTS_NO_GP: "1",
    });
    expect(result.size).toBe(0);
  });

  test("non-empty operator profiles → does NOT inject general-purpose", () => {
    const operator = new Map([[SAMPLE_OPERATOR.name, SAMPLE_OPERATOR]]);
    const result = applyGeneralPurposeFallback(operator, {});
    expect(result.size).toBe(1);
    expect(result.get(GENERAL_PURPOSE_PROFILE_NAME)).toBeUndefined();
    expect(result.get("operator-analyst")).toBeDefined();
  });

  test("non-empty operator profiles + opt-out → unchanged", () => {
    const operator = new Map([[SAMPLE_OPERATOR.name, SAMPLE_OPERATOR]]);
    const result = applyGeneralPurposeFallback(operator, {
      GORDON_DYNAMIC_SUBAGENTS_NO_GP: "1",
    });
    expect(result.size).toBe(1);
    expect(result.get("operator-analyst")).toBeDefined();
  });

  test("pure — does not mutate input map", () => {
    const empty = new Map<string, SubagentProfile>();
    applyGeneralPurposeFallback(empty, {});
    expect(empty.size).toBe(0);
  });
});

describe("Patch 2 — GENERAL_PURPOSE_PROFILE shape", () => {
  test("kebab-case name", () => {
    expect(GENERAL_PURPOSE_PROFILE.name).toBe("general-purpose");
  });

  test("active status", () => {
    expect(GENERAL_PURPOSE_PROFILE.status).toBe("active");
  });

  test("owner is 'builtin'", () => {
    expect(GENERAL_PURPOSE_PROFILE.owner).toBe("builtin");
  });

  test("tools whitelist is broad ('*')", () => {
    expect(GENERAL_PURPOSE_PROFILE.tools).toEqual(["*"]);
  });

  test("maxTurns within bounds", () => {
    expect(GENERAL_PURPOSE_PROFILE.maxTurns).toBeGreaterThan(0);
    expect(GENERAL_PURPOSE_PROFILE.maxTurns).toBeLessThanOrEqual(50);
  });

  test("tagged as 'builtin' + 'fallback'", () => {
    expect(GENERAL_PURPOSE_PROFILE.tags).toContain("builtin");
    expect(GENERAL_PURPOSE_PROFILE.tags).toContain("fallback");
  });
});
