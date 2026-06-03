import { describe, expect, it } from "bun:test";
import { computeControlChart } from "./control-chart.ts";

describe("computeControlChart", () => {
  it("returns neutral on insufficient input", () => {
    const r = computeControlChart({ values: [1] });
    expect(r.sigma).toBe(0);
    expect(r.inControl).toBe(true);
    expect(r.signals.length).toBe(0);
    expect(r.interpretation).toContain("Neutral");
  });

  it("returns neutral when the baseline has zero variation", () => {
    const r = computeControlChart({ values: [5, 5, 5, 5] });
    expect(r.sigma).toBe(0);
    expect(r.interpretation).toContain("zero variation");
  });

  it("reports in-control for stationary common-cause noise", () => {
    // Alternating ±1 around 0: moving range constant (=2), no point near 3σ.
    const values = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
    const r = computeControlChart({ values });
    expect(r.centerLine).toBe(0);
    expect(r.inControl).toBe(true);
    expect(r.signals.length).toBe(0);
    expect(r.interpretation).toContain("common-cause");
  });

  it("flags rule 1 — a single point beyond 3σ", () => {
    // Tight baseline then one spike. R̄≈ small, the spike is many σ out.
    const baseline = [10, 10.1, 9.9, 10, 10.05, 9.95, 10, 10.1, 9.9, 10];
    const values = [...baseline, 25];
    const r = computeControlChart({ values, baseline });
    const last = r.signals.find((s) => s.index === values.length - 1);
    expect(last).toBeDefined();
    expect(last!.rules).toContain("beyond_3sigma");
    expect(last!.side).toBe("above");
    expect(r.inControl).toBe(false);
  });

  it("flags rule 4 — a run of eight on one side of the center line", () => {
    // Center estimated from a balanced baseline; then 8 consecutive below it.
    const baseline = [1, -1, 1, -1, 1, -1, 1, -1];
    const drift = [-0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5, -0.5];
    const values = [...baseline, ...drift];
    const r = computeControlChart({ values, baseline });
    const runSignal = r.signals.find((s) => s.rules.includes("run_of_eight"));
    expect(runSignal).toBeDefined();
    expect(runSignal!.side).toBe("below");
  });

  it("flags rule 3 — four of five beyond 1σ on the same side", () => {
    const baseline = [1, -1, 1, -1, 1, -1, 1, -1, 1, -1];
    // σ̂ from R̄ = 2/1.128 ≈ 1.773; values ~2 are >1σ above center 0.
    const values = [...baseline, 2, 2, 2, -0.2, 2];
    const r = computeControlChart({ values, baseline });
    const sig = r.signals.find((s) => s.rules.includes("four_of_five_1sigma"));
    expect(sig).toBeDefined();
    expect(sig!.side).toBe("above");
  });

  it("computes center ± 3σ limits and catches a monotonic trend as special cause", () => {
    const values = Array.from({ length: 20 }, (_, i) => i);
    const r = computeControlChart({ values });
    expect(r.upperControlLimit).toBeCloseTo(r.centerLine + 3 * r.sigma, 4);
    expect(r.lowerControlLimit).toBeCloseTo(r.centerLine - 3 * r.sigma, 4);
    // A ramp is non-stationary: the first half sits below the mean and the
    // second above, so the run-of-eight rule must fire — a trend is assignable.
    expect(r.inControl).toBe(false);
    expect(r.signals.some((s) => s.rules.includes("run_of_eight"))).toBe(true);
  });
});
