import { describe, expect, test } from "bun:test";
import { buildJudgePrompt } from "./trajectoryJudge.ts";
import type { EvalScenario, EvalTrajectory } from "./types.ts";

const baseScenario: EvalScenario = {
  id: "lp3-anchor",
  tags: ["analysis"],
  systemPrompt: "You are a careful trading analyst.",
  userInput: "What is 2% of a 50,000 USD account?",
};

const trajectories: ReadonlyArray<EvalTrajectory> = [
  { id: "a", messages: [{ role: "assistant", content: "1,000 USD" }] },
  { id: "b", messages: [{ role: "assistant", content: "2,500 USD" }] },
];

const EXPECTED_HEADER = "# Expected (known-correct)";

describe("buildJudgePrompt — expectedAnswer (LP3)", () => {
  test("injects the known-correct block when expectedAnswer is present", () => {
    const prompt = buildJudgePrompt(
      { ...baseScenario, expectedAnswer: "1,000 USD (2% of 50,000)." },
      trajectories,
    );
    expect(prompt).toContain(EXPECTED_HEADER);
    expect(prompt).toContain("1,000 USD (2% of 50,000).");
    expect(prompt).toContain("ground truth for CORRECTNESS");
  });

  test("is additive — no block and unchanged structure when absent", () => {
    const prompt = buildJudgePrompt(baseScenario, trajectories);
    expect(prompt).not.toContain(EXPECTED_HEADER);
    // The rest of the prompt is unaffected.
    expect(prompt).toContain("# Agent system prompt (the rubric)");
    expect(prompt).toContain("# Trajectories to rank");
    expect(prompt).toContain("# User input");
  });
});
