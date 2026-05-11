import { describe, it, expect } from "bun:test";
import {
  ALL_SCENARIOS,
  ALL_SCENARIO_IDS,
  buildMockJudgeClient,
  detectRegressions,
  formatRegressionReport,
  getScenarioById,
  judgeTrajectories,
  planCardBtc,
  regimeFlip,
  riskGate,
  runEvalSuite,
  scenariosByTag,
  type EvalScenario,
  type EvalTrajectory,
  type RunVariantInput,
  type VariantRunResult,
} from "./index.ts";

function makeTraj(id: string, content: string): EvalTrajectory {
  return {
    id,
    messages: [
      { role: "system", content: "stub" },
      { role: "user", content: "stub" },
      { role: "assistant", content },
    ],
  };
}

describe("scenarios catalog", () => {
  it("ships the three initial scenarios", () => {
    expect(ALL_SCENARIOS.length).toBe(3);
    expect(ALL_SCENARIO_IDS).toContain("plan-card-btc");
    expect(ALL_SCENARIO_IDS).toContain("regime-flip");
    expect(ALL_SCENARIO_IDS).toContain("risk-gate");
  });

  it("each scenario has the required fields", () => {
    for (const s of ALL_SCENARIOS) {
      expect(typeof s.id).toBe("string");
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.tags.length).toBeGreaterThan(0);
      expect(s.systemPrompt.length).toBeGreaterThan(50);
      expect(s.userInput.length).toBeGreaterThan(10);
    }
  });

  it("scenariosByTag filters correctly", () => {
    expect(scenariosByTag("plan-card").length).toBe(1);
    expect(scenariosByTag("plan-card")[0]?.id).toBe("plan-card-btc");
    expect(scenariosByTag("nonexistent-tag")).toEqual([]);
  });

  it("getScenarioById resolves known scenarios", () => {
    expect(getScenarioById("regime-flip")).toBe(regimeFlip);
    expect(getScenarioById("plan-card-btc")).toBe(planCardBtc);
    expect(getScenarioById("risk-gate")).toBe(riskGate);
    expect(getScenarioById("ghost")).toBeUndefined();
  });
});

describe("judgeTrajectories", () => {
  const scenario: EvalScenario = {
    id: "test-scenario",
    tags: ["test"],
    systemPrompt: "Be helpful and accurate.",
    userInput: "Hello",
  };

  it("returns empty result for empty trajectory list", async () => {
    const r = await judgeTrajectories({ scenario, trajectories: [] });
    expect(r.scored.length).toBe(0);
    expect(r.scenarioId).toBe("test-scenario");
  });

  it("returns uniform high score for a single trajectory", async () => {
    const r = await judgeTrajectories({
      scenario,
      trajectories: [makeTraj("solo", "response")],
    });
    expect(r.scored.length).toBe(1);
    expect(r.scored[0]?.score).toBe(1.0);
    expect(r.scored[0]?.rank).toBe(1);
  });

  it("uses the mock judge client and returns sorted scored trajectories", async () => {
    const client = buildMockJudgeClient({
      responses: {
        "test-scenario": [
          { id: "a", score: 0.92, explanation: "best" },
          { id: "b", score: 0.45, explanation: "ok" },
          { id: "c", score: 0.10, explanation: "worst" },
        ],
      },
    });
    const r = await judgeTrajectories(
      {
        scenario,
        trajectories: [
          makeTraj("a", "good response"),
          makeTraj("b", "ok response"),
          makeTraj("c", "bad response"),
        ],
      },
      { client },
    );
    expect(r.fallback).toBeUndefined();
    expect(r.scored[0]?.id).toBe("a");
    expect(r.scored[0]?.rank).toBe(1);
    expect(r.scored[2]?.id).toBe("c");
    expect(r.scored[2]?.rank).toBe(3);
  });

  it("clamps scores into [0, 1]", async () => {
    const client = buildMockJudgeClient({
      responses: {
        "test-scenario": [
          { id: "high", score: 5.0 },
          { id: "neg", score: -0.5 },
          { id: "ok", score: 0.5 },
        ],
      },
    });
    const r = await judgeTrajectories(
      {
        scenario,
        trajectories: [makeTraj("high", "x"), makeTraj("neg", "y"), makeTraj("ok", "z")],
      },
      { client },
    );
    const high = r.scored.find((s) => s.id === "high")!;
    const neg = r.scored.find((s) => s.id === "neg")!;
    expect(high.score).toBe(1);
    expect(neg.score).toBe(0);
  });

  it("falls back to 0.5 across the board when judge throws", async () => {
    const client = buildMockJudgeClient({
      responses: { "test-scenario": [] },
      throwOnCall: true,
    });
    const r = await judgeTrajectories(
      {
        scenario,
        trajectories: [makeTraj("a", "x"), makeTraj("b", "y")],
      },
      { client },
    );
    expect(r.fallback).toBeDefined();
    expect(r.scored.every((s) => s.score === 0.5)).toBe(true);
  });

  it("assigns 0.5 to trajectories the judge ignored", async () => {
    const client = buildMockJudgeClient({
      responses: {
        "test-scenario": [{ id: "a", score: 0.9 }],
        // 'b' is omitted by the judge
      },
    });
    const r = await judgeTrajectories(
      {
        scenario,
        trajectories: [makeTraj("a", "x"), makeTraj("b", "y")],
      },
      { client },
    );
    const b = r.scored.find((s) => s.id === "b")!;
    expect(b.score).toBe(0.5);
    expect(b.explanation).toContain("no score");
  });
});

describe("runEvalSuite", () => {
  const scenarios: ReadonlyArray<EvalScenario> = ALL_SCENARIOS;

  function buildVariant(label: string, scoreBias: number): RunVariantInput {
    const map = new Map<string, EvalTrajectory>();
    for (const s of scenarios) {
      map.set(s.id, makeTraj(label, `response from ${label} for ${s.id} (bias=${scoreBias})`));
    }
    return { variantLabel: label, trajectoriesByScenario: map };
  }

  it("requires at least 2 variants", async () => {
    const single = buildVariant("solo", 0);
    let caught: unknown;
    try {
      await runEvalSuite({ scenarios, variants: [single] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it("scores every scenario for every variant", async () => {
    const client = buildMockJudgeClient({
      responses: {
        "plan-card-btc": [
          { id: "good", score: 0.9 },
          { id: "bad", score: 0.2 },
        ],
        "regime-flip": [
          { id: "good", score: 0.85 },
          { id: "bad", score: 0.3 },
        ],
        "risk-gate": [
          { id: "good", score: 0.95 },
          { id: "bad", score: 0.15 },
        ],
      },
    });
    const result = await runEvalSuite({
      scenarios,
      variants: [buildVariant("good", 1), buildVariant("bad", 0)],
      judgeOptions: { client },
    });
    expect(result.results.length).toBe(2);
    const good = result.results.find((r) => r.variantLabel === "good")!;
    const bad = result.results.find((r) => r.variantLabel === "bad")!;
    expect(good.aggregate).toBeGreaterThan(bad.aggregate);
    expect(good.winCount).toBe(3);
    expect(bad.winCount).toBe(0);
    expect(good.scenarioCount).toBe(3);
  });

  it("skips scenarios where any variant is missing a trajectory", async () => {
    const partial = buildVariant("partial", 0);
    (partial.trajectoriesByScenario as Map<string, EvalTrajectory>).delete("regime-flip");
    const client = buildMockJudgeClient({
      responses: {
        "plan-card-btc": [
          { id: "partial", score: 0.5 },
          { id: "full", score: 0.6 },
        ],
        "risk-gate": [
          { id: "partial", score: 0.5 },
          { id: "full", score: 0.6 },
        ],
      },
    });
    const result = await runEvalSuite({
      scenarios,
      variants: [partial, buildVariant("full", 0)],
      judgeOptions: { client },
    });
    expect(result.skippedScenarios.length).toBe(1);
    expect(result.skippedScenarios[0]?.scenarioId).toBe("regime-flip");
  });
});

describe("detectRegressions", () => {
  function makeResult(label: string, perScenario: Array<{ id: string; score: number }>): VariantRunResult {
    const aggregate =
      perScenario.reduce((s, p) => s + p.score, 0) / Math.max(1, perScenario.length);
    return {
      variantLabel: label,
      judgeModel: "test",
      ranAt: "2026-04-26T00:00:00Z",
      perScenario: perScenario.map((p) => ({
        scenarioId: p.id,
        score: p.score,
        rank: 1,
        explanation: "test",
      })),
      aggregate,
      winCount: perScenario.length,
      scenarioCount: perScenario.length,
    };
  }

  it("flags scenarios where candidate drops below tolerance", () => {
    const baseline = makeResult("baseline", [
      { id: "a", score: 0.9 },
      { id: "b", score: 0.8 },
      { id: "c", score: 0.7 },
    ]);
    const candidate = makeResult("candidate", [
      { id: "a", score: 0.92 }, // +0.02 — within tolerance
      { id: "b", score: 0.6 },  // -0.20 — regression
      { id: "c", score: 0.72 }, // +0.02 — within tolerance
    ]);
    const report = detectRegressions(baseline, candidate, { toleranceDelta: 0.05 });
    expect(report.hasBlockingRegression).toBe(true);
    expect(report.regressions.length).toBe(1);
    expect(report.regressions[0]?.scenarioId).toBe("b");
    expect(report.regressions[0]?.delta).toBeCloseTo(-0.2, 5);
  });

  it("flags improvements above tolerance separately", () => {
    const baseline = makeResult("baseline", [
      { id: "a", score: 0.5 },
      { id: "b", score: 0.5 },
    ]);
    const candidate = makeResult("candidate", [
      { id: "a", score: 0.8 }, // +0.3
      { id: "b", score: 0.51 }, // within tolerance
    ]);
    const report = detectRegressions(baseline, candidate);
    expect(report.hasBlockingRegression).toBe(false);
    expect(report.improvements.length).toBe(1);
    expect(report.improvements[0]?.scenarioId).toBe("a");
  });

  it("uses default tolerance of 0.05", () => {
    const baseline = makeResult("baseline", [{ id: "a", score: 0.5 }]);
    const candidate = makeResult("candidate", [{ id: "a", score: 0.46 }]); // -0.04, within
    const report = detectRegressions(baseline, candidate);
    expect(report.regressions.length).toBe(0);
    expect(report.hasBlockingRegression).toBe(false);
  });

  it("reports aggregate delta", () => {
    const baseline = makeResult("a", [
      { id: "x", score: 0.5 },
      { id: "y", score: 0.5 },
    ]);
    const candidate = makeResult("b", [
      { id: "x", score: 0.7 },
      { id: "y", score: 0.7 },
    ]);
    const report = detectRegressions(baseline, candidate);
    expect(report.aggregateDelta).toBeCloseTo(0.2, 5);
  });

  it("skips scenarios missing from either run", () => {
    const baseline = makeResult("a", [{ id: "x", score: 0.5 }]);
    const candidate = makeResult("b", [{ id: "y", score: 0.5 }]);
    const report = detectRegressions(baseline, candidate);
    expect(report.regressions.length).toBe(0);
    expect(report.improvements.length).toBe(0);
  });

  it("formatRegressionReport produces a multi-line summary", () => {
    const baseline = makeResult("baseline", [{ id: "a", score: 0.8 }]);
    const candidate = makeResult("candidate", [{ id: "a", score: 0.5 }]);
    const report = detectRegressions(baseline, candidate);
    const formatted = formatRegressionReport(report);
    expect(formatted).toContain("FAIL");
    expect(formatted).toContain("regression");
    expect(formatted).toContain("a");
  });

  it("formatRegressionReport prints PASS when no regression", () => {
    const baseline = makeResult("baseline", [{ id: "a", score: 0.5 }]);
    const candidate = makeResult("candidate", [{ id: "a", score: 0.52 }]);
    const report = detectRegressions(baseline, candidate);
    const formatted = formatRegressionReport(report);
    expect(formatted).toContain("PASS");
  });
});
