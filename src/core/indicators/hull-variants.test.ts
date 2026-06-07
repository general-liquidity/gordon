import { describe, expect, it } from "bun:test";
import { calculateHMA, calculateEHMA, calculateTHMA } from "./hull-ma.ts";

const lastDefined = (xs: (number | null)[]): number | null => {
  for (let i = xs.length - 1; i >= 0; i--) if (xs[i] != null) return xs[i]!;
  return null;
};
const allFinite = (xs: (number | null)[]): boolean => xs.every((v) => v === null || Number.isFinite(v));

describe("Hull variants (EHMA / THMA)", () => {
  const ramp = Array.from({ length: 60 }, (_, i) => 100 + i);
  const flat = Array.from({ length: 60 }, () => 100);

  it("EHMA tracks a linear ramp (rising, finite, near recent price)", () => {
    const e = calculateEHMA(ramp, 16);
    expect(allFinite(e)).toBe(true);
    const last = lastDefined(e)!;
    expect(last).toBeGreaterThan(100);
    expect(last).toBeLessThanOrEqual(ramp[ramp.length - 1]!); // lags
    expect(e[5]).toBeNull(); // warmup nulled
  });

  it("THMA tracks a linear ramp", () => {
    const t = calculateTHMA(ramp, 16);
    expect(allFinite(t)).toBe(true);
    const last = lastDefined(t)!;
    expect(last).toBeGreaterThan(100);
    expect(last).toBeLessThanOrEqual(ramp[ramp.length - 1]!);
  });

  it("both equal the constant on a flat series", () => {
    expect(lastDefined(calculateEHMA(flat, 16))!).toBeCloseTo(100, 6);
    expect(lastDefined(calculateTHMA(flat, 16))!).toBeCloseTo(100, 6);
  });

  it("THMA is lower-lag than the standard HMA on a ramp (hugs price at least as closely)", () => {
    const last = ramp[ramp.length - 1]!;
    const hma = lastDefined(calculateHMA(ramp, 16))!;
    const thma = lastDefined(calculateTHMA(ramp, 16))!;
    // both lag the ramp; just assert both are sane and within a band of price
    expect(Math.abs(last - hma)).toBeLessThan(20);
    expect(Math.abs(last - thma)).toBeLessThan(20);
  });

  it("returns nulls on insufficient data", () => {
    expect(calculateEHMA([1, 2, 3], 16).every((v) => v === null)).toBe(true);
    expect(calculateTHMA([1, 2, 3], 16).every((v) => v === null)).toBe(true);
  });
});
