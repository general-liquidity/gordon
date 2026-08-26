/**
 * Split-path regression for the three agent-tree flag readers that the
 * earlier unification pass did not cover.
 *
 * `/flags set` persists to the settings layer, which only `flagResolver`
 * reads. A reader on raw `process.env` therefore honors the flag for the
 * rest of the session and silently stops after the next restart. Each case
 * writes ONLY the settings layer, with the env var explicitly unset, and
 * asserts the reader observes it.
 */

import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resetFlagCache } from "../config/flagResolver.ts";
import { setCostBudget } from "../platform/costTracker.ts";
import { isACEEnabled } from "./ace/Reflector.ts";
import { dispatchSubagentTask, isDynamicSubagentsEnabled } from "./profiles/subagentDispatcher.ts";
import { discoverCostCeiling } from "./processors/nativeProcessors.ts";

const prevCwd = process.cwd();
const dirs: string[] = [];
const TOUCHED = ["GORDON_ACE_ENABLED", "GORDON_DYNAMIC_SUBAGENTS", "GORDON_COST_BUDGET_USD"];

/** Write a project-layer settings.json holding only the given flags. */
function settingsLayerOnly(flags: Record<string, string>): void {
  const dir = mkdtempSync(join(tmpdir(), "gordon-agentflags-"));
  dirs.push(dir);
  mkdirSync(join(dir, ".gordon"), { recursive: true });
  writeFileSync(join(dir, ".gordon", "settings.json"), JSON.stringify({ flags }), "utf-8");
  process.chdir(dir);
  resetFlagCache();
}

beforeEach(() => {
  for (const name of TOUCHED) delete process.env[name];
  process.chdir(prevCwd);
  resetFlagCache();
  setCostBudget(null);
});

afterAll(() => {
  for (const name of TOUCHED) delete process.env[name];
  process.chdir(prevCwd);
  resetFlagCache();
  setCostBudget(null);
  for (const dir of dirs) {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort temp cleanup
    }
  }
});

describe("settings-layer flags reach their agent-tree reader", () => {
  test("GORDON_ACE_ENABLED reaches isACEEnabled", () => {
    settingsLayerOnly({ GORDON_ACE_ENABLED: "true" });
    expect(isACEEnabled()).toBe(true);
  });

  test("GORDON_DYNAMIC_SUBAGENTS reaches isDynamicSubagentsEnabled", () => {
    settingsLayerOnly({ GORDON_DYNAMIC_SUBAGENTS: "1" });
    expect(isDynamicSubagentsEnabled()).toBe(true);
  });

  test("GORDON_DYNAMIC_SUBAGENTS reaches the live dispatch path", async () => {
    // dispatchSubagentTask passed raw process.env explicitly, so fixing the
    // default parameter alone left this second entry point on the split path.
    settingsLayerOnly({ GORDON_DYNAMIC_SUBAGENTS: "1" });
    const result = await dispatchSubagentTask(
      { name: "split-path-probe", description: "probe", instructions: "probe.", tools: ["list_skills"] },
      "probe the flag path",
      { list_skills: { id: "list_skills" } },
      { agentFactory: () => ({ generate: async () => ({ text: "ok" }) }) },
    );
    expect(result.status).not.toBe("disabled");
  });

  test("GORDON_COST_BUDGET_USD reaches the native cost-guard ceiling", () => {
    settingsLayerOnly({ GORDON_COST_BUDGET_USD: "7" });
    expect(discoverCostCeiling()).toBe(7);
  });

  test("an explicit env var still wins over the settings layer", () => {
    settingsLayerOnly({ GORDON_ACE_ENABLED: "true" });
    process.env.GORDON_ACE_ENABLED = "false";
    expect(isACEEnabled()).toBe(false);
  });
});
