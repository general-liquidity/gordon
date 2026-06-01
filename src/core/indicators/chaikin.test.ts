import { describe, expect, test } from "bun:test";
import { calculateChaikinAD, calculateChaikinOscillator } from "./chaikin.ts";
import type { Candle } from "./types.ts";

function bar(high: number, low: number, close: number, volume: number): Candle {
  return { open: close, high, low, close, volume };
}

describe("Chaikin A/D line", () => {
  test("close at high → MFM=+1 → A/D accumulates +volume each bar", () => {
    const candles = [bar(10, 0, 10, 100), bar(10, 0, 10, 100)];
    const r = calculateChaikinAD(candles);
    expect(r.values[0]).toBeCloseTo(100, 6);
    expect(r.current).toBeCloseTo(200, 6);
    expect(r.trend).toBe("accumulation");
  });

  test("close at low → MFM=-1 → A/D distributes", () => {
    const candles = [bar(10, 0, 0, 100), bar(10, 0, 0, 100)];
    const r = calculateChaikinAD(candles);
    expect(r.current).toBeCloseTo(-200, 6);
    expect(r.trend).toBe("distribution");
  });

  test("close mid-range → MFM=0 → A/D flat", () => {
    const candles = [bar(10, 0, 5, 100)];
    const r = calculateChaikinAD(candles);
    expect(r.current).toBeCloseTo(0, 6);
  });

  test("empty input → null/empty", () => {
    const r = calculateChaikinAD([]);
    expect(r.current).toBeNull();
    expect(r.values).toHaveLength(0);
  });
});

describe("Chaikin Oscillator", () => {
  test("steady accumulation → positive oscillator, buy on cross", () => {
    // A/D climbs steadily; fast EMA leads slow → oscillator > 0.
    const candles: Candle[] = Array.from({ length: 15 }, () => bar(10, 0, 10, 100));
    const r = calculateChaikinOscillator(candles, 3, 10);
    expect(r.current).not.toBeNull();
    expect(r.current!).toBeGreaterThan(0);
  });

  test("insufficient data → null", () => {
    const candles: Candle[] = [bar(10, 0, 10, 100)];
    const r = calculateChaikinOscillator(candles, 3, 10);
    expect(r.current).toBeNull();
    expect(r.interpretation).toContain("Insufficient");
  });
});
