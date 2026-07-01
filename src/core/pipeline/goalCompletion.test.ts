import { describe, it, expect, afterEach } from "bun:test";

import {
  createGoalState,
  scoreGoal,
  recordGoalProgress,
  finalizeGoalCompletion,
  sealAcknowledgedGaps,
  isGoalComplete,
  type GoalObservation,
} from "./goalMode.ts";
import { deriveRequirements, unmetRequirements } from "./goalGapFinding.ts";
import {
  getCompletionVerifier,
  setCompletionVerifier,
  resetCompletionVerifier,
  type CompletionVerifier,
} from "./completionVerifier.ts";

afterEach(() => resetCompletionVerifier());

function step(goalText: string, obs: GoalObservation) {
  const base = createGoalState(goalText);
  const score = scoreGoal(base.parsedGoal, obs, 1);
  const state = recordGoalProgress(base, score);
  return { state, score };
}

describe("finalizeGoalCompletion (A1 verifier gate)", () => {
  it("seals achieved when self-score proposes completion and verifier confirms", async () => {
    const { state, score } = step("trade until Sharpe >= 1.5", { sharpe: 2.0 });
    const result = await finalizeGoalCompletion(state, score, { sharpe: 2.0 }, getCompletionVerifier(), 1);
    expect(result.sealed).toBe(true);
    expect(result.state.status).toBe("achieved");
    expect(isGoalComplete(result.state)).toBe(true);
  });

  it("does not seal (and is not a blocked-premature) when self-score does not propose completion", async () => {
    const { state, score } = step("trade until Sharpe >= 1.5", { sharpe: 1.0 });
    const result = await finalizeGoalCompletion(state, score, { sharpe: 1.0 }, getCompletionVerifier(), 1);
    expect(result.sealed).toBe(false);
    expect(result.blockedPrematureCompletion).toBe(false);
    expect(result.state.status).toBe("active");
  });

  it("blocks a premature completion when the verifier refuses despite a passing self-score", async () => {
    // Verifier that always refuses — simulates an independent check catching
    // an optimistic self-score.
    const refusing: CompletionVerifier = {
      id: "always-refuse",
      verify: (ctx) => ({
        verifierId: "always-refuse",
        confirmed: false,
        unmet: unmetRequirements(ctx.requirements),
        rationale: "independent check failed",
      }),
    };
    setCompletionVerifier(refusing);
    const { state, score } = step("trade until Sharpe >= 1.5", { sharpe: 2.0 });
    const result = await finalizeGoalCompletion(state, score, { sharpe: 2.0 }, getCompletionVerifier(), 1);
    expect(result.sealed).toBe(false);
    expect(result.blockedPrematureCompletion).toBe(true);
    expect(result.state.status).toBe("active");
    expect(isGoalComplete(result.state)).toBe(false);
    expect(result.state.notes.join(" ")).toContain("blocked");
  });

  it("surfaces the derived unmet set alongside the verdict", async () => {
    const { state, score } = step("trade until Sharpe >= 1.5", { sharpe: 1.0 });
    const result = await finalizeGoalCompletion(state, score, { sharpe: 1.0 }, getCompletionVerifier(), 1);
    expect(result.unmet.length).toBeGreaterThan(0);
  });
});

describe("sealAcknowledgedGaps (C1)", () => {
  it("seals a stopping goal as achieved_with_acknowledged_gaps recording the unmet set", () => {
    const obs: GoalObservation = { sharpe: 1.0 };
    const state = createGoalState("trade until Sharpe >= 1.5");
    const score = scoreGoal(state.parsedGoal, obs, 1);
    const unmet = unmetRequirements(deriveRequirements(state.parsedGoal, obs, score));
    const sealed = sealAcknowledgedGaps(state, unmet, "goal stalled");
    expect(sealed.status).toBe("achieved_with_acknowledged_gaps");
    expect(sealed.acknowledgedGaps).toEqual(unmet);
    expect(isGoalComplete(sealed)).toBe(true);
    expect(sealed.notes.join(" ")).toContain("acknowledged gap");
  });

  it("is distinct from a clean achieved and from a silent cancel", () => {
    const state = createGoalState("trade until Sharpe >= 1.5");
    const sealed = sealAcknowledgedGaps(state, [], "explicit");
    // Terminal + honest, but not the clean achieved status.
    expect(sealed.status).not.toBe("achieved");
    expect(sealed.status).not.toBe("cleared");
    expect(isGoalComplete(sealed)).toBe(true);
  });
});
