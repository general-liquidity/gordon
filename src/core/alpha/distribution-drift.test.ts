import { describe, expect, it } from "bun:test";
import { computePSI } from "./distribution-drift.ts";

const seq = (n: number, start = 0) => Array.from({ length: n }, (_, i) => start + i);

describe("computePSI", () => {
  it("reports ~0 / stable for an unchanged distribution", () => {
    const base = seq(100);
    const r = computePSI(base, base)!;
    expect(r.psi).toBeLessThan(0.1);
    expect(r.verdict).toBe("stable");
    expect(r.bins).toBe(10);
  });

  it("flags a significant shift when the sample moves off the baseline support", () => {
    const r = computePSI(seq(100), seq(100, 500))!; // current entirely above baseline
    expect(r.verdict).toBe("significant_shift");
    expect(r.psi).toBeGreaterThan(0.25);
    expect(r.summary).toContain("significant");
  });

  it("does not flag a small shift as significant", () => {
    const r = computePSI(seq(100), seq(100, 5))!; // shifted by +5 only
    expect(r.psi).toBeLessThan(0.25);
    expect(r.verdict).not.toBe("significant_shift");
  });

  it("per-bin contributions sum to the total PSI and name where the drift is", () => {
    const r = computePSI(seq(100), seq(100, 500))!;
    const sum = r.perBin.reduce((s, b) => s + b.contribution, 0);
    expect(sum).toBeCloseTo(r.psi, 9);
    expect(r.perBin).toHaveLength(10);
    // open-ended outer bins
    expect(r.perBin[0]!.range[0]).toBe(-Infinity);
    expect(r.perBin[9]!.range[1]).toBe(Infinity);
  });

  it("returns null for degenerate input", () => {
    expect(computePSI(seq(5), seq(100))).toBeNull(); // baseline smaller than bins
    expect(computePSI(seq(100), [])).toBeNull(); // empty current
  });
});
