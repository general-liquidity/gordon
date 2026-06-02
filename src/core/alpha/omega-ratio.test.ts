import { describe, expect, test } from "bun:test";
import { computeOmegaRatio } from "./omega-ratio.ts";

describe("Omega ratio", () => {
  test("symmetric returns around threshold 0 → omega ≈ 1", () => {
    // +2,-2,+3,-3 → upside=5, downside=5 → 1.0
    const r = computeOmegaRatio([2, -2, 3, -3], 0)!;
    expect(r.omega).toBeCloseTo(1, 6);
    expect(r.interpretation).toContain("≈ 1");
  });

  test("positively-skewed returns → omega > 1", () => {
    // +5,+5,-1,-1 → upside=10, downside=2 → 5.0
    const r = computeOmegaRatio([5, 5, -1, -1], 0)!;
    expect(r.omega).toBeCloseTo(5, 6);
    expect(r.omega!).toBeGreaterThan(1);
  });

  test("downside-dominated returns → omega < 1", () => {
    // +1,+1,-5 → upside=2, downside=5 → 0.4
    const r = computeOmegaRatio([1, 1, -5], 0)!;
    expect(r.omega).toBeCloseTo(0.4, 6);
    expect(r.omega!).toBeLessThan(1);
  });

  test("threshold shifts omega downward", () => {
    // returns [2,-2,3,-3]: at t=0 omega=1; at t=1 upside=(1)+(2)=3, downside=(3)+(4)=7 → 3/7
    const base = computeOmegaRatio([2, -2, 3, -3], 0)!;
    const shifted = computeOmegaRatio([2, -2, 3, -3], 1)!;
    expect(base.omega).toBeCloseTo(1, 6);
    expect(shifted.omega).toBeCloseTo(3 / 7, 4);
    expect(shifted.omega!).toBeLessThan(base.omega!);
  });

  test("no downside → omega null (undefined/infinite), reported", () => {
    const r = computeOmegaRatio([1, 2, 3], 0)!;
    expect(r.omega).toBeNull();
    expect(r.downside).toBe(0);
    expect(r.interpretation).toContain("undefined");
  });

  test("sample too small → null", () => {
    expect(computeOmegaRatio([1], 0)).toBeNull();
    expect(computeOmegaRatio([], 0)).toBeNull();
  });
});
