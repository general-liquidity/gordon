import { afterEach, describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";

import { GordonConfigSchema } from "../../../../../types/index.ts";
import { getDatabasePath } from "../../../../storage/database.ts";
import { ADVERSARIAL_SCENARIOS, buildMockJudgeClient } from "../index.ts";
import type { EvalScenario } from "../types.ts";
import { produceKRuns } from "./kRunProducer.ts";
import { runLiveEvalSuite } from "./runner.ts";
import {
  buildPaperContext,
  createEvalSandbox,
  EVAL_SANDBOX_MARKER_ENV,
  withEvalSandbox,
  type EvalSandbox,
} from "./sandbox.ts";

const SAMPLE_SCENARIO: EvalScenario = {
  id: "test-scan-1",
  tags: ["scan"],
  category: "scan",
  systemPrompt: "You are Gordon, a trading assistant.",
  userInput: "Scan BTC for setups.",
  derivedFrom: "test:scan",
};

const SAFETY_SCENARIO = ADVERSARIAL_SCENARIOS[0]!;

let activeSandbox: EvalSandbox | null = null;

afterEach(() => {
  activeSandbox?.cleanup();
  activeSandbox = null;
});

describe("EvalSandbox", () => {
  it("isolates paths and restores env on cleanup", async () => {
    const prevHome = process.env.GORDON_HOME;
    const prevMarker = process.env[EVAL_SANDBOX_MARKER_ENV];

    await withEvalSandbox(async (sandbox) => {
      expect(process.env[EVAL_SANDBOX_MARKER_ENV]).toBe("1");
      expect(process.env.GORDON_HOME).toBe(sandbox.paths.home);
      expect(getDatabasePath()).toBe(sandbox.paths.database);
      expect(existsSync(sandbox.paths.home)).toBe(true);
    });

    if (prevHome === undefined) delete process.env.GORDON_HOME;
    else process.env.GORDON_HOME = prevHome;
    if (prevMarker === undefined) delete process.env[EVAL_SANDBOX_MARKER_ENV];
    else process.env[EVAL_SANDBOX_MARKER_ENV] = prevMarker;
  });

  it("buildPaperContext uses paper permission mode", () => {
    activeSandbox = createEvalSandbox({ dryRun: true });
    const ctx = buildPaperContext(activeSandbox, { threadId: "t-1", userId: "u-1" });
    expect(ctx.config.permissionMode).toBe("paper");
    expect(GordonConfigSchema.parse(ctx.config).permissionMode).toBe("paper");
    expect(ctx.threadId).toBe("t-1");
    expect(ctx.exchange).toBeNull();
  });
});

describe("produceKRuns dryRun", () => {
  it("runs k times deterministically and aggregates pass^k", async () => {
    await withEvalSandbox(async (sandbox) => {
      const k = 3;
      const first = await produceKRuns({
        scenario: SAFETY_SCENARIO,
        k,
        sandbox,
        dryRun: true,
      });
      const second = await produceKRuns({
        scenario: SAFETY_SCENARIO,
        k,
        sandbox,
        dryRun: true,
      });

      expect(first.trajectories.length).toBe(k);
      expect(first.processResults.every((r) => r.passed)).toBe(true);
      expect(first.passKResult.k).toBe(k);
      expect(first.passKResult.meets).toBe(true);
      expect(first.passKResult.mode).toBe("all");

      expect(first.trajectories[0]?.messages[2]?.content).toBe(
        second.trajectories[0]?.messages[2]?.content,
      );
    });
  });
});

describe("runLiveEvalSuite dryRun", () => {
  it("produces trajectories for 2 variants and scores via mock judge", async () => {
    const scenarios = [SAMPLE_SCENARIO, SAFETY_SCENARIO];
    const responses: Record<string, Array<{ id: string; score: number }>> = {};
    for (const s of scenarios) {
      responses[s.id] = [
        { id: "variant-a", score: 0.9 },
        { id: "variant-b", score: 0.4 },
      ];
    }
    const client = buildMockJudgeClient({ responses });

    const result = await withEvalSandbox((sandbox) =>
      runLiveEvalSuite({
        scenarios,
        variants: [{ variantLabel: "variant-a" }, { variantLabel: "variant-b" }],
        sandbox,
        dryRun: true,
        judgeOptions: { client },
      }),
    );

    expect(result.results.length).toBe(2);
    expect(result.skippedScenarios.length).toBe(0);
    const a = result.results.find((r) => r.variantLabel === "variant-a")!;
    const b = result.results.find((r) => r.variantLabel === "variant-b")!;
    expect(a.scenarioCount).toBe(2);
    expect(a.aggregate).toBeGreaterThan(b.aggregate);
  });
});