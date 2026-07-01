import { describe, expect, test } from "bun:test";
import {
  optimizePrompt,
  appendFragmentMutator,
  type PromptMutator,
  type PromptScorer,
} from "./promptOptimizer.ts";
import type { HoldoutAccessConfig } from "../../../trading/ops/holdoutAccessGate.ts";

function access(trainBudget?: number): HoldoutAccessConfig {
  return {
    policies: [
      { split: "train", access: "trainable", budget: trainBudget },
      { split: "holdout", access: "locked" },
    ],
  };
}

/** A mutator that ignores `best` and emits a deterministic P<iter> candidate. */
const numberedMutator: PromptMutator = (_best, iter) => ({
  prompt: `P${iter}`,
  origin: `m${iter}`,
});

describe("optimizePrompt", () => {
  test("keeps the best-scoring prompt, not the last tried", () => {
    const scores: Record<string, number> = { P0: 0.1, P1: 0.5, P2: 0.2, P3: 0.9 };
    const scorer: PromptScorer = (prompt) => scores[prompt] ?? 0;
    const result = optimizePrompt({
      initialPrompt: "P0",
      mutate: numberedMutator,
      scorer,
      access: access(),
      maxIterations: 3,
      // Wide window so the plateau brake never trips in this test.
      stagnation: { window: 50 },
    });
    expect(result.bestPrompt).toBe("P3");
    expect(result.bestTrainScore).toBeCloseTo(0.9, 10);
    expect(result.stopReason).toBe("max_iterations");
    expect(result.holdoutScore).toBeCloseTo(0.9, 10);
    // P1 accepted, P2 rejected (worse), P3 accepted.
    expect(result.trials[1]!.accepted).toBe(true);
    expect(result.trials[2]!.accepted).toBe(false);
    expect(result.trials[3]!.accepted).toBe(true);
  });

  test("plateau brake stops when the running best stalls", () => {
    const scorer: PromptScorer = () => 0.5; // constant → no improvement
    const result = optimizePrompt({
      initialPrompt: "seed",
      mutate: numberedMutator,
      scorer,
      access: access(),
      maxIterations: 20,
      stagnation: { window: 2 },
    });
    expect(result.stopReason).toBe("plateau");
    // baseline + 2 iterations reach the window+1 sample floor and pivot.
    expect(result.iterations).toBe(2);
  });

  test("budget brake caps train evaluations", () => {
    const scorer: PromptScorer = (prompt) => (prompt === "P1" ? 0.9 : 0.1);
    const result = optimizePrompt({
      initialPrompt: "P0",
      mutate: numberedMutator,
      scorer,
      access: access(2),
      stagnation: { window: 50 },
    });
    expect(result.stopReason).toBe("budget_exhausted");
    expect(result.evalsUsed).toBe(2);
    expect(result.iterations).toBe(1);
  });

  test("finalHoldoutRead=false leaves the holdout untouched", () => {
    const calls: string[] = [];
    const scorer: PromptScorer = (_p, split) => {
      calls.push(split);
      return 0.5;
    };
    const result = optimizePrompt({
      initialPrompt: "P0",
      mutate: numberedMutator,
      scorer,
      access: access(),
      maxIterations: 2,
      stagnation: { window: 50 },
      finalHoldoutRead: false,
    });
    expect(result.holdoutScore).toBeNull();
    expect(calls).not.toContain("holdout");
  });

  test("appendFragmentMutator cycles fragments onto the best prompt", () => {
    const mut = appendFragmentMutator(["be specific", "size the trade"]);
    const c1 = mut("base", 1);
    const c2 = mut("base", 2);
    expect(c1.prompt).toBe("base\nbe specific");
    expect(c2.prompt).toBe("base\nsize the trade");
    expect(c1.origin).toContain("append:");
  });
});
