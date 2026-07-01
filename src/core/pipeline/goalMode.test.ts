import { describe, it, expect, beforeEach } from "bun:test";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  isGoalModeEnabled,
  defaultGoalStatePath,
  defaultGoalProgressPath,
  parseGoal,
  scoreGoal,
  createGoalState,
  recordGoalProgress,
  pauseGoal,
  resumeGoal,
  clearGoal,
  failGoal,
  isGoalComplete,
  appendGoalNote,
  persistGoalState,
  loadActiveGoal,
  appendProgressLog,
  formatGoalState,
  goalStateToPayload,
  resetGoalIdCounterForTesting,
  GOAL_MODE_FLAG_ENV,
  GOAL_STATE_PATH_ENV,
  GOAL_PROGRESS_PATH_ENV,
  type GoalObservation,
} from "./goalMode.ts";

let tempDir: string;
let statePath: string;
let progressPath: string;

beforeEach(() => {
  tempDir = mkdtempSync(join(tmpdir(), "gordon-goal-test-"));
  statePath = join(tempDir, "goal-state.json");
  progressPath = join(tempDir, "goal-progress.md");
  resetGoalIdCounterForTesting();
});

describe("isGoalModeEnabled", () => {
  it("respects the flag", () => {
    expect(isGoalModeEnabled({})).toBe(false);
    expect(isGoalModeEnabled({ [GOAL_MODE_FLAG_ENV]: "1" })).toBe(true);
    expect(isGoalModeEnabled({ [GOAL_MODE_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("default paths", () => {
  it("honors env overrides", () => {
    expect(defaultGoalStatePath({ [GOAL_STATE_PATH_ENV]: "/x.json" })).toBe("/x.json");
    expect(defaultGoalProgressPath({ [GOAL_PROGRESS_PATH_ENV]: "/y.md" })).toBe("/y.md");
  });
  it("falls back to home-dir defaults", () => {
    expect(defaultGoalStatePath({})).toContain("goal-state.json");
    expect(defaultGoalProgressPath({})).toContain("goal-progress.md");
  });
});

describe("parseGoal — Sharpe end state", () => {
  it("parses 'until Sharpe >= 1.5'", () => {
    const p = parseGoal("/goal trade ETH until Sharpe >= 1.5 without leverage above 2x");
    expect(p.objective).toBe("trade ETH");
    expect(p.endState?.type).toBe("sharpe");
    expect(p.endState?.threshold).toBe(1.5);
    expect(p.constraints).toEqual(["leverage above 2x"]);
  });

  it("parses 'until Sharpe of at least 2'", () => {
    const p = parseGoal("trade ETH until Sharpe of at least 2");
    expect(p.endState?.type).toBe("sharpe");
    expect(p.endState?.threshold).toBe(2);
  });
});

describe("parseGoal — win rate", () => {
  it("parses 'win rate >= 60%' (percentage normalized to fraction)", () => {
    const p = parseGoal("trade until win rate >= 60%");
    expect(p.endState?.type).toBe("winrate");
    expect(p.endState?.threshold).toBeCloseTo(0.6);
  });

  it("treats '0.55' as fraction not percent", () => {
    const p = parseGoal("trade until win rate >= 0.55");
    expect(p.endState?.threshold).toBeCloseTo(0.55);
  });
});

describe("parseGoal — drawdown", () => {
  it("parses 'max drawdown under 15%'", () => {
    const p = parseGoal("trade until max drawdown under 15%");
    expect(p.endState?.type).toBe("drawdown_under");
    expect(p.endState?.threshold).toBeCloseTo(0.15);
  });
});

describe("parseGoal — trade count", () => {
  it("parses 'complete 10 successful trades'", () => {
    const p = parseGoal("trade until complete 10 successful trades");
    expect(p.endState?.type).toBe("trades");
    expect(p.endState?.threshold).toBe(10);
  });

  it("parses 'run 5 trades'", () => {
    const p = parseGoal("trade until run 5 trades");
    expect(p.endState?.type).toBe("trades");
    expect(p.endState?.threshold).toBe(5);
  });
});

describe("parseGoal — time horizon", () => {
  it("parses 'for 7 days' as 168 hours", () => {
    const p = parseGoal("monitor portfolio until for 7 days");
    expect(p.endState?.type).toBe("time_horizon");
    expect(p.endState?.threshold).toBe(168);
    expect(p.endState?.timeHorizonDays).toBe(7);
  });

  it("parses 'for 4 hours'", () => {
    const p = parseGoal("monitor portfolio until for 4 hours");
    expect(p.endState?.threshold).toBe(4);
  });
});

describe("parseGoal — checklist", () => {
  it("recognizes 'every item in the checklist'", () => {
    const p = parseGoal("do work until every item in the checklist is done");
    expect(p.endState?.type).toBe("checklist");
  });
});

describe("parseGoal — fallback to custom", () => {
  it("returns custom for unrecognized end states", () => {
    const p = parseGoal("trade BTC until the vibes are right");
    expect(p.endState?.type).toBe("custom");
  });
});

describe("parseGoal — constraints", () => {
  it("captures multiple constraints from comma-separated 'without' clauses", () => {
    const p = parseGoal(
      "trade until Sharpe >= 1.5 without leverage above 2x, without shorting, without new instruments",
    );
    expect(p.constraints).toEqual(["leverage above 2x", "shorting", "new instruments"]);
  });

  it("handles repeated 'without' keyword", () => {
    const p = parseGoal("trade until X without A without B");
    expect(p.constraints).toEqual(["A", "B"]);
  });

  it("returns empty constraints when none present", () => {
    const p = parseGoal("trade until Sharpe >= 1.5");
    expect(p.constraints).toEqual([]);
  });
});

describe("parseGoal — missing clauses", () => {
  it("handles objective-only goal", () => {
    const p = parseGoal("trade BTC profitably");
    expect(p.objective).toBe("trade BTC profitably");
    expect(p.endState).toBeNull();
    expect(p.constraints).toEqual([]);
  });

  it("strips leading '/goal '", () => {
    const p = parseGoal("/goal trade BTC");
    expect(p.objective).toBe("trade BTC");
  });

  it("preserves raw text", () => {
    const p = parseGoal("/goal trade BTC");
    expect(p.raw).toBe("/goal trade BTC");
  });
});

describe("scoreGoal — Sharpe", () => {
  it("flags end state met when Sharpe meets threshold", () => {
    const goal = parseGoal("trade until Sharpe >= 1.5");
    const score = scoreGoal(goal, { sharpe: 1.6 }, 1);
    expect(score.endStateMet).toBe(true);
    expect(score.progressPct).toBe(1);
  });

  it("scales progress 0..1 when below threshold", () => {
    const goal = parseGoal("trade until Sharpe >= 2");
    const score = scoreGoal(goal, { sharpe: 1.0 }, 1);
    expect(score.endStateMet).toBe(false);
    expect(score.progressPct).toBeCloseTo(0.5);
  });

  it("reports progress=0 when observation missing", () => {
    const goal = parseGoal("trade until Sharpe >= 2");
    const score = scoreGoal(goal, {}, 1);
    expect(score.endStateMet).toBe(false);
    expect(score.progressPct).toBe(0);
  });
});

describe("scoreGoal — drawdown (inverted direction)", () => {
  it("treats lower drawdown as more progress", () => {
    const goal = parseGoal("trade until max drawdown under 20%");
    const high = scoreGoal(goal, { maxDrawdown: 0.18 }, 1);
    const low = scoreGoal(goal, { maxDrawdown: 0.05 }, 1);
    expect(low.progressPct).toBeGreaterThan(high.progressPct);
    expect(low.endStateMet).toBe(true);
    expect(high.endStateMet).toBe(true);
  });

  it("end state fails when drawdown meets/exceeds cap", () => {
    const goal = parseGoal("trade until max drawdown under 10%");
    const score = scoreGoal(goal, { maxDrawdown: 0.15 }, 1);
    expect(score.endStateMet).toBe(false);
    expect(score.progressPct).toBe(0);
  });
});

describe("scoreGoal — checklist", () => {
  it("computes done/total", () => {
    const goal = parseGoal("do work until every item in the checklist is done");
    // Supply 4 items in the parsed end state (override since regex doesn't capture)
    goal.endState!.items = ["a", "b", "c", "d"];
    const score = scoreGoal(goal, { checklistChecks: [true, true, false, false] }, 1);
    expect(score.progressPct).toBe(0.5);
    expect(score.endStateMet).toBe(false);
  });

  it("end state met when all items checked", () => {
    const goal = parseGoal("do work until every item in the checklist is done");
    goal.endState!.items = ["a", "b"];
    const score = scoreGoal(goal, { checklistChecks: [true, true] }, 1);
    expect(score.endStateMet).toBe(true);
  });
});

describe("scoreGoal — constraint enforcement", () => {
  it("blocks end-state-met when a constraint is violated", () => {
    const goal = parseGoal("trade until Sharpe >= 1.0 without leverage above 2x");
    const score = scoreGoal(
      goal,
      { sharpe: 2.0, constraintViolations: ["leverage 3x detected"] },
      1,
    );
    expect(score.endStateMet).toBe(false);
    expect(score.constraintsHeld).toBe(false);
    expect(score.rationale).toContain("constraint violations");
  });

  it("constraintsHeld=true when violations array is empty", () => {
    const goal = parseGoal("trade until Sharpe >= 1");
    const score = scoreGoal(goal, { sharpe: 1.1, constraintViolations: [] }, 1);
    expect(score.constraintsHeld).toBe(true);
  });
});

describe("scoreGoal — custom + missing end state", () => {
  it("returns progress=0 with rationale for custom", () => {
    const goal = parseGoal("trade until the vibes are right");
    const score = scoreGoal(goal, {}, 1);
    expect(score.endStateMet).toBe(false);
    expect(score.rationale).toContain("manual");
  });

  it("returns sensible default for no end state", () => {
    const goal = parseGoal("trade BTC");
    const score = scoreGoal(goal, {}, 1);
    expect(score.endStateMet).toBe(false);
    expect(score.rationale).toContain("no end state");
  });
});

describe("scoreGoal — observations payload", () => {
  it("includes observed metrics in the payload", () => {
    const goal = parseGoal("trade until Sharpe >= 1.5");
    const score = scoreGoal(
      goal,
      { sharpe: 1.2, winRate: 0.55, trades: 3 },
      1,
    );
    expect(score.observations?.sharpe).toBe(1.2);
    expect(score.observations?.winRate).toBe(0.55);
    expect(score.observations?.trades).toBe(3);
  });
});

describe("createGoalState", () => {
  it("starts with iterations=0 and status=active", () => {
    const state = createGoalState("/goal trade until Sharpe >= 1.5");
    expect(state.iterations).toBe(0);
    expect(state.status).toBe("active");
    expect(state.parsedGoal.endState?.type).toBe("sharpe");
  });

  it("assigns a unique id per call", () => {
    const a = createGoalState("trade");
    const b = createGoalState("trade");
    expect(a.id).not.toBe(b.id);
  });
});

describe("recordGoalProgress", () => {
  it("does not mutate the input state", () => {
    const state = createGoalState("trade until Sharpe >= 1.5");
    const score = scoreGoal(state.parsedGoal, { sharpe: 1.0 }, 1);
    const updated = recordGoalProgress(state, score);
    expect(state.iterations).toBe(0);
    expect(updated.iterations).toBe(1);
  });

  it("does NOT self-seal achieved even when end state met (A1: verifier gates the seal)", () => {
    const state = createGoalState("trade until Sharpe >= 1.5");
    const score = scoreGoal(state.parsedGoal, { sharpe: 2.0 }, 1);
    const updated = recordGoalProgress(state, score);
    // Self-score is a completion candidate, not done — status stays active
    // until finalizeGoalCompletion runs the independent verifier.
    expect(updated.status).toBe("active");
  });

  it("stays active when end state not yet met", () => {
    const state = createGoalState("trade until Sharpe >= 1.5");
    const score = scoreGoal(state.parsedGoal, { sharpe: 1.0 }, 1);
    const updated = recordGoalProgress(state, score);
    expect(updated.status).toBe("active");
  });
});

describe("lifecycle transitions", () => {
  it("pause only acts on active", () => {
    const active = createGoalState("trade until Sharpe >= 1");
    expect(pauseGoal(active).status).toBe("paused");
    const achieved = { ...active, status: "achieved" as const };
    expect(pauseGoal(achieved).status).toBe("achieved");
  });

  it("resume only acts on paused", () => {
    const paused = pauseGoal(createGoalState("trade"));
    expect(resumeGoal(paused).status).toBe("active");
    expect(resumeGoal(createGoalState("trade")).status).toBe("active");
  });

  it("clear flips to cleared regardless of prior status", () => {
    expect(clearGoal(createGoalState("trade")).status).toBe("cleared");
    expect(clearGoal(pauseGoal(createGoalState("trade"))).status).toBe("cleared");
  });

  it("fail records a note and flips to failed", () => {
    const state = createGoalState("trade");
    const failed = failGoal(state, "doom-loop tripped");
    expect(failed.status).toBe("failed");
    expect(failed.notes[0]).toContain("doom-loop tripped");
  });

  it("isGoalComplete on terminal states", () => {
    expect(isGoalComplete(createGoalState("trade"))).toBe(false);
    expect(isGoalComplete(clearGoal(createGoalState("trade")))).toBe(true);
    expect(isGoalComplete(failGoal(createGoalState("trade"), "x"))).toBe(true);
    expect(isGoalComplete(pauseGoal(createGoalState("trade")))).toBe(false);
  });
});

describe("appendGoalNote", () => {
  it("appends a note without mutating input", () => {
    const a = createGoalState("trade");
    const b = appendGoalNote(a, "operator: looks good");
    expect(a.notes).toEqual([]);
    expect(b.notes).toEqual(["operator: looks good"]);
  });
});

describe("persistGoalState / loadActiveGoal", () => {
  it("returns null when no state file exists", () => {
    expect(loadActiveGoal(join(tempDir, "missing.json"))).toBeNull();
  });

  it("round-trips a state through disk", () => {
    const a = createGoalState("trade until Sharpe >= 1.5");
    persistGoalState(a, statePath);
    expect(existsSync(statePath)).toBe(true);
    const b = loadActiveGoal(statePath);
    expect(b?.id).toBe(a.id);
    expect(b?.parsedGoal.endState?.threshold).toBe(1.5);
  });

  it("returns null on corrupt JSON", () => {
    const { writeFileSync } = require("node:fs");
    writeFileSync(statePath, "not-json{", "utf8");
    expect(loadActiveGoal(statePath)).toBeNull();
  });
});

describe("appendProgressLog", () => {
  it("writes a header on first append", () => {
    const state = createGoalState("/goal trade until Sharpe >= 1.5");
    const score = scoreGoal(state.parsedGoal, { sharpe: 1.0 }, 1);
    appendProgressLog(state, score, progressPath);
    const content = readFileSync(progressPath, "utf8");
    expect(content).toContain("# Gordon goal progress");
    expect(content).toContain("**Goal:** /goal trade until Sharpe >= 1.5");
    expect(content).toContain("Iteration 1");
  });

  it("appends subsequent iterations without a duplicate header", () => {
    const state = createGoalState("/goal trade until Sharpe >= 1.5");
    appendProgressLog(state, scoreGoal(state.parsedGoal, { sharpe: 1.0 }, 1), progressPath);
    appendProgressLog(state, scoreGoal(state.parsedGoal, { sharpe: 1.2 }, 2), progressPath);
    const content = readFileSync(progressPath, "utf8");
    // Header should appear exactly once.
    const headerCount = (content.match(/# Gordon goal progress/g) ?? []).length;
    expect(headerCount).toBe(1);
    expect(content).toContain("Iteration 1");
    expect(content).toContain("Iteration 2");
  });

  it("includes constraint-violation rationale", () => {
    const state = createGoalState("/goal trade until Sharpe >= 1 without leverage above 2x");
    const score = scoreGoal(
      state.parsedGoal,
      { sharpe: 2, constraintViolations: ["leverage 3x detected"] },
      1,
    );
    appendProgressLog(state, score, progressPath);
    const content = readFileSync(progressPath, "utf8");
    expect(content).toContain("leverage 3x detected");
  });
});

describe("formatGoalState", () => {
  it("renders summary lines", () => {
    const state = createGoalState("/goal trade until Sharpe >= 1.5 without shorting");
    const out = formatGoalState(state);
    expect(out).toContain("active");
    expect(out.toLowerCase()).toContain("sharpe");
    expect(out).toContain("shorting");
  });
});

describe("goalStateToPayload", () => {
  it("emits stable shape", () => {
    const state = createGoalState("/goal trade until Sharpe >= 1.5");
    const p = goalStateToPayload(state);
    expect(p.kind).toBe("goal.state_recorded");
    expect(p.status).toBe("active");
    expect(p.parsedEndState).toBe("sharpe");
  });
});
