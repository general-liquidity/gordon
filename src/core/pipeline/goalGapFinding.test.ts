import { describe, it, expect } from "bun:test";

import { parseGoal, scoreGoal, type GoalObservation } from "./goalMode.ts";
import {
  deriveRequirements,
  unmetRequirements,
  summarizeGaps,
} from "./goalGapFinding.ts";

function requirements(goalText: string, obs: GoalObservation) {
  const goal = parseGoal(goalText);
  const score = scoreGoal(goal, obs, 1);
  return { goal, score, reqs: deriveRequirements(goal, obs, score) };
}

describe("deriveRequirements", () => {
  it("marks the end-state requirement unmet when the target is not hit", () => {
    const { reqs } = requirements("trade until Sharpe >= 1.5", { sharpe: 1.0 });
    const es = reqs.find((r) => r.kind === "end_state");
    expect(es).toBeDefined();
    expect(es!.met).toBe(false);
    expect(es!.description).toContain("1.5");
  });

  it("marks the end-state requirement met when the target is hit", () => {
    const { reqs } = requirements("trade until Sharpe >= 1.5", { sharpe: 2.0 });
    const es = reqs.find((r) => r.kind === "end_state");
    expect(es!.met).toBe(true);
    expect(unmetRequirements(reqs)).toHaveLength(0);
  });

  it("treats a goal with no measurable end state as outstanding", () => {
    const { reqs } = requirements("just keep an eye on the market", {});
    const es = reqs.find((r) => r.kind === "end_state");
    expect(es!.id).toBe("end_state:custom");
    expect(es!.met).toBe(false);
    expect(unmetRequirements(reqs).length).toBeGreaterThan(0);
  });

  it("emits one unmet constraint requirement per violation this cycle", () => {
    const { reqs } = requirements("trade until Sharpe >= 1.5", {
      sharpe: 2.0,
      constraintViolations: ["mandate breached", "over exposure"],
    });
    const constraints = reqs.filter((r) => r.kind === "constraint");
    expect(constraints).toHaveLength(2);
    expect(constraints.every((r) => !r.met)).toBe(true);
    // scoreGoal couples the end-state flag to constraints (a goal cannot be
    // met while constraints break), so the end-state requirement also reads
    // unmet here: 1 end_state + 2 constraints = 3 outstanding (fail-closed).
    expect(unmetRequirements(reqs).length).toBe(3);
  });

  it("re-derives fresh each cycle: violations that clear are no longer gaps", () => {
    const cycle1 = requirements("trade until Sharpe >= 1.5", {
      sharpe: 2.0,
      constraintViolations: ["mandate breached"],
    });
    // 1 end_state (coupled-unmet under the violation) + 1 constraint = 2.
    expect(unmetRequirements(cycle1.reqs).length).toBe(2);

    const cycle2 = requirements("trade until Sharpe >= 1.5", {
      sharpe: 2.0,
      constraintViolations: [],
    });
    expect(unmetRequirements(cycle2.reqs).length).toBe(0);
  });
});

describe("summarizeGaps", () => {
  it("reports the empty set clearly", () => {
    expect(summarizeGaps([])).toBe("no outstanding requirements");
  });

  it("lists ids and descriptions", () => {
    const { reqs } = requirements("trade until Sharpe >= 1.5", { sharpe: 1.0 });
    const s = summarizeGaps(unmetRequirements(reqs));
    expect(s).toContain("end_state:sharpe");
  });
});
