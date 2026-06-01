import { describe, expect, test } from "bun:test";
import { calculateAroon } from "./aroon.ts";
import type { Candle } from "./types.ts";

function bar(high: number, low: number): Candle {
  return { open: low, high, low, close: (high + low) / 2, volume: 1 };
}

describe("Aroon", () => {
  test("fresh high on last bar, oldest low → Up=100, Down=0, Osc=100", () => {
    // period 3, window of 4 bars. highs 3,4,5,6 (max at idx3); lows 1,2,3,4 (min at idx0)
    const candles = [bar(3, 1), bar(4, 2), bar(5, 3), bar(6, 4)];
    const r = calculateAroon(candles, 3);
    expect(r.upValues[0]).toBeNull();
    expect(r.upValues[2]).toBeNull();
    expect(r.up).toBeCloseTo(100, 6);
    expect(r.down).toBeCloseTo(0, 6);
    expect(r.oscillator).toBeCloseTo(100, 6);
    expect(r.trend).toBe("uptrend");
  });

  test("fresh low on last bar, oldest high → Down=100, Up=0, Osc=-100", () => {
    // highs 6,5,4,3 (max at idx0); lows 4,3,2,1 (min at idx3)
    const candles = [bar(6, 4), bar(5, 3), bar(4, 2), bar(3, 1)];
    const r = calculateAroon(candles, 3);
    expect(r.up).toBeCloseTo(0, 6);
    expect(r.down).toBeCloseTo(100, 6);
    expect(r.oscillator).toBeCloseTo(-100, 6);
    expect(r.trend).toBe("downtrend");
  });

  test("insufficient data → null", () => {
    const r = calculateAroon([bar(2, 1), bar(3, 2)], 25);
    expect(r.up).toBeNull();
    expect(r.interpretation).toContain("Insufficient");
  });
});
