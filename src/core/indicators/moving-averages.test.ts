import { describe, expect, test } from "bun:test";
import { calculateWMA, calculateDEMA, calculateTEMA, calculateTRIMA } from "./moving-averages.ts";

describe("WMA", () => {
  test("WMA of [1,2,3] period 3 = (1*1 + 2*2 + 3*3)/6 = 14/6", () => {
    const out = calculateWMA([1, 2, 3], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(14 / 6, 4); // WMA rounds to 4 dp
  });

  test("rolls forward: next bar [2,3,4] = (2 + 6 + 12)/6 = 20/6", () => {
    const out = calculateWMA([1, 2, 3, 4], 3);
    expect(out[3]).toBeCloseTo(20 / 6, 4);
  });

  test("flat series → WMA equals the constant", () => {
    const out = calculateWMA([5, 5, 5, 5], 3);
    expect(out[3]).toBeCloseTo(5, 6);
  });

  test("insufficient data → all null", () => {
    expect(calculateWMA([1, 2], 3).every((v) => v === null)).toBe(true);
  });
});

describe("DEMA / TEMA", () => {
  test("constant series → DEMA and TEMA equal the constant once warm", () => {
    const closes = new Array(20).fill(10);
    const dema = calculateDEMA(closes, 5);
    const tema = calculateTEMA(closes, 5);
    expect(dema[dema.length - 1]).toBeCloseTo(10, 4);
    expect(tema[tema.length - 1]).toBeCloseTo(10, 4);
  });

  test("DEMA tracks a linear ramp closer than the raw EMA lag (reduces lag)", () => {
    const closes = Array.from({ length: 40 }, (_, i) => i + 1);
    const dema = calculateDEMA(closes, 10);
    const last = dema[dema.length - 1]!;
    // On a steady ramp, DEMA should sit very near the latest price (40), much
    // closer than a single EMA which lags well below it.
    expect(last).toBeGreaterThan(38);
    expect(last).toBeLessThanOrEqual(41);
  });

  test("insufficient data → all null", () => {
    expect(calculateDEMA([1, 2, 3], 5).every((v) => v === null)).toBe(true);
    expect(calculateTEMA([1, 2, 3], 5).every((v) => v === null)).toBe(true);
  });
});

describe("TRIMA", () => {
  test("odd period 3: inner=outer=2 SMA-of-SMA on [1,2,3,4]", () => {
    // period 3 (odd) → firstLen=2, secondLen=2.
    // inner SMA(2): [-, 1.5, 2.5, 3.5]; outer SMA(2): [-, -, 2.0, 3.0]
    const out = calculateTRIMA([1, 2, 3, 4], 3);
    expect(out[0]).toBeNull();
    expect(out[1]).toBeNull();
    expect(out[2]).toBeCloseTo(2.0, 6);
    expect(out[3]).toBeCloseTo(3.0, 6);
  });

  test("constant series → TRIMA equals the constant", () => {
    const out = calculateTRIMA([7, 7, 7, 7, 7], 4);
    expect(out[out.length - 1]).toBeCloseTo(7, 6);
  });

  test("insufficient data → all null", () => {
    expect(calculateTRIMA([1, 2], 5).every((v) => v === null)).toBe(true);
  });
});
