import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  composeAgentInstructions,
  composeAgentInstructionsWithSlots,
  composeRuntimePromptSections,
  resetPromptSectionCache,
} from "./promptSections.ts";
import { getActiveACELessonRevision } from "../ace/activeRevision.ts";
import { GordonConfigSchema } from "../../../types/index.ts";
import type { GordonContext } from "../types.ts";

const originalAceEnabled = process.env.GORDON_ACE_ENABLED;
const originalAcePath = process.env.GORDON_ACE_LESSONS_PATH;
const tempDirs: string[] = [];

function renderAceContext(threadId = "ace-test-thread"): string {
  const context = {
    exchange: null,
    broker: null,
    llm: {} as GordonContext["llm"],
    config: GordonConfigSchema.parse({}),
    portfolioValue: 0,
    availableCash: 0,
    userId: `user-${threadId}`,
    threadId,
    runtime: {
      runtimeId: `runtime-${threadId}`,
      sessionId: `session-${threadId}`,
      resourceId: `user-${threadId}`,
      threadId,
      evaluateToolAccess: async () => ({ status: "allowed" as const }),
    },
  } satisfies GordonContext;
  return composeRuntimePromptSections(context)
    .map((section) => section.content)
    .join("\n\n");
}

afterEach(() => {
  if (originalAceEnabled === undefined) delete process.env.GORDON_ACE_ENABLED;
  else process.env.GORDON_ACE_ENABLED = originalAceEnabled;
  if (originalAcePath === undefined) delete process.env.GORDON_ACE_LESSONS_PATH;
  else process.env.GORDON_ACE_LESSONS_PATH = originalAcePath;
  resetPromptSectionCache();
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("ACE lesson prompt integration", () => {
  test("injects a promoted lesson and its revision into the real request context", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-ace-prompt-"));
    tempDirs.push(dir);
    const path = join(dir, "ace-lessons.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        revision: 7,
        updatedAt: new Date().toISOString(),
        lessons: [
          {
            id: "risk_event::respect-drawdown",
            category: "risk_event",
            text: "Respect the session drawdown stop.",
            evidenceCount: 3,
            firstSeenAt: 1,
            lastSeenAt: 2,
            evidenceEntryIds: ["e1"],
            score: 0.9,
            curatedAt: new Date().toISOString(),
          },
        ],
      }),
      "utf-8",
    );
    process.env.GORDON_ACE_ENABLED = "true";
    process.env.GORDON_ACE_LESSONS_PATH = path;
    resetPromptSectionCache();
    const prompt = renderAceContext();
    expect(prompt).toContain("[GORDON_ACE_LESSONS]");
    expect(prompt).toContain("lesson-set revision 7");
    expect(prompt).toContain("Respect the session drawdown stop.");
    expect(getActiveACELessonRevision("ace-test-thread")).toBe(7);
  });

  test("sees a newly promoted revision without a process-wide cache reset", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-ace-refresh-"));
    tempDirs.push(dir);
    const path = join(dir, "ace-lessons.json");
    const lesson = (revision: number, text: string) => ({
      version: 1,
      revision,
      updatedAt: new Date().toISOString(),
      lessons: [
        {
          id: "risk_event::refresh",
          category: "risk_event",
          text,
          evidenceCount: 3,
          firstSeenAt: 1,
          lastSeenAt: 2,
          evidenceEntryIds: ["e1"],
          score: 0.9,
          curatedAt: new Date().toISOString(),
        },
      ],
    });
    writeFileSync(path, JSON.stringify(lesson(1, "First governed lesson.")), "utf-8");
    process.env.GORDON_ACE_ENABLED = "true";
    process.env.GORDON_ACE_LESSONS_PATH = path;

    expect(renderAceContext()).toContain("First governed lesson.");
    writeFileSync(path, JSON.stringify(lesson(2, "Replacement governed lesson.")), "utf-8");
    const refreshed = renderAceContext();
    expect(refreshed).toContain("Replacement governed lesson.");
    expect(refreshed).not.toContain("First governed lesson.");
    expect(getActiveACELessonRevision("ace-test-thread")).toBe(2);
  });

  test("keeps the revision attributed to each concurrent session", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-ace-sessions-"));
    tempDirs.push(dir);
    const path = join(dir, "ace-lessons.json");
    const snapshot = (revision: number, text: string) => ({
      version: 1,
      revision,
      updatedAt: new Date().toISOString(),
      lessons: [
        {
          id: `risk_event::session-${revision}`,
          category: "risk_event",
          text,
          evidenceCount: 3,
          firstSeenAt: 1,
          lastSeenAt: 2,
          evidenceEntryIds: ["e1"],
          score: 0.9,
          curatedAt: new Date().toISOString(),
        },
      ],
    });
    process.env.GORDON_ACE_ENABLED = "true";
    process.env.GORDON_ACE_LESSONS_PATH = path;
    writeFileSync(path, JSON.stringify(snapshot(1, "Session A lesson.")), "utf-8");
    expect(renderAceContext("thread-a")).toContain("Session A lesson.");
    writeFileSync(path, JSON.stringify(snapshot(2, "Session B lesson.")), "utf-8");
    expect(renderAceContext("thread-b")).toContain("Session B lesson.");
    expect(getActiveACELessonRevision("thread-a")).toBe(1);
    expect(getActiveACELessonRevision("thread-b")).toBe(2);
  });

  test("disabling ACE clears the prior active revision stamp", () => {
    const dir = mkdtempSync(join(tmpdir(), "gordon-ace-disable-"));
    tempDirs.push(dir);
    const path = join(dir, "ace-lessons.json");
    writeFileSync(
      path,
      JSON.stringify({
        version: 1,
        revision: 9,
        updatedAt: new Date().toISOString(),
        lessons: [
          {
            id: "risk_event::disable",
            category: "risk_event",
            text: "A governed lesson.",
            evidenceCount: 3,
            firstSeenAt: 1,
            lastSeenAt: 2,
            evidenceEntryIds: ["e1"],
            score: 0.9,
            curatedAt: new Date().toISOString(),
          },
        ],
      }),
      "utf-8",
    );
    process.env.GORDON_ACE_ENABLED = "true";
    process.env.GORDON_ACE_LESSONS_PATH = path;
    renderAceContext();
    expect(getActiveACELessonRevision("ace-test-thread")).toBe(9);

    process.env.GORDON_ACE_ENABLED = "false";
    const prompt = renderAceContext();
    expect(prompt).not.toContain("[GORDON_ACE_LESSONS]");
    expect(getActiveACELessonRevision("ace-test-thread")).toBe(0);
  });
});

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
