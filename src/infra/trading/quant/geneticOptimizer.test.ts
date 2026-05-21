import { describe, it, expect } from "bun:test";
import {
  isGeneticOptimizerEnabled,
  computeGeneticOptimizer,
  geneticOptimizerToPayload,
  GENETIC_OPTIMIZER_FLAG_ENV,
} from "./geneticOptimizer.ts";

describe("isGeneticOptimizerEnabled", () => {
  it("respects the flag", () => {
    expect(isGeneticOptimizerEnabled({})).toBe(false);
    expect(isGeneticOptimizerEnabled({ [GENETIC_OPTIMIZER_FLAG_ENV]: "1" })).toBe(
      true,
    );
  });
});

describe("computeGeneticOptimizer — convergence on convex problems", () => {
  it("finds 1D quadratic maximum", () => {
    const r = computeGeneticOptimizer({
      objective: (x) => -((x[0]! - 4) ** 2),
      bounds: [[-10, 10]],
      populationSize: 30,
      maxGenerations: 50,
      seed: 5,
    });
    expect(r.bestGenome[0]!).toBeCloseTo(4, 0);
    expect(r.bestFitness).toBeGreaterThan(-1);
  });

  it("finds 2D paraboloid maximum", () => {
    const r = computeGeneticOptimizer({
      objective: (x) => -((x[0]! + 1) ** 2 + (x[1]! - 3) ** 2),
      bounds: [
        [-5, 5],
        [-5, 5],
      ],
      populationSize: 50,
      maxGenerations: 80,
      seed: 11,
    });
    expect(r.bestGenome[0]!).toBeCloseTo(-1, 0);
    expect(r.bestGenome[1]!).toBeCloseTo(3, 0);
  });
});

describe("computeGeneticOptimizer — fitness improves over generations", () => {
  it("best fitness is non-decreasing", () => {
    const r = computeGeneticOptimizer({
      objective: (x) => -(x[0]! ** 2 + x[1]! ** 2),
      bounds: [
        [-10, 10],
        [-10, 10],
      ],
      populationSize: 40,
      maxGenerations: 60,
      seed: 17,
    });
    for (let i = 1; i < r.fitnessHistory.length; i++) {
      expect(r.fitnessHistory[i]!).toBeGreaterThanOrEqual(r.fitnessHistory[i - 1]!);
    }
    // Should improve overall
    expect(r.fitnessHistory[r.fitnessHistory.length - 1]!).toBeGreaterThan(
      r.fitnessHistory[0]!,
    );
  });
});

describe("computeGeneticOptimizer — bounds enforcement", () => {
  it("final genome respects per-gene bounds", () => {
    const r = computeGeneticOptimizer({
      objective: (x) => x[0]! + x[1]!, // wants to escape
      bounds: [
        [-1, 1],
        [-2, 2],
      ],
      populationSize: 20,
      maxGenerations: 30,
      seed: 9,
    });
    expect(r.bestGenome[0]!).toBeGreaterThanOrEqual(-1);
    expect(r.bestGenome[0]!).toBeLessThanOrEqual(1);
    expect(r.bestGenome[1]!).toBeGreaterThanOrEqual(-2);
    expect(r.bestGenome[1]!).toBeLessThanOrEqual(2);
  });
});

describe("computeGeneticOptimizer — determinism", () => {
  it("same seed → same result", () => {
    const obj = (x: ReadonlyArray<number>) => -((x[0]! - 2) ** 2);
    const a = computeGeneticOptimizer({
      objective: obj,
      bounds: [[-5, 5]],
      populationSize: 20,
      maxGenerations: 30,
      seed: 42,
    });
    const b = computeGeneticOptimizer({
      objective: obj,
      bounds: [[-5, 5]],
      populationSize: 20,
      maxGenerations: 30,
      seed: 42,
    });
    expect(a.bestFitness).toBe(b.bestFitness);
    expect(a.bestGenome).toEqual(b.bestGenome);
  });
});

describe("computeGeneticOptimizer — stagnation", () => {
  it("stops early under stagnation limit", () => {
    const r = computeGeneticOptimizer({
      objective: () => 0, // flat → never improves
      bounds: [[-1, 1]],
      populationSize: 10,
      maxGenerations: 1000,
      stagnationLimit: 5,
      seed: 1,
    });
    expect(r.stagnated).toBe(true);
    expect(r.generationsRun).toBeLessThan(50);
  });
});

describe("computeGeneticOptimizer — validation", () => {
  it("throws on empty bounds", () => {
    expect(() =>
      computeGeneticOptimizer({ objective: () => 0, bounds: [] }),
    ).toThrow();
  });
  it("throws on invalid bound order", () => {
    expect(() =>
      computeGeneticOptimizer({ objective: () => 0, bounds: [[5, 1]] }),
    ).toThrow();
  });
  it("throws on populationSize < 4", () => {
    expect(() =>
      computeGeneticOptimizer({
        objective: () => 0,
        bounds: [[-1, 1]],
        populationSize: 3,
      }),
    ).toThrow();
  });
  it("throws on tournamentSize < 2", () => {
    expect(() =>
      computeGeneticOptimizer({
        objective: () => 0,
        bounds: [[-1, 1]],
        tournamentSize: 1,
      }),
    ).toThrow();
  });
  it("throws on mutationRate outside [0, 1]", () => {
    expect(() =>
      computeGeneticOptimizer({
        objective: () => 0,
        bounds: [[-1, 1]],
        mutationRate: 1.5,
      }),
    ).toThrow();
  });
  it("throws on eliteCount ≥ populationSize", () => {
    expect(() =>
      computeGeneticOptimizer({
        objective: () => 0,
        bounds: [[-1, 1]],
        populationSize: 10,
        eliteCount: 10,
      }),
    ).toThrow();
  });
});

describe("geneticOptimizerToPayload", () => {
  it("emits stable shape", () => {
    const r = computeGeneticOptimizer({
      objective: (x) => -(x[0]! ** 2),
      bounds: [[-2, 2]],
      populationSize: 10,
      maxGenerations: 10,
      seed: 1,
    });
    const p = geneticOptimizerToPayload(r) as { kind: string };
    expect(p.kind).toBe("genetic_optimizer.computed");
  });
});
