import { describe, expect, test } from "bun:test";
import {
  linearRegression,
  rollingLinearRegression,
  studentTTwoSidedPValue,
} from "./linearRegression.ts";

describe("linearRegression — single fit", () => {
  test("perfect line recovers slope + intercept exactly", () => {
    // y = 2x + 5 over x = 0..9
    const values = Array.from({ length: 10 }, (_, i) => 2 * i + 5);
    const r = linearRegression(values);
    expect(r.slope).toBeCloseTo(2, 6);
    expect(r.intercept).toBeCloseTo(5, 6);
    expect(r.rSquared).toBeCloseTo(1, 6);
    expect(r.standardError).toBeCloseTo(0, 6);
  });

  test("negative slope recovered", () => {
    const values = Array.from({ length: 10 }, (_, i) => -1.5 * i + 100);
    const r = linearRegression(values);
    expect(r.slope).toBeCloseTo(-1.5, 6);
    expect(r.intercept).toBeCloseTo(100, 6);
  });

  test("flat series → slope = 0, R² = 1 (degenerate but valid)", () => {
    const values = [10, 10, 10, 10, 10];
    const r = linearRegression(values);
    expect(r.slope).toBeCloseTo(0, 6);
    expect(r.intercept).toBeCloseTo(10, 6);
    // SST = 0 → R² convention is 1 (perfect fit to a constant).
    expect(r.rSquared).toBe(1);
  });

  test("noisy data — R² between 0 and 1, standardError > 0", () => {
    // Linear trend + bounded noise.
    const values = [5.1, 6.9, 9.2, 11.0, 13.1, 15.0, 17.1];
    const r = linearRegression(values);
    expect(r.rSquared).toBeGreaterThan(0.9);
    expect(r.standardError).toBeGreaterThan(0);
    expect(r.standardError).toBeLessThan(1);
  });

  test("projection at last index uses the fit line", () => {
    const values = Array.from({ length: 5 }, (_, i) => 3 * i + 1);
    const r = linearRegression(values);
    // Projection at x=4: 3*4 + 1 = 13
    expect(r.projectionAtLast).toBeCloseTo(13, 6);
  });

  test("throws on too-short series", () => {
    expect(() => linearRegression([5])).toThrow(/2 points/);
    expect(() => linearRegression([])).toThrow(/2 points/);
  });

  test("throws on non-finite values", () => {
    expect(() => linearRegression([1, 2, NaN, 4])).toThrow(/finite/);
    expect(() => linearRegression([Infinity, 2, 3])).toThrow(/finite/);
  });

  test("n = 2 — standardError collapses to 0", () => {
    const r = linearRegression([1, 3]);
    expect(r.standardError).toBe(0);
  });
});

describe("rollingLinearRegression", () => {
  test("first (windowSize - 1) entries are null", () => {
    const values = [1, 2, 3, 4, 5, 6];
    const r = rollingLinearRegression(values, 3);
    expect(r.slopes[0]).toBeNull();
    expect(r.slopes[1]).toBeNull();
    expect(r.slopes[2]).not.toBeNull();
  });

  test("rolling slopes on a perfect line are all equal to the true slope", () => {
    const values = Array.from({ length: 10 }, (_, i) => 2 * i + 5);
    const r = rollingLinearRegression(values, 4);
    for (let i = 3; i < 10; i++) {
      expect(r.slopes[i]).toBeCloseTo(2, 6);
    }
  });

  test("centerline at each bar equals the regression value at the last point of the window", () => {
    const values = Array.from({ length: 10 }, (_, i) => 3 * i);
    const r = rollingLinearRegression(values, 5);
    // For a perfect line, centerline at bar i = 3 * i (within fp tolerance).
    for (let i = 4; i < 10; i++) {
      expect(r.centerline[i]).toBeCloseTo(3 * i, 5);
    }
  });

  test("R² = 1 throughout for a perfect line", () => {
    const values = Array.from({ length: 8 }, (_, i) => 7 * i - 4);
    const r = rollingLinearRegression(values, 4);
    for (let i = 3; i < 8; i++) {
      expect(r.rSquared[i]).toBeCloseTo(1, 5);
    }
  });

  test("standardError near zero for a perfect line, > 0 with noise", () => {
    const clean = Array.from({ length: 8 }, (_, i) => i);
    const noisy = [0, 0.5, 2.2, 2.8, 4.5, 4.6, 6.4, 7.1];
    const c = rollingLinearRegression(clean, 5);
    const n = rollingLinearRegression(noisy, 5);
    for (let i = 4; i < 8; i++) {
      expect(c.standardErrors[i]!).toBeLessThan(1e-9);
      expect(n.standardErrors[i]!).toBeGreaterThan(0);
    }
  });

  test("throws on invalid windowSize", () => {
    expect(() => rollingLinearRegression([1, 2, 3], 1)).toThrow(/windowSize/);
    expect(() => rollingLinearRegression([1, 2, 3], 0)).toThrow(/windowSize/);
    expect(() => rollingLinearRegression([1, 2, 3], 2.5)).toThrow(/windowSize/);
  });

  test("empty input → empty output arrays", () => {
    const r = rollingLinearRegression([], 5);
    expect(r.slopes).toEqual([]);
    expect(r.centerline).toEqual([]);
  });

  test("windows containing NaN are skipped (result null at that bar)", () => {
    const values = [1, 2, 3, NaN, 5, 6, 7];
    const r = rollingLinearRegression(values, 3);
    // Bar 3 has NaN itself; bars 3, 4, 5 contain NaN in their window → null
    // Bar 6's window is [5, 6, 7] — clean, should have a fit.
    expect(r.slopes[3]).toBeNull();
    expect(r.slopes[6]).not.toBeNull();
  });
});

describe("linearRegression inference (MATH-ANCHOR vs numpy/scipy)", () => {
  // y = [1,3,2,5,4] over x = [0,1,2,3,4]. numpy/scipy reference:
  //   intercept=1.4, slope=0.8
  //   slopeSE=0.34641016, interceptSE=0.84852814
  //   slope t=2.30940108, p=0.10408804
  //   intercept t=1.64991582, p=0.19752339
  //   residual stderr=1.0954451, R²=0.64
  //   Durbin-Watson=3.54444, lag-1 autocorr=-0.84444
  const r = linearRegression([1, 3, 2, 5, 4]);

  test("existing fields stay backward-compatible", () => {
    expect(r.slope).toBeCloseTo(0.8, 6);
    expect(r.intercept).toBeCloseTo(1.4, 6);
    expect(r.rSquared).toBeCloseTo(0.64, 6);
    expect(r.standardError).toBeCloseTo(1.0954451, 5);
    expect(r.n).toBe(5);
  });

  test("coefficient standard errors match reference", () => {
    expect(r.slopeStdError).toBeCloseTo(0.34641016, 5);
    expect(r.interceptStdError).toBeCloseTo(0.84852814, 5);
  });

  test("t-statistics + df match reference", () => {
    expect(r.slopeTStat).toBeCloseTo(2.30940108, 4);
    expect(r.interceptTStat).toBeCloseTo(1.64991582, 4);
    expect(r.degreesOfFreedom).toBe(3);
  });

  test("two-sided p-values match reference", () => {
    expect(r.slopePValue).toBeCloseTo(0.10408804, 4);
    expect(r.interceptPValue).toBeCloseTo(0.19752339, 4);
  });

  test("Durbin-Watson + lag-1 autocorrelation match reference", () => {
    expect(r.durbinWatson).toBeCloseTo(3.5444, 3);
    expect(r.residualAutocorrelation).toBeCloseTo(-0.8444, 3);
  });

  test("interpretation flags non-significant slope + autocorrelation", () => {
    expect(r.interpretation).toContain("NOT significant");
    expect(r.interpretation).toContain("autocorrelation");
  });
});

describe("linearRegression inference — significant slope case", () => {
  test("near-linear trend flags slope significant, no strong autocorrelation", () => {
    const r = linearRegression([1.0, 2.1, 2.9, 4.05, 5.0, 6.02, 6.98, 8.1]);
    expect(r.slopeTStat).not.toBeNull();
    expect(Math.abs(r.slopeTStat!)).toBeGreaterThan(20);
    expect(r.slopePValue!).toBeLessThan(0.001);
    expect(r.interpretation).toContain("slope significant");
    expect(r.interpretation).not.toContain("NOT significant");
  });
});

describe("linearRegression null-on-insufficient-df", () => {
  test("n=2 collapses inference + diagnostics to null", () => {
    const r = linearRegression([1, 2]);
    expect(r.slopeStdError).toBeNull();
    expect(r.slopeTStat).toBeNull();
    expect(r.slopePValue).toBeNull();
    expect(r.degreesOfFreedom).toBeNull();
    expect(r.durbinWatson).toBeNull();
    expect(r.residualAutocorrelation).toBeNull();
    expect(r.interpretation).toContain("undetermined");
  });
});

describe("studentTTwoSidedPValue (MATH-ANCHOR vs scipy)", () => {
  test("matches scipy reference points", () => {
    expect(studentTTwoSidedPValue(2.0, 10)).toBeCloseTo(0.07338803, 5);
    expect(studentTTwoSidedPValue(0, 5)).toBeCloseTo(1.0, 6);
    expect(studentTTwoSidedPValue(10, 20)!).toBeCloseTo(3.1637817e-9, 12);
  });

  test("returns null on invalid df / non-finite t", () => {
    expect(studentTTwoSidedPValue(2, 0)).toBeNull();
    expect(studentTTwoSidedPValue(NaN, 5)).toBeNull();
  });
});
