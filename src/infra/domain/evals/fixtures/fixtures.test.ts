import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";

import { generateScenarios } from "../harness/generator/index.ts";
import { runScenarioLive } from "../harness/live/runner.ts";
import { auditTraceToNormalized } from "../harness/traces/traceAdapter.ts";
import { scoreTrace } from "../harness/traces/traceScorer.ts";
import type { EvalScenario } from "../harness/types.ts";
import type { ScenarioLiveResult } from "../harness/live/runner.ts";
import {
  BASELINE_TRAJECTORIES_FIXTURE_PATH,
  FIXTURE_VARIANT_LABEL,
  GOLD_TRACES_FIXTURE_PATH,
  deterministicUuid,
  dryRunResultToAuditTrace,
  fixtureThreadId,
  parseGoldTraces,
  parseTrajectoryFixture,
} from "./fixtureAdapter.ts";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;

const SAMPLE_SCENARIO: EvalScenario = {
  id: "test-fixture-scan",
  tags: ["scan"],
  category: "scan",
  systemPrompt: "You are Gordon, a trading assistant.",
  userInput: "Scan BTC for setups.",
  derivedFrom: "test:fixture",
};

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(path, "utf8"));
}

describe("deterministicUuid", () => {
  it("is stable for the same seed and uuid-shaped", () => {
    const a = deterministicUuid("trace:foo");
    expect(a).toBe(deterministicUuid("trace:foo"));
    expect(a).toMatch(UUID_RE);
  });

  it("differs across seeds", () => {
    expect(deterministicUuid("trace:foo")).not.toBe(deterministicUuid("trace:bar"));
  });
});

describe("dryRunResultToAuditTrace", () => {
  it("round-trips the tool-call sequence and outcome through auditTraceToNormalized", async () => {
    const result = await runScenarioLive(SAMPLE_SCENARIO, {
      dryRun: true,
      variantLabel: FIXTURE_VARIANT_LABEL,
      threadId: fixtureThreadId(SAMPLE_SCENARIO.id),
    });
    const trace = dryRunResultToAuditTrace(SAMPLE_SCENARIO, result);
    const normalized = auditTraceToNormalized(trace);

    expect(normalized.toolCalls.map((c) => c.name)).toEqual(
      result.normalized.toolCalls.map((c) => c.name),
    );
    expect(normalized.toolCalls.map((c) => c.ok)).toEqual(
      result.normalized.toolCalls.map((c) => c.ok),
    );
    expect(normalized.outcomeType).toBe(result.normalized.outcomeType!);
    expect(trace.trigger.payload_summary).toBe(SAMPLE_SCENARIO.userInput);
    expect(trace.trigger.event_type).toBe(`eval.fixture:${SAMPLE_SCENARIO.id}`);
  });

  it("is deterministic across runs (stable ids and timestamps)", async () => {
    const opts = {
      dryRun: true,
      variantLabel: FIXTURE_VARIANT_LABEL,
      threadId: fixtureThreadId(SAMPLE_SCENARIO.id),
    };
    const first = dryRunResultToAuditTrace(
      SAMPLE_SCENARIO,
      await runScenarioLive(SAMPLE_SCENARIO, opts),
    );
    const second = dryRunResultToAuditTrace(
      SAMPLE_SCENARIO,
      await runScenarioLive(SAMPLE_SCENARIO, opts),
    );
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  it("fails closed when the producer output violates the audit schema", () => {
    const broken: ScenarioLiveResult = {
      trajectory: {
        id: FIXTURE_VARIANT_LABEL,
        messages: [{ role: "assistant", content: "x" }],
      },
      normalized: {
        toolCalls: [],
        outcomeType: "not_a_real_outcome",
      },
    };
    expect(() => dryRunResultToAuditTrace(SAMPLE_SCENARIO, broken)).toThrow();
  });
});

describe("committed baseline trajectory fixture", () => {
  it("exists, parses, and covers exactly the generated scenario ids", () => {
    expect(existsSync(BASELINE_TRAJECTORIES_FIXTURE_PATH)).toBe(true);
    const fixture = parseTrajectoryFixture(readJson(BASELINE_TRAJECTORIES_FIXTURE_PATH));
    expect(fixture.variantLabel).toBe(FIXTURE_VARIANT_LABEL);

    const fixtureIds = fixture.trajectories.map((t) => t.scenarioId).sort();
    const generatedIds = generateScenarios()
      .map((s) => s.id)
      .sort();
    expect(fixtureIds).toEqual(generatedIds);
  });

  it("matches a fresh dry-run regeneration (drift guard)", async () => {
    const fixture = parseTrajectoryFixture(readJson(BASELINE_TRAJECTORIES_FIXTURE_PATH));
    const byId = new Map(fixture.trajectories.map((t) => [t.scenarioId, t]));

    for (const scenario of generateScenarios()) {
      const committed = byId.get(scenario.id);
      expect(committed).toBeDefined();
      const fresh = await runScenarioLive(scenario, {
        dryRun: true,
        variantLabel: FIXTURE_VARIANT_LABEL,
        threadId: fixtureThreadId(scenario.id),
      });
      expect(committed!.messages).toEqual(fresh.trajectory.messages as never);
      expect(committed!.metadata).toEqual(fresh.trajectory.metadata as never);
    }
  });
});

describe("committed gold-trace fixture", () => {
  it("exists, parses, and covers exactly the generated scenario ids", () => {
    expect(existsSync(GOLD_TRACES_FIXTURE_PATH)).toBe(true);
    const parsed = parseGoldTraces(readJson(GOLD_TRACES_FIXTURE_PATH));
    expect(parsed.scenarioIds).toBeDefined();
    expect([...parsed.scenarioIds!].sort()).toEqual(
      generateScenarios()
        .map((s) => s.id)
        .sort(),
    );
  });

  it("every committed gold trace passes the deterministic process checks", () => {
    const parsed = parseGoldTraces(readJson(GOLD_TRACES_FIXTURE_PATH));
    for (const trace of parsed.traces) {
      const score = scoreTrace(trace);
      expect(score.processResult.passed).toBe(true);
      expect(score.flagged).toBe(false);
    }
  });
});

describe("parseGoldTraces", () => {
  it("accepts a bare AuditTrace[] (operator paper-mode capture)", () => {
    const fixture = parseGoldTraces(readJson(GOLD_TRACES_FIXTURE_PATH));
    const bare = parseGoldTraces(fixture.traces);
    expect(bare.traces.length).toBe(fixture.traces.length);
    expect(bare.scenarioIds).toBeUndefined();
  });

  it("rejects malformed input instead of skipping (fail closed)", () => {
    expect(() => parseGoldTraces({})).toThrow();
    expect(() => parseGoldTraces([])).toThrow();
    expect(() => parseGoldTraces({ formatVersion: 1, traces: [] })).toThrow();
  });
});
