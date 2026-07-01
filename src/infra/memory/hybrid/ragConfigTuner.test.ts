import { describe, expect, test } from "bun:test";
import {
  tuneRagConfig,
  makeRecallScorer,
  recallAtK,
  type RagConfig,
  type RagKnobSpace,
  type RagScorer,
  type LabeledQuery,
} from "./ragConfigTuner.ts";
import type { HoldoutAccessConfig } from "../../trading/ops/holdoutAccessGate.ts";
import { canEvaluate, emptyEvalState } from "../../trading/ops/holdoutAccessGate.ts";

const SPACE: RagKnobSpace = {
  chunkSize: [100, 200, 400],
  overlap: [0, 20, 50],
  embedding: ["a", "b"],
  k: [5, 10, 20],
  reranker: ["none", "mmr"],
  hybridAlpha: [0.2, 0.5, 0.8],
};

const TARGET: RagConfig = {
  chunkSize: 400,
  overlap: 50,
  embedding: "b",
  k: 20,
  reranker: "mmr",
  hybridAlpha: 0.8,
};

/** Fraction of knobs matching TARGET — separable, so coordinate descent solves it. */
const targetScorer: RagScorer = (config) => {
  let hits = 0;
  for (const knob of Object.keys(TARGET) as (keyof RagConfig)[]) {
    if (config[knob] === TARGET[knob]) hits++;
  }
  return hits / 6;
};

function access(trainBudget?: number): HoldoutAccessConfig {
  return {
    policies: [
      { split: "train", access: "trainable", budget: trainBudget },
      { split: "holdout", access: "locked" },
    ],
  };
}

describe("recallAtK", () => {
  test("counts gold docs inside the top-k", () => {
    expect(recallAtK(["d1", "d2", "d3"], ["d1", "d3"], 3)).toBe(1);
    expect(recallAtK(["d1", "d4", "d5"], ["d1", "d3"], 3)).toBeCloseTo(0.5, 10);
    // Cutoff applies: d3 is present but past k=1.
    expect(recallAtK(["d1", "d3"], ["d3"], 1)).toBe(0);
  });

  test("empty relevant set is vacuously perfect", () => {
    expect(recallAtK(["d1"], [], 3)).toBe(1);
  });
});

describe("makeRecallScorer", () => {
  test("averages recall@config.k across the labeled set", () => {
    const queries: LabeledQuery[] = [
      { id: "q1", relevantDocIds: ["a1"] },
      { id: "q2", relevantDocIds: ["b1", "b2"] },
    ];
    // Retrieval returns the relevant docs only when k >= 20, else nothing.
    const scorer = makeRecallScorer(queries, (config, q) =>
      config.k >= 20 ? [...q.relevantDocIds] : [],
    );
    expect(scorer({ ...TARGET, k: 5 }, "train")).toBe(0);
    expect(scorer({ ...TARGET, k: 20 }, "train")).toBe(1);
  });
});

describe("tuneRagConfig", () => {
  test("coordinate descent converges to the separable optimum", () => {
    const result = tuneRagConfig({ space: SPACE, scorer: targetScorer, access: access() });
    expect(result.best).toEqual(TARGET);
    expect(result.bestTrainScore).toBe(1);
    expect(result.stopReason).toBe("converged");
    expect(result.holdoutScore).toBe(1);
    // Baseline + at least one accepted sweep per knob are logged.
    expect(result.trials.length).toBeGreaterThan(6);
    expect(result.trials[0]!.knob).toBe("seed");
    expect(result.trials.some((t) => t.accepted && t.knob !== "seed")).toBe(true);
  });

  test("budget brake stops the sweep and caps train evaluations", () => {
    const result = tuneRagConfig({ space: SPACE, scorer: targetScorer, access: access(3) });
    expect(result.stopReason).toBe("budget_exhausted");
    expect(result.evalsUsed).toBe(3);
    // Holdout is still read once for the honest generalization number.
    expect(result.holdoutScore).not.toBeNull();
  });

  test("the search never selects on the locked holdout", () => {
    // The holdout gate denies the holdout split outright.
    expect(canEvaluate(access(), "holdout", emptyEvalState()).allowed).toBe(false);

    const calls: string[] = [];
    const countingScorer: RagScorer = (config, split) => {
      calls.push(split);
      return targetScorer(config, split);
    };
    tuneRagConfig({ space: SPACE, scorer: countingScorer, access: access() });
    // Every search evaluation hit train; holdout was read exactly once, last.
    expect(calls.filter((s) => s === "holdout")).toHaveLength(1);
    expect(calls[calls.length - 1]).toBe("holdout");
    expect(calls.slice(0, -1).every((s) => s === "train")).toBe(true);
  });

  test("finalHoldoutRead=false leaves the holdout untouched", () => {
    const calls: string[] = [];
    const countingScorer: RagScorer = (config, split) => {
      calls.push(split);
      return targetScorer(config, split);
    };
    const result = tuneRagConfig({
      space: SPACE,
      scorer: countingScorer,
      access: access(),
      finalHoldoutRead: false,
    });
    expect(result.holdoutScore).toBeNull();
    expect(calls).not.toContain("holdout");
  });
});
