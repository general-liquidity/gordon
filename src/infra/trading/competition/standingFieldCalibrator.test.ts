import { describe, expect, test } from "bun:test";
import { calibrateReturnField, calibrateMetricField } from "./standingFieldCalibrator.ts";

describe("calibrateReturnField", () => {
  test("known inputs → exact sample mean + Bessel std", () => {
    // [0.1, 0.2, 0.3]: mean 0.2; var = (0.01 + 0 + 0.01)/(3-1) = 0.01 → std 0.1
    const f = calibrateReturnField([0.1, 0.2, 0.3]);
    expect(f.mean).toBeCloseTo(0.2, 12);
    expect(f.std).toBeCloseTo(0.1, 12);
    expect(f.n).toBe(3);
  });

  test("two values → exact Bessel std", () => {
    // [0.0, 0.4]: mean 0.2; var = (0.04 + 0.04)/1 = 0.08 → std sqrt(0.08)
    const f = calibrateReturnField([0.0, 0.4]);
    expect(f.mean).toBeCloseTo(0.2, 12);
    expect(f.std).toBeCloseTo(Math.sqrt(0.08), 12);
    expect(f.n).toBe(2);
  });

  test("single finite value → default field with n=1", () => {
    expect(calibrateReturnField([0.5])).toEqual({ mean: 0, std: 0.4, n: 1 });
  });

  test("empty input → default field with n=1", () => {
    expect(calibrateReturnField([])).toEqual({ mean: 0, std: 0.4, n: 1 });
  });

  test("non-finite values filtered out before counting + estimating", () => {
    // NaN/Inf dropped → effective sample [0.1, 0.2, 0.3]
    const f = calibrateReturnField([NaN, 0.1, Infinity, 0.2, -Infinity, 0.3]);
    expect(f.mean).toBeCloseTo(0.2, 12);
    expect(f.std).toBeCloseTo(0.1, 12);
    expect(f.n).toBe(3);
  });

  test("only one finite value after filtering → default with n=1", () => {
    const f = calibrateReturnField([NaN, 0.7, Infinity]);
    expect(f).toEqual({ mean: 0, std: 0.4, n: 1 });
  });
});

describe("calibrateMetricField", () => {
  const fallback = { mean: -0.01, std: 0.04 };

  test("known inputs → exact sample mean + Bessel std", () => {
    // [0.04, 0.06]: mean 0.05; var = (0.0001 + 0.0001)/1 = 0.0002 → std sqrt(0.0002)
    const f = calibrateMetricField([0.04, 0.06], fallback);
    expect(f.mean).toBeCloseTo(0.05, 12);
    expect(f.std).toBeCloseTo(Math.sqrt(0.0002), 12);
  });

  test("sparse input (<2 finite) → fallback", () => {
    expect(calibrateMetricField([0.05], fallback)).toBe(fallback);
    expect(calibrateMetricField([], fallback)).toBe(fallback);
  });

  test("non-finite values filtered out", () => {
    const f = calibrateMetricField([NaN, 0.04, Infinity, 0.06], fallback);
    expect(f.mean).toBeCloseTo(0.05, 12);
    expect(f.std).toBeCloseTo(Math.sqrt(0.0002), 12);
  });

  test("only one finite value after filtering → fallback", () => {
    expect(calibrateMetricField([NaN, 0.3, Infinity], fallback)).toBe(fallback);
  });
});
