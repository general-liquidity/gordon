import { test, expect, describe } from "bun:test";
import { acf, pacf } from "./autocorrelation.ts";

describe("acf", () => {
  test("lag 0 is exactly 1", () => {
    const series = [1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3, 2];
    const r = acf(series, 4);
    expect(r).not.toBeNull();
    expect(r!.acf[0]).toBe(1);
  });

  test("MATH-ANCHOR: hand-computed ACF lag 1 for a tiny series", () => {
    // Series [2,4,6,8]. mean=5. deviations [-3,-1,1,3].
    // gamma0 = (9+1+1+9)/4 = 5.
    // gamma1 = ((-3)(-1)+(-1)(1)+(1)(3))/4 = (3-1+3)/4 = 5/4 = 1.25.
    // acf1 = 1.25/5 = 0.25.
    const r = acf([2, 4, 6, 8], 1);
    expect(r).not.toBeNull();
    expect(r!.acf[1]).toBeCloseTo(0.25, 6);
  });

  test("confidence band is 1.96/sqrt(n)", () => {
    const series = Array.from({ length: 100 }, (_, i) => Math.sin(i / 5));
    const r = acf(series, 10);
    expect(r!.confidenceBand).toBeCloseTo(1.96 / 10, 4);
  });

  test("white noise ACF stays near zero beyond lag 0", () => {
    // Deterministic pseudo-random sequence for reproducibility.
    let s = 12345;
    const rand = () => {
      s = (1103515245 * s + 12345) % 2147483648;
      return s / 2147483648 - 0.5;
    };
    const series = Array.from({ length: 500 }, () => rand());
    const r = acf(series, 10);
    expect(r).not.toBeNull();
    for (let k = 1; k <= 10; k++) {
      expect(Math.abs(r!.acf[k]!)).toBeLessThan(0.15);
    }
  });

  test("null on short series", () => {
    expect(acf([1, 2], 5)).toBeNull();
  });

  test("null on constant series", () => {
    expect(acf([3, 3, 3, 3, 3, 3], 2)).toBeNull();
  });
});

describe("pacf", () => {
  test("lag 0 is 1 by convention", () => {
    const series = [1, 2, 3, 2, 1, 2, 3, 2, 1, 2, 3, 2];
    const r = pacf(series, 4);
    expect(r!.pacf[0]).toBe(1);
  });

  test("MATH-ANCHOR: PACF lag 1 equals ACF lag 1", () => {
    // Durbin-Levinson: φ[1][1] = ρ[1].
    const series = [2, 4, 6, 8, 5, 3, 7, 9, 4, 6, 8, 2];
    const a = acf(series, 3)!;
    const p = pacf(series, 3)!;
    expect(p.pacf[1]).toBeCloseTo(a.acf[1]!, 6);
  });

  test("AR(1) PACF: cuts off after lag 1", () => {
    // Generate y[t] = 0.7 y[t-1] + noise. PACF should spike at lag 1,
    // then be near zero for lags >= 2.
    let s = 999;
    const rand = () => {
      s = (1103515245 * s + 12345) % 2147483648;
      return s / 2147483648 - 0.5;
    };
    const y: number[] = [0];
    for (let i = 1; i < 600; i++) y.push(0.7 * y[i - 1]! + rand());
    const p = pacf(y, 6)!;
    expect(p.pacf[1]!).toBeGreaterThan(0.5); // strong lag-1
    for (let k = 2; k <= 6; k++) {
      expect(Math.abs(p.pacf[k]!)).toBeLessThan(0.15);
    }
  });

  test("white noise PACF near zero beyond lag 0", () => {
    let s = 4242;
    const rand = () => {
      s = (1103515245 * s + 12345) % 2147483648;
      return s / 2147483648 - 0.5;
    };
    const series = Array.from({ length: 500 }, () => rand());
    const p = pacf(series, 8)!;
    for (let k = 1; k <= 8; k++) {
      expect(Math.abs(p.pacf[k]!)).toBeLessThan(0.15);
    }
  });

  test("null on short series", () => {
    expect(pacf([1, 2, 3], 5)).toBeNull();
  });
});
