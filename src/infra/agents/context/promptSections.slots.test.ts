import { describe, expect, test } from "bun:test";
import {
  composeAgentInstructions,
  composeAgentInstructionsWithSlots,
  resetPromptSectionCache,
} from "./promptSections.ts";

describe("composeAgentInstructionsWithSlots — behavior parity with composeAgentInstructions", () => {
  test("USER-only call equals composeAgentInstructions output", () => {
    resetPromptSectionCache();
    const userBody = "You are the test agent. Be concise.";
    const baseline = composeAgentInstructions("executor", userBody);
    resetPromptSectionCache();
    const slotted = composeAgentInstructionsWithSlots("executor", {
      user: userBody,
    });
    expect(slotted).toBe(baseline);
  });

  test("USER-only call across all 3 agent roles matches composeAgentInstructions", () => {
    const userBody = "agent body content here";
    const roles = ["gordon", "executor", "researcher"] as const;
    for (const role of roles) {
      resetPromptSectionCache();
      const baseline = composeAgentInstructions(role, userBody);
      resetPromptSectionCache();
      const slotted = composeAgentInstructionsWithSlots(role, {
        user: userBody,
      });
      expect(slotted).toBe(baseline);
    }
  });
});

describe("composeAgentInstructionsWithSlots — SUFFIX", () => {
  test("SUFFIX is appended after USER", () => {
    const result = composeAgentInstructionsWithSlots("executor", {
      user: "USER_BODY",
      suffix: "SUFFIX_BODY",
    });
    const userIdx = result.indexOf("USER_BODY");
    const suffixIdx = result.indexOf("SUFFIX_BODY");
    expect(userIdx).toBeGreaterThanOrEqual(0);
    expect(suffixIdx).toBeGreaterThan(userIdx);
  });

  test("empty SUFFIX is dropped", () => {
    const withEmpty = composeAgentInstructionsWithSlots("executor", {
      user: "USER",
      suffix: "",
    });
    const without = composeAgentInstructionsWithSlots("executor", {
      user: "USER",
    });
    expect(withEmpty).toBe(without);
  });

  test("whitespace-only SUFFIX is dropped", () => {
    const withWs = composeAgentInstructionsWithSlots("executor", {
      user: "USER",
      suffix: "   \n  \t  ",
    });
    const without = composeAgentInstructionsWithSlots("executor", {
      user: "USER",
    });
    expect(withWs).toBe(without);
  });
});

describe("composeAgentInstructionsWithSlots — CUSTOM", () => {
  test("CUSTOM replaces BASE registry sections entirely", () => {
    const result = composeAgentInstructionsWithSlots("executor", {
      user: "USER_BODY",
      custom: "CUSTOM_BODY",
    });
    expect(result).toContain("CUSTOM_BODY");
    expect(result).toContain("USER_BODY");
    // No registry-driven BASE content should appear when CUSTOM is supplied.
    // The exact registry content varies by config, but it never contains
    // the literal "CUSTOM_BODY" marker.
    const customIdx = result.indexOf("CUSTOM_BODY");
    const userIdx = result.indexOf("USER_BODY");
    expect(customIdx).toBeGreaterThanOrEqual(0);
    expect(userIdx).toBeGreaterThan(customIdx); // CUSTOM before USER
  });

  test("CUSTOM + SUFFIX renders CUSTOM → USER → SUFFIX", () => {
    const result = composeAgentInstructionsWithSlots("executor", {
      user: "MID",
      custom: "FIRST",
      suffix: "LAST",
    });
    const firstIdx = result.indexOf("FIRST");
    const midIdx = result.indexOf("MID");
    const lastIdx = result.indexOf("LAST");
    expect(firstIdx).toBe(0);
    expect(midIdx).toBeGreaterThan(firstIdx);
    expect(lastIdx).toBeGreaterThan(midIdx);
  });

  test("empty CUSTOM falls back to BASE registry", () => {
    resetPromptSectionCache();
    const baseline = composeAgentInstructions("executor", "USER");
    resetPromptSectionCache();
    const withEmptyCustom = composeAgentInstructionsWithSlots("executor", {
      user: "USER",
      custom: "",
    });
    expect(withEmptyCustom).toBe(baseline);
  });

  test("whitespace-only CUSTOM falls back to BASE registry", () => {
    resetPromptSectionCache();
    const baseline = composeAgentInstructions("executor", "USER");
    resetPromptSectionCache();
    const wsCustom = composeAgentInstructionsWithSlots("executor", {
      user: "USER",
      custom: "   \n  ",
    });
    expect(wsCustom).toBe(baseline);
  });
});

describe("composeAgentInstructionsWithSlots — joiners + trimming", () => {
  test("joiner is double-newline between slots", () => {
    const result = composeAgentInstructionsWithSlots("executor", {
      user: "USER",
      custom: "CUSTOM",
      suffix: "SUFFIX",
    });
    // Confirm slots are separated by exactly \n\n
    expect(result).toContain("CUSTOM\n\nUSER");
    expect(result).toContain("USER\n\nSUFFIX");
  });

  test("USER body whitespace is trimmed before joining", () => {
    const result = composeAgentInstructionsWithSlots("executor", {
      user: "  USER_BODY  \n",
      custom: "CUSTOM",
    });
    // Should not contain leading/trailing whitespace around USER_BODY
    expect(result).toContain("CUSTOM\n\nUSER_BODY");
    expect(result).not.toContain("USER_BODY  \n");
  });
});
