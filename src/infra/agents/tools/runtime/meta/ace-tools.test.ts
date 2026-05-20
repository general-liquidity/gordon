import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { aceTools, getACEPromptBlock } from "./ace-tools.ts";
import { runCurator } from "../../../ace/Curator.ts";
import type { ReflectorOutput } from "../../../ace/Reflector.ts";

let tempDir: string;
let tempLessonsPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ace-tools-test-"));
  tempLessonsPath = join(tempDir, "ace-lessons.json");
  process.env.GORDON_ACE_LESSONS_PATH = tempLessonsPath;
});

afterEach(() => {
  delete process.env.GORDON_ACE_LESSONS_PATH;
  delete process.env.GORDON_ACE_ENABLED;
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true });
  }
});

function seedLesson(text: string, category: string): void {
  const out: ReflectorOutput = {
    candidates: [
      {
        text,
        category: category as never,
        evidenceCount: 1,
        firstSeenAt: Date.now(),
        lastSeenAt: Date.now(),
        evidenceEntryIds: [],
      },
    ],
    entriesAnalyzed: 1,
    generatedAt: new Date().toISOString(),
  };
  runCurator(out);
}

interface ACEExecuteResult {
  enabled: boolean;
  candidatesExtracted?: number;
  lessonsRetained?: number;
  count?: number;
  lessons?: unknown[];
  error?: string;
}

async function runTool(toolKey: keyof typeof aceTools, input: Record<string, unknown> = {}): Promise<ACEExecuteResult> {
  const tool = aceTools[toolKey];
  const exec = tool.execute as (args: unknown) => Promise<ACEExecuteResult>;
  return await exec(input);
}

describe("aceTools.run_ace_cycle", () => {
  it("no-ops when GORDON_ACE_ENABLED is unset", async () => {
    const result = await runTool("run_ace_cycle", { lookbackEntries: 50 });
    expect(result.enabled).toBe(false);
    expect(result.candidatesExtracted).toBe(0);
    expect(result.lessonsRetained).toBe(0);
    expect(existsSync(tempLessonsPath)).toBe(false);
  });

  it("returns counts when enabled (with empty action log)", async () => {
    process.env.GORDON_ACE_ENABLED = "true";
    const result = await runTool("run_ace_cycle", { lookbackEntries: 50 });
    expect(result.enabled).toBe(true);
    // Empty action log → 0 candidates extracted; lessons retained may be > 0
    // if the curator has prior state, but in this temp dir it starts empty.
    expect(typeof result.candidatesExtracted).toBe("number");
    expect(typeof result.lessonsRetained).toBe("number");
  });

  it("never throws on tool execution", async () => {
    process.env.GORDON_ACE_ENABLED = "true";
    let caught: unknown;
    try {
      await runTool("run_ace_cycle", { lookbackEntries: 50 });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeUndefined();
  });
});

describe("aceTools.list_ace_lessons", () => {
  it("no-ops when GORDON_ACE_ENABLED is unset", async () => {
    const result = await runTool("list_ace_lessons", { limit: 20 });
    expect(result.enabled).toBe(false);
    expect(result.count).toBe(0);
    expect(result.lessons).toEqual([]);
  });

  it("returns seeded lessons sorted by score when enabled", async () => {
    process.env.GORDON_ACE_ENABLED = "true";
    seedLesson("Drawdown event on a Friday", "risk_event");
    seedLesson("Switched models", "operational");
    const result = await runTool("list_ace_lessons", { limit: 10 });
    expect(result.enabled).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(2);
    const lessons = result.lessons as Array<{ category: string }>;
    // risk_event has higher base score than operational
    expect(lessons[0]?.category).toBe("risk_event");
  });

  it("respects the limit param", async () => {
    process.env.GORDON_ACE_ENABLED = "true";
    seedLesson("L1", "risk_event");
    seedLesson("L2", "execution_failure");
    seedLesson("L3", "strategy_decay");
    const result = await runTool("list_ace_lessons", { limit: 2 });
    expect((result.lessons as unknown[]).length).toBe(2);
  });
});

describe("getACEPromptBlock", () => {
  it("returns empty string when ACE is disabled", () => {
    expect(getACEPromptBlock()).toBe("");
  });

  it("returns the formatted block when enabled and lessons exist", () => {
    process.env.GORDON_ACE_ENABLED = "true";
    seedLesson("Avoid trading during low-liquidity hours", "user_preference");
    const block = getACEPromptBlock();
    expect(block).toContain("[GORDON_ACE_LESSONS]");
    expect(block).toContain("user_preference");
  });

  it("returns empty string when enabled but no lessons exist", () => {
    process.env.GORDON_ACE_ENABLED = "true";
    // formatACELessonsForPrompt returns "" when store.lessons is empty
    expect(getACEPromptBlock()).toBe("");
  });
});
