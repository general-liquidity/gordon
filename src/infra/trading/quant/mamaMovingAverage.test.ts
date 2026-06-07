import { describe, expect, it } from "bun:test";
import { computeMAMA } from "./mamaMovingAverage.ts";

const allFinite = (xs: (number | null)[]): boolean =>
  xs.every((v) => v === null || Number.isFinite(v));

describe("computeMAMA", () => {
  it("equals the price on a constant series (adaptive filter of a constant)", () => {
    const r = computeMAMA({ values: Array.from({ length: 40 }, () => 100) });
    expect(r.current.mama).toBeCloseTo(100, 4);
    expect(r.current.fama).toBeCloseTo(100, 4);
    expect(r.cross).toBe("none");
  });

  it("MAMA leads FAMA on a sustained uptrend (both lag price, MAMA closer)", () => {
    const values = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = computeMAMA({ values });
    expect(r.current.mama!).toBeGreaterThan(r.current.fama!); // MAMA above FAMA in an uptrend
    expect(r.current.mama!).toBeGreaterThan(100);
    expect(r.current.mama!).toBeLessThanOrEqual(values[values.length - 1]!); // lags price
    expect(allFinite(r.mama)).toBe(true);
    expect(allFinite(r.fama)).toBe(true);
  });

  it("MAMA trails FAMA (below) on a sustained downtrend", () => {
    const values = Array.from({ length: 60 }, (_, i) => 200 - i);
    const r = computeMAMA({ values });
    expect(r.current.mama!).toBeLessThan(r.current.fama!);
    expect(allFinite(r.mama)).toBe(true);
  });

  it("never produces NaN/Infinity even on a noisy series", () => {
    const values = Array.from({ length: 80 }, (_, i) => 100 + Math.sin(i) * 5 + (i % 7));
    const r = computeMAMA({ values });
    expect(allFinite(r.mama)).toBe(true);
    expect(allFinite(r.fama)).toBe(true);
    expect(Number.isFinite(r.current.mama!)).toBe(true);
  });

  it("is neutral on short input", () => {
    const r = computeMAMA({ values: [1, 2, 3] });
    expect(r.current.mama).toBeNull();
    expect(r.cross).toBe("none");
  });
});
