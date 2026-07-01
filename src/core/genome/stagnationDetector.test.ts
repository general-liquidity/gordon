import { describe, it, expect } from "bun:test";

import { detectStagnation, stagnationToPayload } from "./stagnationDetector.ts";

describe("detectStagnation — insufficient history", () => {
  it("recommends continue_tuning below the window+1 sample floor", () => {
    const res = detectStagnation({ fitnessHistory: [0.1, 0.2, 0.3], window: 5 });
    expect(res.stagnant).toBe(false);
    expect(res.recommendation).toBe("continue_tuning");
    expect(res.reason).toContain("Not enough history");
  });

  it("handles an empty history", () => {
    const res = detectStagnation({ fitnessHistory: [] });
    expect(res.stagnant).toBe(false);
    expect(res.samples).toBe(0);
  });
});

describe("detectStagnation — plateau", () => {
  it("flags a flat run as a structural pivot", () => {
    const flat = [0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5, 0.5];
    const res = detectStagnation({ fitnessHistory: flat, window: 5 });
    expect(res.stagnant).toBe(true);
    expect(res.recommendation).toBe("structural_pivot");
    expect(res.improvementOverWindow).toBeLessThan(1e-3);
  });

  it("flags a run whose best stopped advancing (converged to a local optimum)", () => {
    // Big early gains, then micro-noise around the same peak.
    const history = [0.1, 0.4, 0.79, 0.8, 0.8001, 0.7999, 0.8, 0.8002, 0.7998];
    const res = detectStagnation({ fitnessHistory: history, window: 5, epsilon: 0.01 });
    expect(res.stagnant).toBe(true);
    expect(res.recommendation).toBe("structural_pivot");
  });
});

describe("detectStagnation — still improving", () => {
  it("keeps tuning when the trailing window still gains beyond epsilon", () => {
    const climbing = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8];
    const res = detectStagnation({ fitnessHistory: climbing, window: 5 });
    expect(res.stagnant).toBe(false);
    expect(res.recommendation).toBe("continue_tuning");
    expect(res.improvementOverWindow).toBeGreaterThan(0);
    expect(res.iterationsSinceImprovement).toBe(0);
  });

  it("respects a custom epsilon threshold", () => {
    const smallGains = [0.5, 0.5, 0.5, 0.5, 0.505, 0.51, 0.515];
    const strict = detectStagnation({ fitnessHistory: smallGains, window: 3, epsilon: 0.001 });
    const lax = detectStagnation({ fitnessHistory: smallGains, window: 3, epsilon: 0.1 });
    expect(strict.stagnant).toBe(false);
    expect(lax.stagnant).toBe(true);
  });
});

describe("detectStagnation — robustness", () => {
  it("ignores NaN / infinite samples", () => {
    const history = [0.5, Number.NaN, 0.5, Infinity, 0.5, 0.5, 0.5, 0.5];
    const res = detectStagnation({ fitnessHistory: history, window: 5 });
    expect(res.samples).toBe(6);
    expect(res.stagnant).toBe(true);
  });

  it("iterationsSinceImprovement counts coasting below the peak", () => {
    const history = [0.1, 0.9, 0.5, 0.5, 0.5, 0.5];
    const res = detectStagnation({ fitnessHistory: history, window: 3 });
    expect(res.iterationsSinceImprovement).toBe(4);
  });
});

describe("stagnationToPayload", () => {
  it("emits a structured observation payload", () => {
    const payload = stagnationToPayload(
      detectStagnation({ fitnessHistory: [0.5, 0.5, 0.5, 0.5, 0.5, 0.5] }),
    );
    expect(payload.kind).toBe("genome.stagnation_checked");
    expect(payload.recommendation).toBe("structural_pivot");
  });
});
