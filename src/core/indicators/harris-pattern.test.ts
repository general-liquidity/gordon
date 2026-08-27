import { describe, expect, test } from "bun:test";
import type { Candle } from "./types.ts";
import { calculateHarrisPattern } from "./harris-pattern.ts";

function bar(high: number, low: number): Candle {
  // open/close kept inside the [low, high] range; Harris ignores them.
  return { open: (high + low) / 2, high, low, close: (high + low) / 2, volume: 1 };
}

describe("calculateHarrisPattern", () => {
  test("ascending-overlap series → BUY (2) on bar 3", () => {
    // Chain: high[i] > high[i-1] > low[i] > high[i-2] > low[i-1] > high[i-3] > low[i-2] > low[i-3]
    // Values 20 > 19 > 18 > 17 > 16 > 15 > 14 > 13.
    const candles: Candle[] = [
      bar(15, 13), // i-3: high=15, low=13
      bar(17, 14), // i-2: high=17, low=14
      bar(19, 16), // i-1: high=19, low=16
      bar(20, 18), // i:   high=20, low=18
    ];
    const r = calculateHarrisPattern(candles);
    expect(r.signals).toEqual([0, 0, 0, 2]);
    expect(r.current).toBe(2);
    expect(r.buyCount).toBe(1);
    expect(r.sellCount).toBe(0);
    expect(r.signals.length).toBe(candles.length);
  });

  test("descending-overlap series → SELL (1) on bar 3", () => {
    // Mirror chain: low[i] < low[i-1] < high[i] < low[i-2] < high[i-1] < low[i-3] < high[i-2] < high[i-3]
    // Values 13 < 14 < 15 < 16 < 17 < 18 < 19 < 20.
    const candles: Candle[] = [
      bar(20, 18), // i-3: high=20, low=18
      bar(19, 16), // i-2: high=19, low=16
      bar(17, 14), // i-1: high=17, low=14
      bar(15, 13), // i:   high=15, low=13
    ];
    const r = calculateHarrisPattern(candles);
    expect(r.signals).toEqual([0, 0, 0, 1]);
    expect(r.current).toBe(1);
    expect(r.buyCount).toBe(0);
    expect(r.sellCount).toBe(1);
  });

  test("flat / non-overlapping series → no signal", () => {
    const candles: Candle[] = [bar(10, 9), bar(10, 9), bar(10, 9), bar(10, 9), bar(10, 9)];
    const r = calculateHarrisPattern(candles);
    expect(r.signals).toEqual([0, 0, 0, 0, 0]);
    expect(r.current).toBe(0);
    expect(r.buyCount).toBe(0);
    expect(r.sellCount).toBe(0);
  });

  test("alignment: signals.length === candles.length, first 3 bars are 0", () => {
    // Embed a BUY window at the tail of a longer series.
    const noise = bar(100, 90);
    const candles: Candle[] = [noise, noise, bar(15, 13), bar(17, 14), bar(19, 16), bar(20, 18)];
    const r = calculateHarrisPattern(candles);
    expect(r.signals.length).toBe(candles.length);
    expect(r.signals.slice(0, 3)).toEqual([0, 0, 0]);
    expect(r.signals[5]).toBe(2);
    expect(r.current).toBe(2);
  });

  test("too-short input → all zeros, never throws", () => {
    const r = calculateHarrisPattern([bar(10, 9), bar(11, 10), bar(12, 11)]);
    expect(r.signals).toEqual([0, 0, 0]);
    expect(r.current).toBe(0);
    expect(r.interpretation).toContain("Insufficient");
  });
});
