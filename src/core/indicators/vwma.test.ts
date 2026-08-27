import { describe, expect, test } from "bun:test";
import { calculateVWMA } from "./vwma.ts";
import type { Candle } from "./types.ts";

function bar(close: number, volume: number): Candle {
  return { open: close, high: close, low: close, close, volume };
}

describe("VWMA", () => {
  test("equal volumes → VWMA equals SMA", () => {
    // closes [2,4,6] vol all 1, period 3 → (2+4+6)/3 = 4
    const r = calculateVWMA([bar(2, 1), bar(4, 1), bar(6, 1)], 3);
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(r[2]).toBeCloseTo(4, 6);
  });

  test("volume-weighted hand value", () => {
    // closes [10,20,30], vol [1,1,8], period 3
    // pv = 10*1 + 20*1 + 30*8 = 10+20+240 = 270; vol = 10 → 27.0
    const r = calculateVWMA([bar(10, 1), bar(20, 1), bar(30, 8)], 3);
    expect(r[2]).toBeCloseTo(27, 6);
  });

  test("rolls forward over the window", () => {
    // window bars 1..3: closes [20,30,40] vol [1,1,2]
    // pv = 20+30+80 = 130; vol = 4 → 32.5
    const r = calculateVWMA([bar(10, 1), bar(20, 1), bar(30, 1), bar(40, 2)], 3);
    expect(r[3]).toBeCloseTo(32.5, 6);
  });

  test("insufficient data → all null", () => {
    expect(calculateVWMA([bar(1, 1), bar(2, 1)], 3).every((v) => v === null)).toBe(true);
  });
});
