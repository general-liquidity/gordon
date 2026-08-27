import { describe, expect, test } from "bun:test";
import { calculateDonchian } from "./donchian.ts";
import type { Candle } from "./types.ts";

function bar(high: number, low: number, close: number): Candle {
  return { open: close, high, low, close, volume: 1 };
}

describe("Donchian Channel", () => {
  test("known window: highs [3,5,4], lows [1,2,2] period 3", () => {
    // upper=max(3,5,4)=5, lower=min(1,2,2)=1, middle=(5+1)/2=3
    const r = calculateDonchian([bar(3, 1, 2), bar(5, 2, 4), bar(4, 2, 3)], 3);
    expect(r.upper[0]).toBeNull();
    expect(r.lower[1]).toBeNull();
    expect(r.upper[2]).toBeCloseTo(5, 6);
    expect(r.lower[2]).toBeCloseTo(1, 6);
    expect(r.middle[2]).toBeCloseTo(3, 6);
    expect(r.current).toEqual({ upper: 5, lower: 1, middle: 3 });
  });

  test("rolls forward: window drops the first bar", () => {
    // bars 1..3 (highs 5,4,7 lows 2,2,3) → upper=7, lower=2, mid=4.5
    const r = calculateDonchian([bar(3, 1, 2), bar(5, 2, 4), bar(4, 2, 3), bar(7, 3, 6)], 3);
    expect(r.upper[3]).toBeCloseTo(7, 6);
    expect(r.lower[3]).toBeCloseTo(2, 6);
    expect(r.middle[3]).toBeCloseTo(4.5, 6);
  });

  test("close at upper band → breakout interpretation", () => {
    const r = calculateDonchian([bar(3, 1, 2), bar(5, 2, 4), bar(6, 3, 6)], 3);
    expect(r.current!.upper).toBeCloseTo(6, 6);
    expect(r.interpretation).toContain("breakout");
  });

  test("insufficient data → null current, all-null series", () => {
    const r = calculateDonchian([bar(3, 1, 2), bar(5, 2, 4)], 3);
    expect(r.current).toBeNull();
    expect(r.upper.every((v) => v === null)).toBe(true);
    expect(r.interpretation).toContain("Insufficient");
  });
});
