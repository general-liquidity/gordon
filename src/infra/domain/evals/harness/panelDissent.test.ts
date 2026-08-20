import { describe, it, expect } from "bun:test";
import {
  computePanelDissent,
  detectDissentConvergence,
  type PanelDissentReport,
} from "./panelDissent.ts";
import { judgeTrajectoriesPanel } from "./panelJudge.ts";
import { buildMockJudgeClient } from "./trajectoryJudge.ts";
import type { EvalScenario, EvalTrajectory, PanelJudgeEntry } from "./types.ts";

function traj(id: string): EvalTrajectory {
  return { id, messages: [{ role: "assistant", content: id }] };
}

/** One judge's verdicts: [trajectoryId, score, explanation?] triples. */
function judge(
  judgeModel: string,
  scores: ReadonlyArray<[string, number, string?]>,
): PanelJudgeEntry {
  return {
    judgeModel,
    durationMs: 1,
    scored: scores.map(([id, score, explanation], i) => ({
      id,
      score,
      explanation: explanation ?? `${judgeModel} on ${id}`,
      rank: i + 1,
    })),
  };
}

const SCENARIO: EvalScenario = {
  id: "dissent-test",
  tags: [],
  systemPrompt: "be helpful",
  userInput: "hello",
};

describe("computePanelDissent", () => {
  it("gives the same mean for a unanimous and a split panel but a different verdict", () => {
    const unanimous = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.9]]),
        judge("openai/j", [["a", 0.9]]),
        judge("google/j", [["a", 0.9]]),
      ],
      [traj("a")],
    );
    const disputed = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.2]]),
        judge("openai/j", [["a", 0.9]]),
        judge("google/j", [["a", 1.6]]),
      ],
      [traj("a")],
    );

    const u = unanimous.perTrajectory[0]!;
    const d = disputed.perTrajectory[0]!;
    expect(u.meanScore).toBe(0.9);
    expect(d.meanScore).toBe(0.9);

    expect(u.pattern).toBe("consensus");
    expect(unanimous.verdict).toBe("safe_to_gate");
    expect(d.pattern).not.toBe("consensus");
    expect(disputed.verdict).toBe("unsafe_to_gate");
    expect(d.spread).toBeGreaterThan(u.spread);
  });

  it("separates agreement on ordering from agreement on level", () => {
    // Same ordering (a > b > c), judges offset by a constant.
    const levelOnly = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.9], ["b", 0.6], ["c", 0.3]]),
        judge("openai/j", [["a", 0.6], ["b", 0.3], ["c", 0.05]]),
        judge("google/j", [["a", 0.45], ["b", 0.2], ["c", 0.02]]),
      ],
      [traj("a"), traj("b"), traj("c")],
    );
    expect(levelOnly.rankAgreement).toBe(1);
    expect(levelOnly.agreementMode).toBe("level_disagreement");

    // Similar levels, contradictory orderings.
    const rankOnly = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.9], ["b", 0.6], ["c", 0.3]]),
        judge("openai/j", [["a", 0.3], ["b", 0.6], ["c", 0.9]]),
        judge("google/j", [["a", 0.6], ["b", 0.9], ["c", 0.3]]),
      ],
      [traj("a"), traj("b"), traj("c")],
    );
    expect(rankOnly.rankAgreement).toBeLessThan(0.5);
    expect(rankOnly.agreementMode).toBe("rank_disagreement");
  });

  it("distinguishes a two-cluster panel from an evenly spread one at equal spread", () => {
    const polarised = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.2]]),
        judge("openai/j", [["a", 0.25]]),
        judge("google/j", [["a", 0.9]]),
      ],
      [traj("a")],
    );
    const dispersed = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.2]]),
        judge("openai/j", [["a", 0.55]]),
        judge("google/j", [["a", 0.9]]),
      ],
      [traj("a")],
    );

    const p = polarised.perTrajectory[0]!;
    const q = dispersed.perTrajectory[0]!;
    expect(p.spread).toBe(q.spread);
    expect(p.pattern).toBe("polarised");
    expect(q.pattern).toBe("dispersed");
    expect(p.polarisation).toBeGreaterThan(q.polarisation);
  });

  it("names the out-of-step judge and which way it leans", () => {
    const low = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.85]]),
        judge("openai/j", [["a", 0.8]]),
        judge("google/j", [["a", 0.1]]),
      ],
      [traj("a")],
    );
    expect(low.perTrajectory[0]!.dissenter).toEqual({
      judgeModel: "google/j",
      score: 0.1,
      direction: "below",
      deviation: 0.7,
    });

    const high = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.1]]),
        judge("openai/j", [["a", 0.15]]),
        judge("google/j", [["a", 0.9]]),
      ],
      [traj("a")],
    );
    expect(high.perTrajectory[0]!.dissenter?.judgeModel).toBe("google/j");
    expect(high.perTrajectory[0]!.dissenter?.direction).toBe("above");
  });

  it("keeps the losing position readable instead of discarding it", () => {
    const report = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.85, "sizing is within budget"]]),
        judge("openai/j", [["a", 0.8, "acceptable plan"]]),
        judge("google/j", [["a", 0.1, "breaches the position limit"]]),
      ],
      [traj("a")],
    );
    const d = report.perTrajectory[0]!;
    expect(d.minorityView.map((m) => m.judgeModel)).toEqual(["google/j"]);
    expect(d.minorityView[0]!.explanation).toBe("breaches the position limit");
    expect(d.majorityView.map((m) => m.judgeModel).sort()).toEqual(["anthropic/j", "openai/j"]);
  });

  it("reports a lone surviving judge as unverifiable rather than perfect agreement", () => {
    const report = computePanelDissent(
      "s",
      [
        judge("anthropic/j", [["a", 0.9]]),
        { judgeModel: "openai/j", scored: [], durationMs: 0, failed: { reason: "boom" } },
        { judgeModel: "google/j", scored: [], durationMs: 0, failed: { reason: "boom" } },
      ],
      [traj("a")],
    );
    expect(report.judgeCount).toBe(1);
    expect(report.verdict).toBe("unverifiable");
    expect(report.safeToGate).toBe(false);
    expect(report.agreementMode).toBe("unverifiable");
    expect(report.perTrajectory[0]!.pattern).toBe("unverifiable");
    expect(report.reasons.join(" ")).toContain("anthropic/j");
  });

  it("reports an empty panel as unverifiable", () => {
    const report = computePanelDissent("s", [], []);
    expect(report.judgeCount).toBe(0);
    expect(report.verdict).toBe("unverifiable");
    expect(report.safeToGate).toBe(false);
  });

  it("does not call two judges far apart a consensus just because the mean sits between them", () => {
    const report = computePanelDissent(
      "s",
      [judge("anthropic/j", [["a", 0.1]]), judge("openai/j", [["a", 0.9]])],
      [traj("a")],
    );
    const d = report.perTrajectory[0]!;
    expect(d.meanScore).toBe(0.5);
    expect(d.pattern).toBe("split");
    expect(report.verdict).toBe("unsafe_to_gate");
    expect(report.safeToGate).toBe(false);
  });

  it("produces identical output for identical input on every call", () => {
    const build = () =>
      computePanelDissent(
        "s",
        [
          judge("anthropic/j", [["a", 0.2], ["b", 0.7]]),
          judge("openai/j", [["a", 0.9], ["b", 0.1]]),
          judge("google/j", [["a", 0.55], ["b", 0.4]]),
        ],
        [traj("a"), traj("b")],
      );
    const first = JSON.stringify(build());
    // A clock-dependent or randomised statistic would drift across repeats.
    for (let i = 0; i < 25; i += 1) {
      expect(JSON.stringify(build())).toBe(first);
    }
  });
});

describe("detectDissentConvergence", () => {
  it("flags a panel drifting toward agreement over successive runs", () => {
    const history = [0.6, 0.5, 0.4, 0.2].map(
      (maxSpread) => ({ maxSpread }) as PanelDissentReport,
    );
    const trend = detectDissentConvergence(history);
    expect(trend.n).toBe(4);
    expect(trend.slope).toBeLessThan(0);
    expect(trend.converging).toBe(true);
  });

  it("does not flag a stable panel", () => {
    const history = [0.3, 0.31, 0.29, 0.3].map(
      (maxSpread) => ({ maxSpread }) as PanelDissentReport,
    );
    expect(detectDissentConvergence(history).converging).toBe(false);
  });
});

describe("judgeTrajectoriesPanel dissent field", () => {
  it("leaves the consensus scores untouched while adding the dissent report", async () => {
    const client = buildMockJudgeClient({
      responses: { "dissent-test": [{ id: "a", score: 0.5 }, { id: "b", score: 0.5 }] },
      byModel: {
        "anthropic/test": {
          "dissent-test": [{ id: "a", score: 0.9 }, { id: "b", score: 0.2 }],
        },
        "openai/test": {
          "dissent-test": [{ id: "a", score: 0.8 }, { id: "b", score: 0.3 }],
        },
        "google/test": {
          "dissent-test": [{ id: "a", score: 0.7 }, { id: "b", score: 0.4 }],
        },
      },
    });
    const result = await judgeTrajectoriesPanel(
      { scenario: SCENARIO, trajectories: [traj("a"), traj("b")] },
      { client, panel: ["anthropic/test", "openai/test", "google/test"] },
    );

    // Pinned to the values the pre-dissent averaging produced, so a change to
    // the CI gate's number cannot slip through this module.
    expect(result.consensus.map((c) => ({ id: c.id, score: c.score, rank: c.rank }))).toEqual([
      { id: "a", score: 0.8, rank: 1 },
      { id: "b", score: 0.3, rank: 2 },
    ]);
    expect(result.dissent.judgeCount).toBe(3);
    expect(result.dissent.rankAgreement).toBe(1);
    expect(result.dissent.perTrajectory.map((d) => d.trajectoryId)).toEqual(["a", "b"]);
    for (const d of result.dissent.perTrajectory) {
      expect(d.meanScore).toBe(result.consensus.find((c) => c.id === d.trajectoryId)!.score);
    }
  });

  it("reports a dropped-judge panel with the survivors it actually had", async () => {
    const client = buildMockJudgeClient({
      responses: { "dissent-test": [{ id: "a", score: 0.7 }, { id: "b", score: 0.3 }] },
      throwForModel: "openai/test",
    });
    const result = await judgeTrajectoriesPanel(
      { scenario: SCENARIO, trajectories: [traj("a"), traj("b")] },
      { client, panel: ["anthropic/test", "openai/test", "google/test"] },
    );
    expect(result.quorum).toBe(2);
    expect(result.dissent.judgeCount).toBe(2);
    expect(result.dissent.perTrajectory[0]!.perJudge.map((j) => j.judgeModel)).toEqual([
      "anthropic/test",
      "google/test",
    ]);
    expect(result.dissent.verdict).toBe("safe_to_gate");
  });

  it("reports no judges as unverifiable when the whole panel fails", async () => {
    const client = buildMockJudgeClient({ responses: {}, throwOnCall: true });
    const result = await judgeTrajectoriesPanel(
      { scenario: SCENARIO, trajectories: [traj("a"), traj("b")] },
      { client, panel: ["x/1", "x/2", "x/3"] },
    );
    expect(result.quorum).toBe(0);
    expect(result.dissent.verdict).toBe("unverifiable");
  });
});
