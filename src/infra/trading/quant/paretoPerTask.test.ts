import { describe, expect, it } from "bun:test";
import { computeParetoPerTask } from "./paretoFrontier.ts";

describe("computeParetoPerTask (GEPA specialist preservation)", () => {
  it("keeps a regime specialist that aggregate Sharpe would drop", () => {
    // C has the best AVERAGE but wins no single task; A and B are specialists.
    const r = computeParetoPerTask([
      { id: "A", taskScores: { calm: 1.0, trend: 1.0, crash: 0.0 } },
      { id: "B", taskScores: { calm: 0.0, trend: 0.0, crash: 1.0 } },
      { id: "C", taskScores: { calm: 0.5, trend: 0.5, crash: 0.5 } }, // best mean, wins nothing
    ]);
    expect(r.frontier.sort()).toEqual(["A", "B"]);
    expect(r.dropped).toContain("C");
    expect(r.perTaskWinners.crash!).toEqual(["B"]); // the sole crash specialist survives
  });

  it("set-cover dominance: a generalist that wins a strict superset absorbs the specialist", () => {
    const r = computeParetoPerTask([
      { id: "A", taskScores: { t1: 1, t2: 1, t3: 0 } }, // wins {t1,t2}
      { id: "B", taskScores: { t1: 0, t2: 0, t3: 1 } }, // wins {t3}
      { id: "D", taskScores: { t1: 2, t2: 2, t3: 2 } }, // wins {t1,t2,t3} ⊋ both
    ]);
    expect(r.frontier).toEqual(["D"]); // A and B are strict-subset-dominated by D
    expect(r.dropped.sort()).toEqual(["A", "B"]);
  });

  it("ties on a task keep both winners", () => {
    const r = computeParetoPerTask([
      { id: "A", taskScores: { t1: 1, t2: 0 } },
      { id: "B", taskScores: { t1: 1, t2: 1 } },
    ]);
    expect(r.perTaskWinners.t1!.sort()).toEqual(["A", "B"]);
    // A wins {t1}, B wins {t1,t2} ⊋ {t1} → A dropped, B kept
    expect(r.frontier).toEqual(["B"]);
  });

  it("respects minimize direction", () => {
    const r = computeParetoPerTask(
      [
        { id: "lowDD", taskScores: { drawdown: 0.05 } },
        { id: "highDD", taskScores: { drawdown: 0.30 } },
      ],
      { direction: "minimize" },
    );
    expect(r.perTaskWinners.drawdown!).toEqual(["lowDD"]);
    expect(r.frontier).toEqual(["lowDD"]);
  });

  it("each task has a winner on the frontier (coverage)", () => {
    const r = computeParetoPerTask([
      { id: "A", taskScores: { t1: 1, t2: 0.2 } },
      { id: "B", taskScores: { t1: 0.2, t2: 1 } },
    ]);
    const covered = new Set(Object.values(r.wonTasks).flat());
    expect(covered.has("t1")).toBe(true);
    expect(covered.has("t2")).toBe(true);
  });
});
