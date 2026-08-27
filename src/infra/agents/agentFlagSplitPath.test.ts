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
import { clearSessionOverrides, setSessionOverride } from "../config/settingsLayers.ts";
import { setCostBudget } from "../platform/costTracker.ts";
import { isACEEnabled } from "./ace/Reflector.ts";
import { dispatchSubagentTask, isDynamicSubagentsEnabled } from "./profiles/subagentDispatcher.ts";
import {
  discoverCostCeiling,
  getNativeInputProcessors,
  isNativeProcessorsEnabled,
} from "./processors/nativeProcessors.ts";

const prevCwd = process.cwd();
const dirs: string[] = [];
const TOUCHED = [
  "GORDON_ACE_ENABLED",
  "GORDON_DYNAMIC_SUBAGENTS",
  "GORDON_COST_BUDGET_USD",
  "GORDON_MASTRA_PROCESSORS",
  "GORDON_MASTRA_PROCESSORS_MODEL",
];

/**
 * Publish flags through the SESSION settings layer with env unset.
 *
 * The session layer rather than the project-layer file the helper above
 * writes: `flagResolver` refuses safety-critical flags from the project layer,
 * because a cloned repository can ship that file, so a project-layer fixture
 * would not reproduce the split path for anything on that list.
 */
function sessionLayerOnly(flags: Record<string, string>): void {
  setSessionOverride("flags", flags);
  resetFlagCache();
}

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
  clearSessionOverrides();
  resetFlagCache();
  setCostBudget(null);
});

afterAll(() => {
  for (const name of TOUCHED) delete process.env[name];
  process.chdir(prevCwd);
  clearSessionOverrides();
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
      {
        name: "split-path-probe",
        description: "probe",
        instructions: "probe.",
        tools: ["list_skills"],
      },
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

  test("GORDON_MASTRA_PROCESSORS reaches the native-processor gate", () => {
    sessionLayerOnly({ GORDON_MASTRA_PROCESSORS: "1" });
    expect(isNativeProcessorsEnabled()).toBe(true);
  });

  test("GORDON_MASTRA_PROCESSORS_MODEL reaches the detection-model choice", () => {
    // The model override is only observable through a processor the gate built,
    // so both flags are published together and the detector is inspected.
    sessionLayerOnly({
      GORDON_MASTRA_PROCESSORS: "1",
      GORDON_MASTRA_PROCESSORS_MODEL: "openai/gpt-5-nano",
    });
    const detector = getNativeInputProcessors().find((p) => p.id === "prompt-injection-detector");
    expect(detector).toBeDefined();
    expect(JSON.stringify(detector)).toContain("gpt-5-nano");
  });

  test("an explicit env var still wins over the settings layer", () => {
    settingsLayerOnly({ GORDON_ACE_ENABLED: "true" });
    process.env.GORDON_ACE_ENABLED = "false";
    expect(isACEEnabled()).toBe(false);
  });
});
