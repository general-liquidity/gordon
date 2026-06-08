import { describe, expect, it } from "bun:test";
import { computePopulationStability, computeVaRBacktest } from "./riskModelValidation.ts";

describe("computePopulationStability", () => {
  const ref = Array.from({ length: 500 }, (_, i) => i / 50); // 0..10, uniform-ish

  it("≈0 PSI when the distribution is unchanged (stable)", () => {
    const r = computePopulationStability({ expected: ref, actual: [...ref], bins: 10 });
    expect(r.psi).toBeLessThan(0.1);
    expect(r.verdict).toBe("stable");
  });

  it("large PSI under a hard distribution shift (significant)", () => {
    const shifted = ref.map((x) => x + 6); // move well past the reference range
    const r = computePopulationStability({ expected: ref, actual: shifted, bins: 10 });
    expect(r.psi).toBeGreaterThan(0.25);
    expect(r.verdict).toBe("significant_shift");
  });

  it("PSI increases monotonically with shift size", () => {
    const small = computePopulationStability({ expected: ref, actual: ref.map((x) => x + 0.5), bins: 10 }).psi;
    const big = computePopulationStability({ expected: ref, actual: ref.map((x) => x + 3), bins: 10 }).psi;
    expect(big).toBeGreaterThan(small);
  });

  it("insufficient on too little data", () => {
    expect(computePopulationStability({ expected: [1, 2], actual: [1], bins: 10 }).verdict).toBe("insufficient");
  });
});

describe("computeVaRBacktest", () => {
  const N = 1000;
  const VAR = 0.03; // constant 99% VaR (loss magnitude)

  // Helper: returns array with breaches (return < -VAR) at the given indices, else benign.
  const build = (breachIdx: Set<number>): number[] =>
    Array.from({ length: N }, (_, i) => (breachIdx.has(i) ? -0.05 : 0.001));

  it("well-calibrated: ~1% violations, spread out → both tests pass", () => {
    const idx = new Set(Array.from({ length: 10 }, (_, k) => k * 100)); // 10 breaches, every 100 bars
    const r = computeVaRBacktest({ returns: build(idx), varForecasts: new Array(N).fill(VAR), confidence: 0.99 });
    expect(r.violations).toBe(10);
    expect(r.kupiecReject).toBe(false);
    expect(r.independenceReject).toBe(false);
    expect(r.verdict).toBe("well_calibrated");
  });

  it("rate miscalibrated: way too many violations → Kupiec rejects", () => {
    const idx = new Set(Array.from({ length: 50 }, (_, k) => k * 20)); // 50 breaches (5% vs 1%)
    const r = computeVaRBacktest({ returns: build(idx), varForecasts: new Array(N).fill(VAR), confidence: 0.99 });
    expect(r.violations).toBe(50);
    expect(r.kupiecReject).toBe(true);
  });

  it("clustered: right count but consecutive → Christoffersen independence rejects", () => {
    const idx = new Set(Array.from({ length: 10 }, (_, k) => 500 + k)); // 10 consecutive breaches
    const r = computeVaRBacktest({ returns: build(idx), varForecasts: new Array(N).fill(VAR), confidence: 0.99 });
    expect(r.violations).toBe(10);
    expect(r.kupiecReject).toBe(false); // rate is fine
    expect(r.independenceReject).toBe(true); // but clustered
    expect(r.verdict).toBe("violations_clustered");
  });

  it("insufficient on too little data", () => {
    expect(computeVaRBacktest({ returns: [0.01, -0.02], varForecasts: [0.03, 0.03] }).verdict).toBe("insufficient");
  });
});
