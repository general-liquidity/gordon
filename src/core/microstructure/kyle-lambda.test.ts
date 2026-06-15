import { describe, expect, it } from "bun:test";
import { computeKyleLambda } from "./kyle-lambda.ts";

describe("computeKyleLambda", () => {
  const flows = [2, -1, 3, -2, 1, 0, -3, 2, -1, 4];

  it("recovers the slope exactly on a perfect linear relationship (R²=1)", () => {
    const prices = flows.map((q) => 0.3 * q);
    const r = computeKyleLambda(prices, flows)!;
    expect(r.lambda).toBeCloseTo(0.3, 9);
    expect(r.rSquared).toBeCloseTo(1, 9);
    expect(r.n).toBe(10);
    expect(r.interpretation).toContain("Flow-driven");
  });

  it("handles a negative price-impact slope", () => {
    const prices = flows.map((q) => -0.5 * q);
    const r = computeKyleLambda(prices, flows)!;
    expect(r.lambda).toBeCloseTo(-0.5, 9);
    expect(r.rSquared).toBeCloseTo(1, 9);
  });

  it("reports a partial fit for a noisy-but-correlated series", () => {
    const f = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const prices = f.map((q, i) => 0.5 * q + (i % 2 === 0 ? 1 : -1));
    const r = computeKyleLambda(prices, f)!;
    expect(r.lambda).toBeGreaterThan(0);
    expect(r.rSquared).toBeGreaterThan(0);
    expect(r.rSquared).toBeLessThan(1);
  });

  it("flags a mostly-exogenous series (flow explains little of the price)", () => {
    const f = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    const prices = f.map((q, i) => 0.05 * q + (i % 2 === 0 ? 5 : -5)); // noise dominates
    const r = computeKyleLambda(prices, f)!;
    expect(r.rSquared).toBeLessThan(0.2);
    expect(r.interpretation).toContain("exogenous");
  });

  it("returns null when order flow has no variance or there are too few points", () => {
    expect(computeKyleLambda([1, 2, 3], [5, 5, 5])).toBeNull();
    expect(computeKyleLambda([1], [1])).toBeNull();
  });
});
