import { describe, expect, test } from "bun:test";
import { calculateWilliamsR } from "./williams-r.ts";
import type { Candle } from "./types.ts";

function bar(high: number, low: number, close: number): Candle {
  return { open: close, high, low, close, volume: 1 };
}

describe("Williams %R", () => {
  test("close at range high → %R = 0 (overbought)", () => {
    // period 3, highestHigh=10, lowestLow=2, close=10 → (10-10)/(10-2)*-100 = 0
    const candles = [bar(8, 4, 6), bar(9, 2, 5), bar(10, 5, 10)];
    const r = calculateWilliamsR(candles, 3);
    expect(r.current).toBeCloseTo(0, 6);
    expect(r.signal).toBe("overbought");
  });

  test("close at range low → %R = -100 (oversold)", () => {
    // highestHigh=10, lowestLow=2, close=2 → (10-2)/(10-2)*-100 = -100
    const candles = [bar(8, 4, 6), bar(10, 5, 9), bar(9, 2, 2)];
    const r = calculateWilliamsR(candles, 3);
    expect(r.current).toBeCloseTo(-100, 6);
    expect(r.signal).toBe("oversold");
  });

  test("mid-range close → %R = -50", () => {
    // highestHigh=10, lowestLow=2, close=6 → (10-6)/8*-100 = -50
    const candles = [bar(8, 4, 6), bar(10, 5, 9), bar(9, 2, 6)];
    const r = calculateWilliamsR(candles, 3);
    expect(r.current).toBeCloseTo(-50, 6);
    expect(r.signal).toBe("neutral");
  });

  test("insufficient data → null", () => {
    const r = calculateWilliamsR([bar(2, 1, 1.5)], 14);
    expect(r.current).toBeNull();
    expect(r.interpretation).toContain("Insufficient");
  });
});
