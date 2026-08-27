import { describe, expect, it, beforeEach, afterEach } from "bun:test";

import {
  isDurableAgentsEnabled,
  buildDurableAutonomousRunner,
  DURABLE_AGENTS_FLAG_ENV,
  type CreateDurableFn,
  type DurableAgentLike,
} from "./durableRunner.ts";
import { createMandate, type SwingMandate } from "../../../core/safety/swing-mandate.ts";
import { tripKillSwitch, resetAllKillSwitches } from "../../safety/killSwitches.ts";

function mandate(overrides: Partial<SwingMandate> = {}): SwingMandate {
  return createMandate({
    symbols: ["BTCUSDT"],
    timeframe: "4h",
    direction: "long",
    minConfidence: 0.6,
    maxDrawdown: 5,
    ...overrides,
  });
}

interface FakeCalls {
  setObjective: Array<{ objective: string; options: Record<string, unknown> }>;
  stream: Array<{ messages: unknown; options: Record<string, unknown> }>;
}

function fakeDurable(calls: FakeCalls): DurableAgentLike {
  return {
    async setObjective(objective, options) {
      calls.setObjective.push({ objective, options });
    },
    async stream(messages, options = {}) {
      calls.stream.push({ messages, options });
      return {
        output: { text: Promise.resolve("ok") },
        runId: "run_test_1",
        threadId: (options.memory as { thread?: string })?.thread,
        resourceId: (options.memory as { resource?: string })?.resource,
        cleanup: () => {},
        abort: () => {},
      };
    },
    async observe(runId) {
      return { output: {}, runId, cleanup: () => {} };
    },
    async recoverActiveRuns() {
      return {
        recovered: [{ runId: "run_test_1", status: "success" as const }],
        succeeded: 1,
        failed: 0,
      };
    },
  };
}

function build(calls: FakeCalls, extra: Record<string, unknown> = {}) {
  const create: CreateDurableFn = () => fakeDurable(calls);
  return buildDurableAutonomousRunner({
    agent: { id: "gordon", name: "Gordon" },
    mandate: mandate(),
    threadId: "t1",
    resourceId: "u1",
    goal: { judgeModelId: "anthropic/claude-sonnet-4-6", maxRuns: 12 },
    createDurable: create,
    ...extra,
  });
}

describe("isDurableAgentsEnabled", () => {
  const prior = process.env[DURABLE_AGENTS_FLAG_ENV];
  afterEach(() => {
    if (prior === undefined) delete process.env[DURABLE_AGENTS_FLAG_ENV];
    else process.env[DURABLE_AGENTS_FLAG_ENV] = prior;
  });

  it("is off by default (unset)", () => {
    expect(isDurableAgentsEnabled({})).toBe(false);
  });

  it("accepts 1 / true / yes (case-insensitive)", () => {
    expect(isDurableAgentsEnabled({ [DURABLE_AGENTS_FLAG_ENV]: "1" })).toBe(true);
    expect(isDurableAgentsEnabled({ [DURABLE_AGENTS_FLAG_ENV]: "true" })).toBe(true);
    expect(isDurableAgentsEnabled({ [DURABLE_AGENTS_FLAG_ENV]: "YES" })).toBe(true);
  });

  it("rejects other values", () => {
    expect(isDurableAgentsEnabled({ [DURABLE_AGENTS_FLAG_ENV]: "0" })).toBe(false);
    expect(isDurableAgentsEnabled({ [DURABLE_AGENTS_FLAG_ENV]: "off" })).toBe(false);
  });
});

describe("buildDurableAutonomousRunner preflight", () => {
  beforeEach(() => resetAllKillSwitches("test setup"));
  afterEach(() => resetAllKillSwitches("test teardown"));

  it("allows when no kill switch is tripped", () => {
    const runner = build({ setObjective: [], stream: [] });
    const gate = runner.preflight();
    expect(gate.allowed).toBe(true);
  });

  it("blocks when the firm-wide kill switch is tripped", () => {
    tripKillSwitch({ scope: "firm" }, "manual halt");
    const runner = build({ setObjective: [], stream: [] });
    const gate = runner.preflight();
    expect(gate.allowed).toBe(false);
    if (!gate.allowed) {
      expect(gate.reason).toContain("blocked");
    }
  });
});

describe("buildDurableAutonomousRunner start", () => {
  beforeEach(() => resetAllKillSwitches("test setup"));
  afterEach(() => resetAllKillSwitches("test teardown"));

  it("refuses to start (no agent call) when a kill switch is tripped", async () => {
    tripKillSwitch({ scope: "firm" }, "manual halt");
    const calls: FakeCalls = { setObjective: [], stream: [] };
    const runner = build(calls);
    const result = await runner.start("scan and propose A+ setups");
    expect(result.ok).toBe(false);
    // The money-path gate must fire before any durable agent call.
    expect(calls.setObjective.length).toBe(0);
    expect(calls.stream.length).toBe(0);
  });

  it("sets the native goal objective and opens the durable idle stream", async () => {
    const calls: FakeCalls = { setObjective: [], stream: [] };
    const runner = build(calls);
    const result = await runner.start("scan and propose A+ setups");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.runId).toBe("run_test_1");
      expect(result.sprintContract).toBeDefined();
      expect(typeof result.cleanup).toBe("function");
      expect(typeof result.abort).toBe("function");
    }

    // Objective persisted with the goal knobs.
    expect(calls.setObjective.length).toBe(1);
    const obj = calls.setObjective[0]!;
    expect(obj.objective).toContain("A+ setups");
    expect(obj.options.threadId).toBe("t1");
    expect(obj.options.judgeModelId).toBe("anthropic/claude-sonnet-4-6");
    expect(obj.options.maxRuns).toBe(12);

    // Background-task idle loop engaged with memory scope.
    expect(calls.stream.length).toBe(1);
    const streamed = calls.stream[0]!;
    expect(streamed.options.untilIdle).toBe(true);
    expect(streamed.options.memory).toEqual({ thread: "t1", resource: "u1" });
  });

  it("passes a numeric untilIdle through as maxIdleMs", async () => {
    const calls: FakeCalls = { setObjective: [], stream: [] };
    const runner = build(calls, { untilIdle: 60_000 });
    await runner.start("go");
    expect(calls.stream[0]!.options.untilIdle).toEqual({ maxIdleMs: 60_000 });
  });
});

describe("buildDurableAutonomousRunner recover", () => {
  it("re-drives orphaned durable runs", async () => {
    const calls: FakeCalls = { setObjective: [], stream: [] };
    const runner = build(calls);
    const res = await runner.recover();
    expect(res.succeeded).toBe(1);
    expect(res.failed).toBe(0);
  });
});
