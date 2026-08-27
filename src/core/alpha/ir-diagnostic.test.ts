import { describe, it, expect } from "bun:test";
import { computeIrDiagnostic } from "./ir-diagnostic.ts";
import type { IcSnapshot } from "./ic-tracker.ts";

function snap(
  name: string,
  ic: number,
  verdict: IcSnapshot["verdict"] = "active",
  halfWidth = 0.05,
): IcSnapshot {
  return {
    signalName: name,
    ic,
    method: "pearson",
    sampleSize: 100,
    subWindowsUsed: 5,
    subWindowMeanIc: ic,
    subWindowIcStd: 0.02,
    cvIc: 0.2,
    trendSlope: 0,
    ic95HalfWidth: halfWidth,
    verdict,
    summary: `${name}: ${ic}`,
  };
}

describe("computeIrDiagnostic — verdicts", () => {
  it("returns insufficient_data when no usable signals", () => {
    const result = computeIrDiagnostic([], 0);
    expect(result.verdict).toBe("insufficient_data");
  });

  it("returns insufficient_data when all signals are noise (excluded)", () => {
    const result = computeIrDiagnostic([snap("a", 0.01, "noise"), snap("b", 0.005, "noise")], 2);
    expect(result.verdict).toBe("insufficient_data");
    expect(result.signalsUsed).toBe(0);
    expect(result.signalsExcluded.length).toBe(2);
  });

  it("includes inactive signals when excludeInactive=false", () => {
    const result = computeIrDiagnostic([snap("a", 0.05, "noise"), snap("b", 0.05, "active")], 2, {
      excludeInactive: false,
    });
    expect(result.signalsUsed).toBe(2);
    expect(result.signalsExcluded.length).toBe(0);
  });

  it("computes weak verdict for low IR", () => {
    const result = computeIrDiagnostic([snap("a", 0.05)], 1);
    // IR = 0.05 × √1 = 0.05 < 0.25 → weak
    expect(result.estimatedIr).toBeCloseTo(0.05, 3);
    expect(result.verdict).toBe("weak");
  });

  it("computes moderate verdict at IR ~0.35", () => {
    const result = computeIrDiagnostic([snap("a", 0.1), snap("b", 0.1)], 12);
    // IR = 0.10 × √12 ≈ 0.346
    expect(result.estimatedIr).toBeCloseTo(0.346, 2);
    expect(result.verdict).toBe("moderate");
  });

  it("computes strong verdict at IR ~0.8", () => {
    const result = computeIrDiagnostic([snap("a", 0.1), snap("b", 0.1)], 64);
    // IR = 0.10 × 8 = 0.8
    expect(result.estimatedIr).toBeCloseTo(0.8, 2);
    expect(result.verdict).toBe("strong");
  });

  it("computes exceptional verdict at IR ≥ 1.0", () => {
    const result = computeIrDiagnostic([snap("a", 0.15), snap("b", 0.15)], 50);
    // IR = 0.15 × √50 ≈ 1.06
    expect(result.estimatedIr).toBeGreaterThan(1.0);
    expect(result.verdict).toBe("exceptional");
  });
});

describe("computeIrDiagnostic — mean IC", () => {
  it("averages absolute IC values", () => {
    const result = computeIrDiagnostic([snap("a", 0.1), snap("b", -0.1), snap("c", 0.05)], 3);
    // |0.10| + |-0.10| + |0.05| = 0.25, mean = 0.0833
    expect(result.meanAbsIc).toBeCloseTo(0.083, 2);
  });

  it("computes dispersion across signals", () => {
    const result = computeIrDiagnostic([snap("a", 0.05), snap("b", 0.15)], 2);
    expect(result.icDispersion).toBeGreaterThan(0);
  });
});

describe("computeIrDiagnostic — IR 95% CI", () => {
  it("returns non-zero CI half-width when half-widths are non-zero", () => {
    const result = computeIrDiagnostic(
      [snap("a", 0.1, "active", 0.05), snap("b", 0.1, "active", 0.05)],
      10,
    );
    expect(result.ir95HalfWidth).toBeGreaterThan(0);
  });

  it("CI scales with √N", () => {
    const lowN = computeIrDiagnostic([snap("a", 0.1, "active", 0.05)], 1);
    const highN = computeIrDiagnostic([snap("a", 0.1, "active", 0.05)], 25);
    // CI at N=25 should be 5× CI at N=1 (sqrt scaling)
    expect(highN.ir95HalfWidth).toBeGreaterThan(lowN.ir95HalfWidth);
  });
});

describe("computeIrDiagnostic — exclusion", () => {
  it("excludes signals with verdict=decaying", () => {
    const result = computeIrDiagnostic([snap("a", 0.1, "active"), snap("b", 0.1, "decaying")], 2);
    expect(result.signalsUsed).toBe(1);
    expect(result.signalsExcluded.length).toBe(1);
    expect(result.signalsExcluded[0]!).toContain("decaying");
  });

  it("excludes signals with verdict=unstable", () => {
    const result = computeIrDiagnostic([snap("a", 0.1, "active"), snap("b", 0.1, "unstable")], 2);
    expect(result.signalsUsed).toBe(1);
  });

  it("excludes signals with null IC", () => {
    const result = computeIrDiagnostic(
      [snap("a", 0.1, "active"), { ...snap("b", 0, "insufficient_data"), ic: null }],
      2,
    );
    expect(result.signalsUsed).toBe(1);
    expect(result.signalsExcluded[0]!).toContain("null IC");
  });
});

describe("computeIrDiagnostic — summary text", () => {
  it("summary includes IR value, CI, and verdict", () => {
    const result = computeIrDiagnostic([snap("a", 0.1)], 4);
    expect(result.summary).toContain("IR");
    expect(result.summary).toContain(result.verdict);
  });
});
