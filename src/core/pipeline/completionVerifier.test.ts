import { describe, it, expect, afterEach } from "bun:test";

import { parseGoal, scoreGoal, type GoalObservation } from "./goalMode.ts";
import { deriveRequirements } from "./goalGapFinding.ts";
import {
  requirementCompletionVerifier,
  verifyCompletion,
  getCompletionVerifier,
  setCompletionVerifier,
  resetCompletionVerifier,
  type CompletionContext,
  type CompletionVerifier,
} from "./completionVerifier.ts";

function context(goalText: string, obs: GoalObservation): CompletionContext {
  const goal = parseGoal(goalText);
  const score = scoreGoal(goal, obs, 1);
  return { goal, score, observation: obs, requirements: deriveRequirements(goal, obs, score), cycle: 1 };
}

afterEach(() => resetCompletionVerifier());

describe("requirementCompletionVerifier", () => {
  it("confirms when all requirements met and self-score agrees", async () => {
    const verdict = await verifyCompletion(requirementCompletionVerifier, context("trade until Sharpe >= 1.5", { sharpe: 2.0 }));
    expect(verdict.confirmed).toBe(true);
    expect(verdict.unmet).toHaveLength(0);
  });

  it("refuses when the end state is not met", async () => {
    const verdict = await verifyCompletion(requirementCompletionVerifier, context("trade until Sharpe >= 1.5", { sharpe: 1.0 }));
    expect(verdict.confirmed).toBe(false);
    expect(verdict.unmet.length).toBeGreaterThan(0);
  });

  it("refuses when a constraint was violated even if the end state is met", async () => {
    const verdict = await verifyCompletion(
      requirementCompletionVerifier,
      context("trade until Sharpe >= 1.5", { sharpe: 2.0, constraintViolations: ["mandate breached"] }),
    );
    expect(verdict.confirmed).toBe(false);
  });

  it("refuses a custom goal with no measurable end state", async () => {
    const verdict = await verifyCompletion(requirementCompletionVerifier, context("watch the market", {}));
    expect(verdict.confirmed).toBe(false);
  });
});

describe("verifyCompletion fail-closed", () => {
  it("treats a throwing verifier as non-confirmation", async () => {
    const broken: CompletionVerifier = {
      id: "broken",
      verify() {
        throw new Error("boom");
      },
    };
    const verdict = await verifyCompletion(broken, context("trade until Sharpe >= 1.5", { sharpe: 2.0 }));
    expect(verdict.confirmed).toBe(false);
    expect(verdict.rationale).toContain("fail-closed");
  });
});

describe("verifier seam", () => {
  it("defaults to the requirement-set verifier", () => {
    expect(getCompletionVerifier().id).toBe("requirement-set-v1");
  });

  it("can inject and reset a custom verifier", () => {
    const custom: CompletionVerifier = {
      id: "custom",
      verify: () => ({ verifierId: "custom", confirmed: true, unmet: [], rationale: "ok" }),
    };
    setCompletionVerifier(custom);
    expect(getCompletionVerifier().id).toBe("custom");
    resetCompletionVerifier();
    expect(getCompletionVerifier().id).toBe("requirement-set-v1");
  });
});
