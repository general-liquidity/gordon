import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { RiskKernel } from "../../../../../core/risk-kernel/kernel.ts";
import { loadConfigFromEnv } from "../../../../../core/risk-kernel/config.ts";
import { getDefaultTrustTrajectory } from "../../../../../runtime/permissions/trustTrajectory.ts";
import { GordonConfigSchema } from "../../../../../types/index.ts";
import { getDatabasePath } from "../../../../storage/database.ts";
import { ADVERSARIAL_SCENARIOS, buildMockJudgeClient } from "../index.ts";
import type { EvalScenario } from "../types.ts";
import { produceKRuns } from "./kRunProducer.ts";
import { runLiveEvalSuite, runScenarioLive } from "./runner.ts";
import {
  buildPaperContext,
  createEvalSandbox,
  EVAL_SANDBOX_MARKER_ENV,
  RISK_MODE_ENV,
  TRUST_LEDGER_PATH_ENV,
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

  it("buildPaperContext throws when the sandbox is not installed", () => {
    const sandbox = createEvalSandbox({ dryRun: true });
    sandbox.cleanup();
    expect(() => buildPaperContext(sandbox)).toThrow(/sandbox/i);
  });

  it("runScenarioLive in live mode refuses a disposed sandbox", async () => {
    const sandbox = createEvalSandbox();
    sandbox.cleanup();
    await expect(runScenarioLive(SAMPLE_SCENARIO, { dryRun: false, sandbox })).rejects.toThrow(
      /sandbox/i,
    );
  });
});

describe("EvalSandbox risk-kernel isolation", () => {
  it("forces GORDON_RISK_MODE=paper while applied and restores the prior value", async () => {
    const prev = process.env[RISK_MODE_ENV];
    process.env[RISK_MODE_ENV] = "enforce";

    await withEvalSandbox(async () => {
      expect(process.env[RISK_MODE_ENV]).toBe("paper");
    });
    expect(process.env[RISK_MODE_ENV]).toBe("enforce");

    if (prev === undefined) delete process.env[RISK_MODE_ENV];
    else process.env[RISK_MODE_ENV] = prev;
  });

  it("kernel evaluation inside the sandbox approves in paper mode even for violating orders", async () => {
    await withEvalSandbox(async () => {
      const kernel = new RiskKernel(loadConfigFromEnv());
      const decision = await kernel.evaluate(
        {
          symbol: "BTCUSDT",
          side: "buy",
          type: "market",
          quantity: 1_000_000,
          price: 50_000,
          exchangeId: "eval-stub",
          agentId: "eval-test",
        },
        {
          totalEquity: 10_000,
          availableBalance: 5_000,
          openPositions: [],
          todayPnL: 0,
          todayTradeCount: 0,
          currentDrawdown: 0,
          peakEquity: 10_000,
        },
        // The eval sandbox is not a venue: nothing here can fill. Paper mode is
        // only honored when the caller says so, because resolveLiveSafeMode now
        // upgrades paper to enforce on an unknown/live venue.
        { sandboxActive: true },
      );
      expect(decision.approved).toBe(true);
      expect(decision.reason).toContain("Paper mode");
    });
  });
});

describe("EvalSandbox trust-ledger isolation", () => {
  it("persists sandbox trust writes to the sandbox ledger path", async () => {
    await withEvalSandbox(async (sandbox) => {
      expect(process.env[TRUST_LEDGER_PATH_ENV]).toBe(sandbox.paths.trustLedger);
      sandbox.trustTrajectory.record({
        toolName: "get_market_data",
        decision: "approved",
        timestamp: Date.now(),
        permissionScope: "papertrade.read",
      });
      expect(existsSync(sandbox.paths.trustLedger)).toBe(true);
      const rows = readFileSync(sandbox.paths.trustLedger, "utf8").trim().split("\n");
      expect(rows.length).toBe(1);
      expect(JSON.parse(rows[0]!).toolName).toBe("get_market_data");
    });
  });

  it("resets the default trust trajectory at both sandbox boundaries", async () => {
    const before = getDefaultTrustTrajectory();
    before.record({ toolName: "operator_tool", decision: "approved", timestamp: Date.now() });

    let inside: ReturnType<typeof getDefaultTrustTrajectory> | undefined;
    await withEvalSandbox(async () => {
      inside = getDefaultTrustTrajectory();
      expect(inside).not.toBe(before);
      expect(inside.listEvents().length).toBe(0);
      inside.record({ toolName: "eval_tool", decision: "approved", timestamp: Date.now() });
    });

    const after = getDefaultTrustTrajectory();
    expect(after).not.toBe(inside);
    expect(after.listEvents().length).toBe(0);
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
