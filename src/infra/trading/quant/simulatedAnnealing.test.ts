import { describe, it, expect } from "bun:test";
import { computeSimulatedAnnealing, simulatedAnnealingToPayload } from "./simulatedAnnealing.ts";

describe("computeSimulatedAnnealing — convex problem", () => {
  it("finds the maximum of a 1D quadratic", () => {
    // f(x) = -(x - 3)² → maximum at x = 3, value = 0
    const r = computeSimulatedAnnealing({
      objective: (x) => -((x[0]! - 3) ** 2),
      initialState: [0],
      bounds: [[-10, 10]],
      maxIterations: 2000,
      seed: 42,
    });
    expect(r.bestState[0]!).toBeCloseTo(3, 0);
    expect(r.bestValue).toBeGreaterThan(-1);
  });

  it("finds the maximum of a 2D bowl", () => {
    // f(x, y) = -((x-1)² + (y+2)²) → max at (1, -2), value = 0
    const r = computeSimulatedAnnealing({
      objective: (x) => -((x[0]! - 1) ** 2 + (x[1]! + 2) ** 2),
      initialState: [0, 0],
      bounds: [
        [-5, 5],
        [-5, 5],
      ],
      maxIterations: 2000,
      seed: 7,
    });
    expect(r.bestState[0]!).toBeCloseTo(1, 0);
    expect(r.bestState[1]!).toBeCloseTo(-2, 0);
  });
});

describe("computeSimulatedAnnealing — temperature behaviour", () => {
  it("temperature decays geometrically", () => {
    const r = computeSimulatedAnnealing({
      objective: (x) => -(x[0]! ** 2),
      initialState: [0],
      bounds: [[-5, 5]],
      initialTemperature: 1,
      coolingRate: 0.9,
      maxIterations: 50,
      seed: 1,
    });
    // After 50 iterations at 0.9 cooling: T ≈ 0.9^50 ≈ 0.005
    expect(r.finalTemperature).toBeLessThan(0.01);
    expect(r.finalTemperature).toBeGreaterThan(0.001);
  });

  it("higher initial temperature → more worse-moves accepted", () => {
    // For a multi-modal problem, hot start should explore more.
    const obj = (x: ReadonlyArray<number>) => -((x[0]! - 5) ** 2 * Math.sin(x[0]!));
    const cold = computeSimulatedAnnealing({
      objective: obj,
      initialState: [0],
      bounds: [[-10, 10]],
      initialTemperature: 0.01,
      maxIterations: 500,
      seed: 11,
    });
    const hot = computeSimulatedAnnealing({
      objective: obj,
      initialState: [0],
      bounds: [[-10, 10]],
      initialTemperature: 10,
      maxIterations: 500,
      seed: 11,
    });
    expect(hot.acceptedWorseMoves).toBeGreaterThanOrEqual(cold.acceptedWorseMoves);
  });
});

describe("computeSimulatedAnnealing — bounds enforcement", () => {
  it("final state respects bounds", () => {
    const r = computeSimulatedAnnealing({
      objective: (x) => x[0]!, // strictly increasing → wants to escape
      initialState: [0],
      bounds: [[-1, 1]],
      maxIterations: 500,
      seed: 3,
    });
    expect(r.bestState[0]!).toBeGreaterThanOrEqual(-1);
    expect(r.bestState[0]!).toBeLessThanOrEqual(1);
  });
});

describe("computeSimulatedAnnealing — determinism", () => {
  it("same seed yields identical result", () => {
    const obj = (x: ReadonlyArray<number>) => -((x[0]! - 2) ** 2);
    const a = computeSimulatedAnnealing({
      objective: obj,
      initialState: [0],
      bounds: [[-5, 5]],
      maxIterations: 200,
      seed: 99,
    });
    const b = computeSimulatedAnnealing({
      objective: obj,
      initialState: [0],
      bounds: [[-5, 5]],
      maxIterations: 200,
      seed: 99,
    });
    expect(a.bestValue).toBe(b.bestValue);
    expect(a.bestState).toEqual(b.bestState);
  });

  it("different seeds yield different trajectories", () => {
    const obj = (x: ReadonlyArray<number>) => -((x[0]! - 2) ** 2);
    const a = computeSimulatedAnnealing({
      objective: obj,
      initialState: [0],
      bounds: [[-5, 5]],
      maxIterations: 100,
      seed: 1,
    });
    const b = computeSimulatedAnnealing({
      objective: obj,
      initialState: [0],
      bounds: [[-5, 5]],
      maxIterations: 100,
      seed: 2,
    });
    // Different seeds → different paths (best values may both converge but
    // intermediate acceptance counts should differ)
    expect(
      a.acceptedMoves !== b.acceptedMoves || a.acceptedWorseMoves !== b.acceptedWorseMoves,
    ).toBe(true);
  });
});

describe("computeSimulatedAnnealing — stagnation early-stop", () => {
  it("stops early when no improvement for N iterations", () => {
    const r = computeSimulatedAnnealing({
      objective: () => 1, // constant — nothing to improve
      initialState: [0],
      bounds: [[-5, 5]],
      maxIterations: 10000,
      stagnationLimit: 50,
      seed: 4,
    });
    expect(r.stagnated).toBe(true);
    expect(r.iterations).toBeLessThan(200);
  });
});

describe("computeSimulatedAnnealing — validation", () => {
  it("throws on bounds/state mismatch", () => {
    expect(() =>
      computeSimulatedAnnealing({
        objective: () => 0,
        initialState: [0, 0],
        bounds: [[-1, 1]],
      }),
    ).toThrow();
  });
  it("throws on invalid bound order", () => {
    expect(() =>
      computeSimulatedAnnealing({
        objective: () => 0,
        initialState: [0],
        bounds: [[5, 1]],
      }),
    ).toThrow();
  });
  it("throws on non-positive temperature", () => {
    expect(() =>
      computeSimulatedAnnealing({
        objective: () => 0,
        initialState: [0],
        bounds: [[-1, 1]],
        initialTemperature: 0,
      }),
    ).toThrow();
  });
  it("throws on cooling rate outside (0, 1)", () => {
    expect(() =>
      computeSimulatedAnnealing({
        objective: () => 0,
        initialState: [0],
        bounds: [[-1, 1]],
        coolingRate: 1,
      }),
    ).toThrow();
  });
});

describe("simulatedAnnealingToPayload", () => {
  it("emits stable shape", () => {
    const r = computeSimulatedAnnealing({
      objective: (x) => -(x[0]! ** 2),
      initialState: [1],
      bounds: [[-2, 2]],
      maxIterations: 50,
      seed: 1,
    });
    const p = simulatedAnnealingToPayload(r) as { kind: string };
    expect(p.kind).toBe("simulated_annealing.computed");
  });
});
