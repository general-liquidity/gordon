import { describe, expect, test } from "bun:test";
import { calculateHMA } from "./hull-ma.ts";
import { calculateWMA } from "./moving-averages.ts";

describe("HMA", () => {
  test("length matches input and warmup prefix is null", () => {
    const closes = Array.from({ length: 30 }, (_, i) => i + 1);
    const hma = calculateHMA(closes, 16);
    expect(hma.length).toBe(closes.length);
    // First non-null index for period 16: half=8, full=16 → raw warm at 15,
    // then √16=4 WMA needs 4 more → first HMA at index 18.
    expect(hma[17]).toBeNull();
    expect(hma[18]).not.toBeNull();
  });

  test("hand value on a short ramp, period 4", () => {
    // period 4: half=2, full=4, sqrt=2.
    // closes = [1,2,3,4,5]
    // WMA(2): idx1 (1*1+2*2)/3=5/3; idx2=8/3; idx3=11/3; idx4=14/3
    // WMA(4): idx3 (1+4+9+16)/10=3.0; idx4 (2+6+12+20)/10=4.0
    // raw = 2*WMA2 - WMA4: idx3 = 22/3 - 3 = 13/3≈4.3333; idx4 = 28/3 - 4 = 16/3≈5.3333
    // HMA = WMA(raw,2): idx4 = (1*raw3 + 2*raw4)/3 = (4.3333 + 2*5.3333)/3 = 15/3 = 5.0
    // The intermediate WMAs round to 4dp, so the chained value lands at
    // ~5.0001 rather than an exact 5 — assert to 3dp.
    const hma = calculateHMA([1, 2, 3, 4, 5], 4);
    expect(hma[3]).toBeNull();
    expect(hma[4]).toBeCloseTo(5.0, 3);
  });

  test("on a steady ramp HMA tracks price closer than same-period WMA", () => {
    const closes = Array.from({ length: 40 }, (_, i) => i + 1);
    const hma = calculateHMA(closes, 16);
    const wma = calculateWMA(closes, 16);
    const price = closes[closes.length - 1]!;
    const hmaErr = Math.abs(price - hma[hma.length - 1]!);
    const wmaErr = Math.abs(price - wma[wma.length - 1]!);
    expect(hmaErr).toBeLessThan(wmaErr);
  });

  test("constant series → HMA equals the constant once warm", () => {
    const hma = calculateHMA(new Array(30).fill(7), 16);
    expect(hma[hma.length - 1]).toBeCloseTo(7, 4);
  });

  test("insufficient data → all null", () => {
    expect(calculateHMA([1, 2, 3], 16).every((v) => v === null)).toBe(true);
  });
});
