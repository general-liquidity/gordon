import { describe, it, expect } from "bun:test";
import { computeExposureEfficiency } from "./exposure-efficiency.ts";

describe("computeExposureEfficiency", () => {
  it("returns neutral on empty input", () => {
    const r = computeExposureEfficiency({ returns: [] });
    expect(r.timeInMarketFraction).toBe(0);
    expect(r.returnPerExposureUnit).toBe(0);
    expect(r.annualizedReturnPerExposure).toBeNull();
    expect(r.sampleSize).toBe(0);
  });

  it("infers exposure from non-zero returns when exposure is omitted", () => {
    // flat periods (r=0) are treated as out-of-market: exposure = [1,0,0,1]
    const r = computeExposureEfficiency({ returns: [0.1, 0, 0, 0.1] });
    expect(r.exposurePeriods).toBe(2);
    expect(r.timeInMarketFraction).toBe(0.5);
    expect(r.totalReturn).toBeCloseTo(0.21, 6); // 1.1 * 1.1 - 1
    expect(r.returnPerExposureUnit).toBeCloseTo(0.42, 6); // 0.21 / 0.5
    expect(r.leakingExposureFraction).toBe(0); // flat periods are not exposed
  });

  it("normalizes return by explicit binary exposure and flags leaking time", () => {
    const r = computeExposureEfficiency({
      returns: [0.05, -0.02, 0.0, 0.03],
      exposure: [1, 1, 0, 1],
    });
    expect(r.exposurePeriods).toBe(3);
    expect(r.timeInMarketFraction).toBe(0.75);
    expect(r.totalReturn).toBeCloseTo(1.05 * 0.98 * 1.03 - 1, 6);
    expect(r.returnPerExposureUnit).toBeCloseTo(r.totalReturn / 0.75, 6);
    // one exposed, non-positive period (the -0.02), out of three exposed periods
    expect(r.leakingExposureFraction).toBeCloseTo(1 / 3, 6);
    expect(r.returnDragFromLeak).toBeCloseTo(-0.02, 6);
  });

  it("honors fractional exposure (partial sizing)", () => {
    const r = computeExposureEfficiency({
      returns: [0.04, 0.04],
      exposure: [0.5, 0.5],
    });
    expect(r.exposurePeriods).toBe(1);
    expect(r.timeInMarketFraction).toBe(0.5);
    expect(r.totalReturn).toBeCloseTo(1.04 * 1.04 - 1, 6);
    expect(r.returnPerExposureUnit).toBeCloseTo(r.totalReturn / 0.5, 6);
  });

  it("supports simple (additive) return mode", () => {
    const r = computeExposureEfficiency({
      returns: [0.1, -0.1, 0.1],
      exposure: [1, 1, 1],
      compoundMode: "simple",
    });
    expect(r.totalReturn).toBeCloseTo(0.1, 6);
    expect(r.timeInMarketFraction).toBe(1);
    expect(r.returnPerExposureUnit).toBeCloseTo(0.1, 6);
    expect(r.leakingExposureFraction).toBeCloseTo(1 / 3, 6);
    expect(r.returnDragFromLeak).toBeCloseTo(-0.1, 6);
  });

  it("annualizes the in-market rate when periodsPerYear is supplied", () => {
    const r = computeExposureEfficiency({
      returns: [0.01, 0.0, 0.01, 0.0],
      exposure: [1, 0, 1, 0],
      periodsPerYear: 252,
    });
    expect(r.annualizedReturnPerExposure).not.toBeNull();
    expect(typeof r.annualizedReturnPerExposure).toBe("number");
  });

  it("reports never-in-market when exposure is all zero", () => {
    const r = computeExposureEfficiency({
      returns: [0.0, 0.0],
      exposure: [0, 0],
    });
    expect(r.exposurePeriods).toBe(0);
    expect(r.timeInMarketFraction).toBe(0);
    expect(r.returnPerExposureUnit).toBe(0);
    expect(r.annualizedReturnPerExposure).toBeNull();
    expect(r.interpretation).toContain("Never in market");
  });

  it("surfaces the inactivity premium when most of the window is out of market", () => {
    // in market 25% of the time, all positive: returnPerExposureUnit > totalReturn
    const r = computeExposureEfficiency({
      returns: [0.08, 0, 0, 0],
      exposure: [1, 0, 0, 0],
    });
    expect(r.timeInMarketFraction).toBe(0.25);
    expect(r.returnPerExposureUnit).toBeGreaterThan(r.totalReturn);
    expect(r.interpretation).toContain("Inactivity premium");
  });

  it("throws when exposure length does not match returns", () => {
    expect(() => computeExposureEfficiency({ returns: [0.1, 0.2], exposure: [1] })).toThrow(
      "exposure length must equal returns length",
    );
  });

  it("throws when exposure is outside [0, 1]", () => {
    expect(() => computeExposureEfficiency({ returns: [0.1], exposure: [1.5] })).toThrow(
      "exposure must be within [0, 1]",
    );
  });
});
