import { describe, expect, test } from "bun:test";
import { computeResidualSScore, computeResidualSScores } from "./eigenportfolio-residual.ts";

describe("eigenportfolio residual s-score", () => {
  test("returns deterministic finite scores", () => {
    const returns = [
      [0.01, 0.02, -0.01, 0.03, 0.01, -0.02],
      [0.008, 0.018, -0.012, 0.028, 0.009, 0.04],
      [-0.004, 0.01, 0.005, 0.012, -0.003, 0.01],
    ];
    const scores = computeResidualSScores(returns, 1);
    expect(scores).toHaveLength(3);
    expect(scores.every((result) => Number.isFinite(result.score))).toBe(true);
    expect(computeResidualSScore(returns, 1)?.asset).toBe(1);
  });

  test("rejects insufficient history", () => {
    expect(computeResidualSScores([[0.1, 0.2]], 1)).toEqual([]);
  });
});
