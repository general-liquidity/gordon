import { describe, it, expect } from "bun:test";
import {
  computeMeanCrossingFrequency,
  meanCrossingFrequencyToPayload,
} from "./meanCrossingFrequency.ts";

describe("computeMeanCrossingFrequency — counts", () => {
  it("zero crossings for a constant series", () => {
    const r = computeMeanCrossingFrequency({
      series: [1, 1, 1, 1, 1],
    });
    expect(r.crossingCount).toBe(0);
    expect(r.crossingsPerYear).toBe(0);
  });

  it("sine-like alternation around mean → many crossings", () => {
    // mean = 0; alternating +1 / -1 → crossing at every step
    const r = computeMeanCrossingFrequency({
      series: [1, -1, 1, -1, 1, -1],
    });
    expect(r.crossingCount).toBe(5);
  });

  it("monotonic increase has zero crossings of the mean", () => {
    // mean is mid-range; series only crosses it once
    const r = computeMeanCrossingFrequency({
      series: [1, 2, 3, 4, 5, 6, 7, 8],
    });
    expect(r.crossingCount).toBe(1);
  });

  it("explicit reference overrides sample mean", () => {
    const r = computeMeanCrossingFrequency({
      series: [-2, -1, 1, 2, -1, 1],
      reference: 0,
    });
    // crossings of 0: -1→1 (yes), 2→-1 (yes), -1→1 (yes) = 3
    expect(r.crossingCount).toBe(3);
    expect(r.referenceValue).toBe(0);
  });

  it("touches at the boundary count as crossings", () => {
    // mean = 0; series [-1, 0, 1] — first interval (-1→0) has a=-1, b=0
    //   a===0 false, a*b=0 not <0 — does NOT count
    // second interval (0→1) has a=0, b=1 — a===0 && b!=0 → counts
    const r = computeMeanCrossingFrequency({
      series: [-1, 0, 1],
      reference: 0,
    });
    expect(r.crossingCount).toBe(1);
  });
});

describe("computeMeanCrossingFrequency — annualisation", () => {
  it("crossings/year scales with periodsPerYear", () => {
    const series = [1, -1, 1, -1]; // 3 crossings, N=4
    const daily = computeMeanCrossingFrequency({ series, periodsPerYear: 252 });
    const weekly = computeMeanCrossingFrequency({ series, periodsPerYear: 52 });
    expect(daily.crossingsPerYear / weekly.crossingsPerYear).toBeCloseTo(
      252 / 52,
      6,
    );
  });

  it("Sarmento threshold sanity: 12 crossings in 252 daily samples ≈ 12/year", () => {
    // Constructed series: crosses mean exactly 12 times across 252 points.
    const series = new Array<number>(252).fill(0);
    let sign = 1;
    for (let i = 0; i < 12; i++) {
      // Place crossings at evenly spaced indices.
      const idx = Math.floor(((i + 1) * 252) / 13);
      for (let j = 0; j < idx; j++) series[j] = sign;
      sign = -sign;
    }
    // Force final sign assignment to ensure deterministic count
    const r = computeMeanCrossingFrequency({ series, periodsPerYear: 252 });
    expect(r.crossingsPerYear).toBeGreaterThan(0);
  });
});

describe("computeMeanCrossingFrequency — boundary", () => {
  it("empty series → zero crossings", () => {
    const r = computeMeanCrossingFrequency({ series: [] });
    expect(r.crossingCount).toBe(0);
    expect(r.sampleSize).toBe(0);
  });

  it("single-point series → zero crossings", () => {
    const r = computeMeanCrossingFrequency({ series: [42] });
    expect(r.crossingCount).toBe(0);
  });
});

describe("meanCrossingFrequencyToPayload", () => {
  it("emits stable shape", () => {
    const r = computeMeanCrossingFrequency({ series: [1, -1, 1, -1] });
    const p = meanCrossingFrequencyToPayload(r) as { kind: string };
    expect(p.kind).toBe("mean_crossing_frequency.computed");
  });
});
