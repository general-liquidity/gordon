import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ALL_CATEGORIES,
  ALL_SCENARIOS,
  ALL_SCENARIO_IDS,
  ADVERSARIAL_SCENARIOS,
  appendToReviewQueue,
  buildJudgePrompt,
  buildMockJudgeClient,
  CATEGORY_RUBRICS,
  DEFAULT_PANEL,
  detectRegressions,
  formatRegressionReport,
  generateScenarios,
  getCategoryRubric,
  getScenarioById,
  judgeTrajectories,
  judgeTrajectoriesPanel,
  readReviewQueue,
  runEvalSuite,
  scenariosByTag,
  scenariosByProvenance,
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

// First 4 generated ids (sorted, deterministic) — used to drive the
// runner tests without pinning to any hand-authored scenario.
const SAMPLE_IDS: string[] = ALL_SCENARIO_IDS.slice(0, 4);

describe("scenario catalog (generated)", () => {
  it("is non-empty and produced by the generator", () => {
    expect(ALL_SCENARIOS.length).toBeGreaterThan(0);
    // The catalog is exactly the deterministic generator output.
    expect(ALL_SCENARIO_IDS).toEqual(generateScenarios().map((s) => s.id));
  });

  it("is deterministic across calls", () => {
    const a = generateScenarios();
    const b = generateScenarios();
    expect(a.map((s) => s.id)).toEqual(b.map((s) => s.id));
    expect(a.map((s) => s.userInput)).toEqual(b.map((s) => s.userInput));
  });

  it("has unique ids", () => {
    expect(new Set(ALL_SCENARIO_IDS).size).toBe(ALL_SCENARIO_IDS.length);
  });

  it("every scenario has the required fields + provenance + category", () => {
    for (const s of ALL_SCENARIOS) {
      expect(typeof s.id).toBe("string");
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.tags.length).toBeGreaterThan(0);
      expect(s.systemPrompt.length).toBeGreaterThan(50);
      expect(s.userInput.length).toBeGreaterThan(10);
      // Every generated scenario is traceable to a spec...
      expect(typeof s.derivedFrom).toBe("string");
      expect(s.derivedFrom!.length).toBeGreaterThan(0);
      // ...and declares a category (drives the category rubric).
      expect(s.category).toBeDefined();
      expect(ALL_CATEGORIES).toContain(s.category!);
    }
  });

  it("covers all four spec sources via provenance", () => {
    expect(scenariosByProvenance("constitution:").length).toBeGreaterThan(0);
    expect(scenariosByProvenance("riskClassifier:").length).toBeGreaterThan(0);
    expect(scenariosByProvenance("denylist:").length).toBeGreaterThan(0);
    expect(scenariosByProvenance("categoryRubric:").length).toBe(ALL_CATEGORIES.length);
  });

  it("ships an adversarial subset for security gating", () => {
    expect(ADVERSARIAL_SCENARIOS.length).toBeGreaterThan(0);
    expect(ADVERSARIAL_SCENARIOS.every((s) => s.tags.includes("adversarial"))).toBe(true);
  });

  it("source filtering narrows the suite", () => {
    const onlyConstitution = generateScenarios({ sources: ["constitution"] });
    expect(onlyConstitution.length).toBeGreaterThan(0);
    expect(onlyConstitution.every((s) => s.derivedFrom!.startsWith("constitution:"))).toBe(true);
    expect(onlyConstitution.length).toBeLessThan(ALL_SCENARIOS.length);
  });

  it("scenariosByTag filters correctly", () => {
    expect(scenariosByTag("constitution").length).toBeGreaterThan(0);
    expect(scenariosByTag("nonexistent-tag")).toEqual([]);
  });

  it("getScenarioById resolves a known generated scenario", () => {
    const first = ALL_SCENARIOS[0]!;
    expect(getScenarioById(first.id)).toBe(first);
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
  function buildVariant(label: string, ids: ReadonlyArray<string>): RunVariantInput {
    const map = new Map<string, EvalTrajectory>();
    for (const id of ids) {
      map.set(id, makeTraj(label, `response from ${label} for ${id}`));
    }
    return { variantLabel: label, trajectoriesByScenario: map };
  }

  it("requires at least 2 variants", async () => {
    const single = buildVariant("solo", SAMPLE_IDS);
    let caught: unknown;
    try {
      await runEvalSuite({ scenarios: ALL_SCENARIOS, variants: [single] });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Error);
  });

  it("scores every scenario for every variant", async () => {
    // Pin to the first 4 generated scenarios so the mock can enumerate
    // explicit per-scenario responses. The runner shape is the subject;
    // the full catalog is asserted separately above.
    const pinned = ALL_SCENARIOS.filter((s) => SAMPLE_IDS.includes(s.id));
    const responses: Record<string, Array<{ id: string; score: number }>> = {};
    SAMPLE_IDS.forEach((id, i) => {
      responses[id] = [
        { id: "good", score: 0.9 - i * 0.01 },
        { id: "bad", score: 0.2 + i * 0.01 },
      ];
    });
    const client = buildMockJudgeClient({ responses });
    const result = await runEvalSuite({
      scenarios: pinned,
      variants: [buildVariant("good", SAMPLE_IDS), buildVariant("bad", SAMPLE_IDS)],
      judgeOptions: { client },
    });
    expect(result.results.length).toBe(2);
    const good = result.results.find((r) => r.variantLabel === "good")!;
    const bad = result.results.find((r) => r.variantLabel === "bad")!;
    expect(good.aggregate).toBeGreaterThan(bad.aggregate);
    expect(good.winCount).toBe(SAMPLE_IDS.length);
    expect(bad.winCount).toBe(0);
    expect(good.scenarioCount).toBe(SAMPLE_IDS.length);
  });

  it("derives genericAdviceRate from the judge's genericNonActionable flags", async () => {
    const pinned = ALL_SCENARIOS.filter((s) => SAMPLE_IDS.includes(s.id));
    const responses: Record<
      string,
      Array<{ id: string; score: number; genericNonActionable?: boolean }>
    > = {};
    // "vague" variant is flagged generic on every scenario; "sharp" never is.
    SAMPLE_IDS.forEach((id) => {
      responses[id] = [
        { id: "sharp", score: 0.8, genericNonActionable: false },
        { id: "vague", score: 0.6, genericNonActionable: true },
      ];
    });
    const client = buildMockJudgeClient({ responses });
    const result = await runEvalSuite({
      scenarios: pinned,
      variants: [buildVariant("sharp", SAMPLE_IDS), buildVariant("vague", SAMPLE_IDS)],
      judgeOptions: { client },
    });
    const sharp = result.results.find((r) => r.variantLabel === "sharp")!;
    const vague = result.results.find((r) => r.variantLabel === "vague")!;
    expect(sharp.genericAdviceRate).toBe(0);
    expect(vague.genericAdviceRate).toBe(1);
    // Independent gate: vague scores LOWER on aggregate yet the gate is
    // what makes the regression blocking when comparing sharp → vague.
    const report = detectRegressions(sharp, vague);
    expect(report.genericAdviceRegression).toBeDefined();
    expect(report.hasBlockingRegression).toBe(true);
  });

  it("skips scenarios where any variant is missing a trajectory", async () => {
    const missingId = SAMPLE_IDS[1]!;
    const presentIds = SAMPLE_IDS.filter((id) => id !== missingId);
    const partial = buildVariant("partial", presentIds); // missing one
    const full = buildVariant("full", SAMPLE_IDS);
    const responses: Record<string, Array<{ id: string; score: number }>> = {};
    for (const id of presentIds) {
      responses[id] = [
        { id: "partial", score: 0.5 },
        { id: "full", score: 0.6 },
      ];
    }
    const client = buildMockJudgeClient({ responses });
    const result = await runEvalSuite({
      scenarios: ALL_SCENARIOS.filter((s) => SAMPLE_IDS.includes(s.id)),
      variants: [partial, full],
      judgeOptions: { client },
    });
    expect(result.skippedScenarios.length).toBe(1);
    expect(result.skippedScenarios[0]?.scenarioId).toBe(missingId);
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

describe("detectRegressions — generic-advice anti-metric gate", () => {
  function makeRateResult(
    label: string,
    perScenario: Array<{ id: string; score: number; flag?: boolean }>,
    genericAdviceRate?: number,
  ): VariantRunResult {
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
        genericNonActionable: p.flag,
      })),
      aggregate,
      winCount: perScenario.length,
      scenarioCount: perScenario.length,
      genericAdviceRate,
    };
  }

  it("blocks when generic-advice rate rises past tolerance EVEN as aggregate improves", () => {
    // Candidate scores HIGHER on every scenario (aggregate up), but its
    // generic-advice rate doubled from 0.10 → 0.40 (delta 0.30 ≥ 0.10).
    const baseline = makeRateResult(
      "baseline",
      [
        { id: "a", score: 0.6 },
        { id: "b", score: 0.6 },
      ],
      0.1,
    );
    const candidate = makeRateResult(
      "candidate",
      [
        { id: "a", score: 0.8 },
        { id: "b", score: 0.8 },
      ],
      0.4,
    );
    const report = detectRegressions(baseline, candidate);
    expect(report.aggregateDelta).toBeGreaterThan(0); // aggregate improved
    expect(report.regressions.length).toBe(0); // no scalar regression
    expect(report.hasBlockingRegression).toBe(true); // but blocked anyway
    expect(report.genericAdviceRegression).toBeDefined();
    expect(report.genericAdviceRegression?.delta).toBeCloseTo(0.3, 5);
    const formatted = formatRegressionReport(report);
    expect(formatted).toContain("FAIL");
    expect(formatted).toContain("generic-advice gate");
  });

  it("does NOT block when generic-advice rate rises within tolerance", () => {
    const baseline = makeRateResult("baseline", [{ id: "a", score: 0.6 }], 0.1);
    const candidate = makeRateResult("candidate", [{ id: "a", score: 0.65 }], 0.15);
    const report = detectRegressions(baseline, candidate); // default tolerance 0.10
    expect(report.genericAdviceRegression).toBeUndefined();
    expect(report.hasBlockingRegression).toBe(false);
  });

  it("treats a missing genericAdviceRate as 0 (backward compatible)", () => {
    const baseline = makeRateResult("baseline", [{ id: "a", score: 0.6 }]); // rate undefined
    const candidate = makeRateResult("candidate", [{ id: "a", score: 0.6 }]); // rate undefined
    const report = detectRegressions(baseline, candidate);
    expect(report.genericAdviceRegression).toBeUndefined();
    expect(report.hasBlockingRegression).toBe(false);
  });

  it("blocks when baseline has no rate but candidate introduces generic advice past tolerance", () => {
    const baseline = makeRateResult("baseline", [{ id: "a", score: 0.6 }]); // undefined → 0
    const candidate = makeRateResult("candidate", [{ id: "a", score: 0.6 }], 0.5);
    const report = detectRegressions(baseline, candidate);
    expect(report.hasBlockingRegression).toBe(true);
    expect(report.genericAdviceRegression?.baselineRate).toBe(0);
    expect(report.genericAdviceRegression?.candidateRate).toBe(0.5);
  });

  it("honors a custom genericAdviceRateTolerance", () => {
    const baseline = makeRateResult("baseline", [{ id: "a", score: 0.6 }], 0.1);
    const candidate = makeRateResult("candidate", [{ id: "a", score: 0.6 }], 0.25);
    // delta 0.15: blocks at default 0.10, passes at custom 0.20.
    expect(detectRegressions(baseline, candidate).hasBlockingRegression).toBe(true);
    expect(
      detectRegressions(baseline, candidate, { genericAdviceRateTolerance: 0.2 })
        .hasBlockingRegression,
    ).toBe(false);
  });
});

describe("category rubrics", () => {
  it("ships the 6 trading categories", () => {
    expect(ALL_CATEGORIES.length).toBe(6);
    expect(ALL_CATEGORIES).toContain("planning");
    expect(ALL_CATEGORIES).toContain("analysis");
    expect(ALL_CATEGORIES).toContain("recovery");
  });

  it("every category has a non-empty rubric", () => {
    for (const c of ALL_CATEGORIES) {
      const rubric = CATEGORY_RUBRICS[c];
      expect(rubric.length).toBeGreaterThan(50);
      expect(rubric).toContain("Red flags");
      expect(rubric).toContain("Good signals");
    }
  });

  it("getCategoryRubric resolves known categories and returns undefined for unset", () => {
    expect(getCategoryRubric("planning")).toBe(CATEGORY_RUBRICS.planning);
    expect(getCategoryRubric(undefined)).toBeUndefined();
  });

  it("every generated scenario declares a category", () => {
    for (const s of ALL_SCENARIOS) {
      expect(s.category).toBeDefined();
      expect(ALL_CATEGORIES).toContain(s.category!);
    }
  });

  it("buildJudgePrompt injects the category rubric when category is set", () => {
    const scenario: EvalScenario = {
      id: "cat-test",
      tags: [],
      category: "planning",
      systemPrompt: "agent prompt body",
      userInput: "user wants a plan",
    };
    const trajectories: EvalTrajectory[] = [
      { id: "a", messages: [{ role: "assistant", content: "x" }] },
      { id: "b", messages: [{ role: "assistant", content: "y" }] },
    ];
    const prompt = buildJudgePrompt(scenario, trajectories);
    expect(prompt).toContain("Category rubric — planning");
    expect(prompt).toContain("**Planning rubric**");
  });

  it("buildJudgePrompt omits category rubric when category is unset", () => {
    const scenario: EvalScenario = {
      id: "no-cat",
      tags: [],
      systemPrompt: "agent prompt",
      userInput: "user input",
    };
    const trajectories: EvalTrajectory[] = [
      { id: "a", messages: [{ role: "assistant", content: "x" }] },
      { id: "b", messages: [{ role: "assistant", content: "y" }] },
    ];
    const prompt = buildJudgePrompt(scenario, trajectories);
    expect(prompt).not.toContain("Category rubric");
  });

  it("buildJudgePrompt embeds the outcome-over-trajectory framing", () => {
    const scenario: EvalScenario = {
      id: "framing",
      tags: [],
      systemPrompt: "x",
      userInput: "y",
    };
    const trajectories: EvalTrajectory[] = [
      { id: "a", messages: [{ role: "assistant", content: "x" }] },
      { id: "b", messages: [{ role: "assistant", content: "y" }] },
    ];
    const prompt = buildJudgePrompt(scenario, trajectories);
    expect(prompt).toContain("OUTPUT QUALITY, not path efficiency");
  });

  it("buildJudgePrompt adds the multi-turn elicitation rubric when turns are set", () => {
    const scenario: EvalScenario = {
      id: "multi-turn",
      tags: [],
      systemPrompt: "agent prompt",
      userInput: "clean up my crypto exposure",
      turns: [
        { user: "clean up my crypto exposure", expectedElicitation: "which venue" },
        { user: "on Coinbase", expectedElicitation: "keep BTC?" },
      ],
    };
    const trajectories: EvalTrajectory[] = [
      { id: "a", messages: [{ role: "assistant", content: "x" }] },
      { id: "b", messages: [{ role: "assistant", content: "y" }] },
    ];
    const prompt = buildJudgePrompt(scenario, trajectories);
    expect(prompt).toContain("Multi-turn elicitation");
    expect(prompt).toContain("ELICITED the missing constraint");
    expect(prompt).toContain("which venue");
    expect(prompt).toContain("Turn 1:");
    expect(prompt).toContain("Turn 2:");
  });

  it("buildJudgePrompt omits the multi-turn rubric when turns are absent", () => {
    const scenario: EvalScenario = {
      id: "single-turn",
      tags: [],
      systemPrompt: "agent prompt",
      userInput: "single request",
    };
    const trajectories: EvalTrajectory[] = [
      { id: "a", messages: [{ role: "assistant", content: "x" }] },
      { id: "b", messages: [{ role: "assistant", content: "y" }] },
    ];
    const prompt = buildJudgePrompt(scenario, trajectories);
    expect(prompt).not.toContain("Multi-turn elicitation");
  });
});

describe("judgeTrajectoriesPanel", () => {
  const scenario: EvalScenario = {
    id: "panel-test",
    tags: [],
    systemPrompt: "be helpful",
    userInput: "hello",
  };

  function makeTraj(id: string, content: string): EvalTrajectory {
    return {
      id,
      messages: [{ role: "assistant", content }],
    };
  }

  it("ships a 3-judge default panel from 3 families", () => {
    expect(DEFAULT_PANEL.length).toBe(3);
    expect(DEFAULT_PANEL.some((m) => m.startsWith("anthropic/"))).toBe(true);
    expect(DEFAULT_PANEL.some((m) => m.startsWith("openai/"))).toBe(true);
    expect(DEFAULT_PANEL.some((m) => m.startsWith("google/"))).toBe(true);
  });

  it("averages scores across surviving judges", async () => {
    const client = buildMockJudgeClient({
      responses: {
        "panel-test": [
          { id: "a", score: 0.6 },
          { id: "b", score: 0.4 },
        ],
      },
    });
    const result = await judgeTrajectoriesPanel(
      {
        scenario,
        trajectories: [makeTraj("a", "x"), makeTraj("b", "y")],
      },
      { client, panel: ["anthropic/test", "openai/test", "google/test"] },
    );
    expect(result.quorum).toBe(3);
    expect(result.panel.length).toBe(3);
    expect(result.consensus.length).toBe(2);
    const aRow = result.consensus.find((c) => c.id === "a")!;
    expect(aRow.score).toBeCloseTo(0.6, 3);
    expect(aRow.rank).toBe(1);
  });

  it("differentiates scores per model via byModel and averages", async () => {
    const client = buildMockJudgeClient({
      responses: {
        "panel-test": [{ id: "a", score: 0.5 }, { id: "b", score: 0.5 }],
      },
      byModel: {
        "anthropic/test": {
          "panel-test": [{ id: "a", score: 0.9 }, { id: "b", score: 0.2 }],
        },
        "openai/test": {
          "panel-test": [{ id: "a", score: 0.8 }, { id: "b", score: 0.3 }],
        },
        "google/test": {
          "panel-test": [{ id: "a", score: 0.7 }, { id: "b", score: 0.4 }],
        },
      },
    });
    const result = await judgeTrajectoriesPanel(
      {
        scenario,
        trajectories: [makeTraj("a", "x"), makeTraj("b", "y")],
      },
      { client, panel: ["anthropic/test", "openai/test", "google/test"] },
    );
    expect(result.quorum).toBe(3);
    const aRow = result.consensus.find((c) => c.id === "a")!;
    const bRow = result.consensus.find((c) => c.id === "b")!;
    expect(aRow.score).toBeCloseTo((0.9 + 0.8 + 0.7) / 3, 3);
    expect(bRow.score).toBeCloseTo((0.2 + 0.3 + 0.4) / 3, 3);
    expect(aRow.rank).toBe(1);
    expect(bRow.rank).toBe(2);
    expect(aRow.explanation).toContain("anthropic/test");
    expect(aRow.explanation).toContain("openai/test");
  });

  it("drops a failing judge and proceeds with quorum-1", async () => {
    const client = buildMockJudgeClient({
      responses: {
        "panel-test": [{ id: "a", score: 0.7 }, { id: "b", score: 0.3 }],
      },
      throwForModel: "openai/test",
    });
    const result = await judgeTrajectoriesPanel(
      {
        scenario,
        trajectories: [makeTraj("a", "x"), makeTraj("b", "y")],
      },
      { client, panel: ["anthropic/test", "openai/test", "google/test"] },
    );
    expect(result.quorum).toBe(2);
    expect(result.panel.length).toBe(3);
    const failedEntry = result.panel.find((p) => p.judgeModel === "openai/test")!;
    expect(failedEntry.failed).toBeDefined();
    const aRow = result.consensus.find((c) => c.id === "a")!;
    expect(aRow.score).toBeCloseTo(0.7, 3);
  });

  it("returns fallback consensus when every judge fails", async () => {
    const client = buildMockJudgeClient({
      responses: {},
      throwOnCall: true,
    });
    const result = await judgeTrajectoriesPanel(
      {
        scenario,
        trajectories: [makeTraj("a", "x"), makeTraj("b", "y")],
      },
      { client, panel: ["x/1", "x/2", "x/3"] },
    );
    expect(result.quorum).toBe(0);
    expect(result.consensus.every((c) => c.score === 0.5)).toBe(true);
    expect(result.panel.every((p) => p.failed)).toBe(true);
  });

  it("returns empty result for zero trajectories", async () => {
    const result = await judgeTrajectoriesPanel({
      scenario,
      trajectories: [],
    });
    expect(result.consensus).toEqual([]);
    expect(result.panel).toEqual([]);
  });

  it("runEvalSuite routes through panel when panelOptions is set", async () => {
    const responses: Record<string, Array<{ id: string; score: number }>> = {};
    SAMPLE_IDS.forEach((id) => {
      responses[id] = [
        { id: "good", score: 0.9 },
        { id: "bad", score: 0.2 },
      ];
    });
    const client = buildMockJudgeClient({ responses });
    function buildVariant(label: string): RunVariantInput {
      const map = new Map<string, EvalTrajectory>();
      for (const id of SAMPLE_IDS) {
        map.set(id, {
          id: label,
          messages: [{ role: "assistant", content: `${label} for ${id}` }],
        });
      }
      return { variantLabel: label, trajectoriesByScenario: map };
    }
    const pinned = ALL_SCENARIOS.filter((s) => SAMPLE_IDS.includes(s.id));
    const result = await runEvalSuite({
      scenarios: pinned,
      variants: [buildVariant("good"), buildVariant("bad")],
      panelOptions: { client, panel: ["a/1", "a/2"] },
    });
    expect(result.results.length).toBe(2);
    const good = result.results.find((r) => r.variantLabel === "good")!;
    expect(good.judgeModel.startsWith("panel(")).toBe(true);
    expect(good.aggregate).toBeGreaterThan(0.8);
  });
});

describe("review queue", () => {
  let tmpDir: string | undefined;
  const cleanup: string[] = [];

  afterEach(() => {
    for (const d of cleanup) {
      try {
        rmSync(d, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup.
      }
    }
    cleanup.length = 0;
    tmpDir = undefined;
  });

  function tmpPath(): string {
    tmpDir = mkdtempSync(join(tmpdir(), "gordon-eval-queue-"));
    cleanup.push(tmpDir);
    return join(tmpDir, "queue.jsonl");
  }

  it("appendToReviewQueue creates the file and writes JSONL", () => {
    const path = tmpPath();
    const result = appendToReviewQueue(
      [
        {
          scenarioId: "x",
          baselineLabel: "b",
          candidateLabel: "c",
          baselineScore: 0.8,
          candidateScore: 0.5,
          delta: -0.3,
        },
      ],
      path,
    );
    expect(result.written).toBe(1);
    expect(existsSync(path)).toBe(true);
  });

  it("appendToReviewQueue is idempotent and appends, not overwrites", () => {
    const path = tmpPath();
    appendToReviewQueue(
      [
        {
          scenarioId: "x",
          baselineLabel: "b",
          candidateLabel: "c",
          baselineScore: 0.8,
          candidateScore: 0.5,
          delta: -0.3,
        },
      ],
      path,
    );
    appendToReviewQueue(
      [
        {
          scenarioId: "y",
          baselineLabel: "b",
          candidateLabel: "c",
          baselineScore: 0.7,
          candidateScore: 0.4,
          delta: -0.3,
        },
      ],
      path,
    );
    const back = readReviewQueue(path);
    expect(back.length).toBe(2);
    expect(back[0]?.scenarioId).toBe("y");
    expect(back[1]?.scenarioId).toBe("x");
  });

  it("appendToReviewQueue handles empty input gracefully", () => {
    const path = tmpPath();
    const result = appendToReviewQueue([], path);
    expect(result.written).toBe(0);
    expect(existsSync(path)).toBe(false);
  });

  it("readReviewQueue returns [] when file is missing", () => {
    const back = readReviewQueue(join(tmpdir(), "definitely-not-a-real-eval-queue.jsonl"));
    expect(back).toEqual([]);
  });

  it("detectRegressions writes to the queue when writeReviewQueue is a path", () => {
    const path = tmpPath();
    const baseline: VariantRunResult = {
      variantLabel: "baseline",
      judgeModel: "test",
      ranAt: "2026-05-11T00:00:00Z",
      perScenario: [
        { scenarioId: "x", score: 0.9, rank: 1, explanation: "" },
      ],
      aggregate: 0.9,
      winCount: 1,
      scenarioCount: 1,
    };
    const candidate: VariantRunResult = {
      ...baseline,
      variantLabel: "candidate",
      perScenario: [
        { scenarioId: "x", score: 0.4, rank: 1, explanation: "" },
      ],
      aggregate: 0.4,
    };
    const report = detectRegressions(baseline, candidate, {
      writeReviewQueue: path,
      reviewQueueMetadata: { promptHash: "abc123" },
    });
    expect(report.hasBlockingRegression).toBe(true);
    const back = readReviewQueue(path);
    expect(back.length).toBe(1);
    expect(back[0]?.scenarioId).toBe("x");
    expect(back[0]?.delta).toBeCloseTo(-0.5, 3);
    expect(back[0]?.metadata?.promptHash).toBe("abc123");
  });

  it("detectRegressions does NOT write when there are no regressions", () => {
    const path = tmpPath();
    const baseline: VariantRunResult = {
      variantLabel: "baseline",
      judgeModel: "test",
      ranAt: "2026-05-11T00:00:00Z",
      perScenario: [{ scenarioId: "x", score: 0.5, rank: 1, explanation: "" }],
      aggregate: 0.5,
      winCount: 1,
      scenarioCount: 1,
    };
    const candidate: VariantRunResult = {
      ...baseline,
      variantLabel: "candidate",
      perScenario: [{ scenarioId: "x", score: 0.55, rank: 1, explanation: "" }],
      aggregate: 0.55,
    };
    detectRegressions(baseline, candidate, { writeReviewQueue: path });
    expect(existsSync(path)).toBe(false);
  });
});
