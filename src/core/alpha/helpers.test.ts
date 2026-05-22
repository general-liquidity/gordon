import { describe, it, expect } from "bun:test";
import {
  pearsonCorrelation,
  sampleStd,
  trendSlope,
  ci95HalfWidth,
  coefficientOfVariation,
  mean,
} from "./helpers.ts";

describe("pearsonCorrelation", () => {
  it("computes perfect positive correlation", () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [2, 4, 6, 8, 10]))!.toBeCloseTo(1, 6);
  });

  it("computes perfect negative correlation", () => {
    expect(pearsonCorrelation([1, 2, 3, 4, 5], [5, 4, 3, 2, 1]))!.toBeCloseTo(-1, 6);
  });

  it("computes zero correlation for orthogonal series", () => {
    const result = pearsonCorrelation([1, 2, 3, 4, 5], [1, 2, 1, 2, 1.5]);
    expect(result).not.toBeNull();
    expect(Math.abs(result!)).toBeLessThan(0.5);
  });

  it("returns null for length mismatch", () => {
    expect(pearsonCorrelation([1, 2, 3], [1, 2])).toBeNull();
  });

  it("returns null for n < 3", () => {
    expect(pearsonCorrelation([1, 2], [3, 4])).toBeNull();
  });

  it("returns null for constant series", () => {
    expect(pearsonCorrelation([5, 5, 5, 5], [1, 2, 3, 4])).toBeNull();
  });

  it("returns null for non-finite values", () => {
    expect(pearsonCorrelation([1, NaN, 3], [4, 5, 6])).toBeNull();
    expect(pearsonCorrelation([1, 2, 3], [Infinity, 5, 6])).toBeNull();
  });
});

describe("sampleStd", () => {
  it("computes Bessel-corrected std", () => {
    // [2, 4, 4, 4, 5, 5, 7, 9] → s = 2.138 (well-known textbook example)
    expect(sampleStd([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 2);
  });

  it("returns 0 for length < 2", () => {
    expect(sampleStd([])).toBe(0);
    expect(sampleStd([5])).toBe(0);
  });

  it("returns 0 for constant array", () => {
    expect(sampleStd([3, 3, 3, 3])).toBe(0);
  });
});

describe("trendSlope", () => {
  it("returns positive slope for ascending series", () => {
    expect(trendSlope([1, 2, 3, 4, 5])).toBeCloseTo(1, 6);
  });

  it("returns negative slope for descending series", () => {
    expect(trendSlope([5, 4, 3, 2, 1])).toBeCloseTo(-1, 6);
  });

  it("returns 0 for constant series", () => {
    expect(trendSlope([3, 3, 3, 3])).toBe(0);
  });

  it("returns 0 for n < 2", () => {
    expect(trendSlope([])).toBe(0);
    expect(trendSlope([7])).toBe(0);
  });
});

describe("ci95HalfWidth", () => {
  it("returns 1.96 × se", () => {
    expect(ci95HalfWidth(1, 100)).toBeCloseTo(0.196, 3);
  });

  it("returns 0 for n < 2", () => {
    expect(ci95HalfWidth(1, 0)).toBe(0);
    expect(ci95HalfWidth(1, 1)).toBe(0);
  });
});

describe("coefficientOfVariation", () => {
  it("returns |std/mean|", () => {
    expect(coefficientOfVariation(10, 2)).toBeCloseTo(0.2, 6);
  });

  it("returns Infinity when mean is 0", () => {
    expect(coefficientOfVariation(0, 1)).toBe(Infinity);
  });

  it("returns positive value for negative mean", () => {
    expect(coefficientOfVariation(-10, 2)).toBeCloseTo(0.2, 6);
  });
});

describe("mean", () => {
  it("computes arithmetic mean", () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
  });

  it("returns 0 for empty array", () => {
    expect(mean([])).toBe(0);
  });
});
