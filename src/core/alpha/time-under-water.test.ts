import { describe, it, expect } from "bun:test";
import { computeTimeUnderWater } from "./time-under-water.ts";

describe("computeTimeUnderWater", () => {
  it("returns neutral on empty input", () => {
    const r = computeTimeUnderWater({ returns: [] });
    expect(r.maxUnderwaterPeriods).toBe(0);
    expect(r.numEpisodes).toBe(0);
    expect(r.mar).toBeNull();
  });

  it("reports zero underwater for a monotonic-up curve", () => {
    const r = computeTimeUnderWater({ returns: [0.1, 0.1, 0.1] });
    expect(r.pctTimeUnderwater).toBe(0);
    expect(r.numEpisodes).toBe(0);
    expect(r.maxUnderwaterPeriods).toBe(0);
    expect(r.currentlyUnderwater).toBe(false);
  });

  it("measures a completed underwater episode and its recovery", () => {
    // equity: 1 → 1.1 (peak@1) → 0.99 → 0.9405 → 1.1286 (recovers@4)
    const r = computeTimeUnderWater({ returns: [0.1, -0.1, -0.05, 0.2] });
    expect(r.numEpisodes).toBe(1);
    expect(r.currentlyUnderwater).toBe(false);
    const ep = r.episodes[0]!;
    expect(ep.peakIndex).toBe(1);
    expect(ep.recoveryIndex).toBe(4);
    expect(ep.durationPeriods).toBe(3);
    expect(ep.ongoing).toBe(false);
    expect(r.maxUnderwaterPeriods).toBe(3);
    expect(r.pctTimeUnderwater).toBe(0.5); // 2 of 4 periods underwater
    expect(r.maxDrawdownPct).toBeCloseTo((1.1 - 0.9405) / 1.1, 4);
  });

  it("flags an ongoing (unrecovered) underwater spell at series end", () => {
    const r = computeTimeUnderWater({ returns: [0.1, -0.2] }); // 1 → 1.1 → 0.88
    expect(r.currentlyUnderwater).toBe(true);
    expect(r.currentUnderwaterPeriods).toBe(1);
    expect(r.episodes[0]!.ongoing).toBe(true);
    expect(r.episodes[0]!.recoveryIndex).toBeNull();
  });

  it("computes MAR when periodsPerYear is supplied", () => {
    const r = computeTimeUnderWater({ returns: [0.1, -0.1, -0.05, 0.2], periodsPerYear: 252 });
    expect(r.mar).not.toBeNull();
    // MAR = CAGR / maxDD; both finite and positive here.
    expect(typeof r.mar).toBe("number");
  });

  it("counts multiple distinct episodes", () => {
    // down-recover-down-recover
    const r = computeTimeUnderWater({ returns: [0.1, -0.05, 0.06, -0.04, 0.05] });
    expect(r.numEpisodes).toBe(2);
  });
});
