import { describe, expect, test } from "bun:test";
import { shiftBars, mcpPermute, addNoiseBands, type Candle } from "./syntheticAugmentation.ts";

function bar(open: number, high: number, low: number, close: number, volume = 1_000): Candle {
  return { open, high, low, close, volume };
}

function trendingCandles(n: number, start = 100, drift = 0.005): Candle[] {
  const out: Candle[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    const open = p;
    const close = p * (1 + drift);
    const high = Math.max(open, close) * 1.002;
    const low = Math.min(open, close) * 0.998;
    out.push(bar(open, high, low, close));
    p = close;
  }
  return out;
}

describe("shiftBars", () => {
  test("groups every N candles into one", () => {
    const candles = trendingCandles(20);
    const out = shiftBars(candles, 4);
    expect(out).toHaveLength(5);
  });

  test("preserves first open, last close in each group", () => {
    const candles = [bar(100, 102, 99, 101), bar(101, 103, 100, 102), bar(102, 104, 101, 103)];
    const out = shiftBars(candles, 3);
    expect(out).toHaveLength(1);
    expect(out[0]!.open).toBe(100);
    expect(out[0]!.close).toBe(103);
    expect(out[0]!.high).toBe(104);
    expect(out[0]!.low).toBe(99);
  });

  test("drops partial final group", () => {
    const candles = trendingCandles(10);
    const out = shiftBars(candles, 4);
    // 10 / 4 = 2 full groups + 2 leftover → dropped.
    expect(out).toHaveLength(2);
  });

  test("aggregates volume", () => {
    const candles = [bar(100, 101, 99, 100, 500), bar(100, 101, 99, 100, 300)];
    const out = shiftBars(candles, 2);
    expect(out[0]!.volume).toBe(800);
  });

  test("throws on invalid offsetBars", () => {
    expect(() => shiftBars(trendingCandles(10), 1)).toThrow(/integer/);
    expect(() => shiftBars(trendingCandles(10), 0)).toThrow(/integer/);
    expect(() => shiftBars(trendingCandles(10), 2.5)).toThrow(/integer/);
  });

  test("empty input returns empty output", () => {
    expect(shiftBars([], 4)).toEqual([]);
  });
});

describe("mcpPermute", () => {
  test("returns same length as input", () => {
    const candles = trendingCandles(20);
    const out = mcpPermute(candles, 42);
    expect(out).toHaveLength(candles.length);
  });

  test("preserves first candle as anchor", () => {
    const candles = trendingCandles(20);
    const out = mcpPermute(candles, 42);
    expect(out[0]!.open).toBe(candles[0]!.open);
    expect(out[0]!.close).toBe(candles[0]!.close);
  });

  test("same seed → same permutation (deterministic)", () => {
    const candles = trendingCandles(20);
    const a = mcpPermute(candles, 7);
    const b = mcpPermute(candles, 7);
    expect(a.map((c) => c.close)).toEqual(b.map((c) => c.close));
  });

  test("different seeds → different permutations", () => {
    // Need varying bar-by-bar returns so the shuffle is observable —
    // a monotone-trending series has identical log-deltas per bar and
    // any permutation of identical entries gives back identical output.
    // Alternating up/down bars produce distinct deltas that the shuffle
    // can reorder visibly.
    const candles: Candle[] = [];
    let p = 100;
    for (let i = 0; i < 50; i++) {
      const open = p;
      // Alternate +2% / -1% bars so deltas vary across the series.
      const close = i % 2 === 0 ? p * 1.02 : p * 0.99;
      const high = Math.max(open, close) * 1.005;
      const low = Math.min(open, close) * 0.995;
      candles.push(bar(open, high, low, close));
      p = close;
    }
    const a = mcpPermute(candles, 1);
    const b = mcpPermute(candles, 2);
    const sameTrajectory = a.every((c, i) => Math.abs(c.close - b[i]!.close) < 1e-9);
    expect(sameTrajectory).toBe(false);
  });

  test("permuted series has plausible OHLC ordering", () => {
    const candles = trendingCandles(30);
    const permuted = mcpPermute(candles, 99);
    for (const c of permuted) {
      expect(c.high).toBeGreaterThanOrEqual(c.low);
    }
  });
});

describe("addNoiseBands", () => {
  test("preserves bar count", () => {
    const candles = trendingCandles(20);
    const out = addNoiseBands(candles, 0.1, 42);
    expect(out).toHaveLength(candles.length);
  });

  test("zero volPct returns near-identical series", () => {
    const candles = trendingCandles(20);
    const out = addNoiseBands(candles, 0, 42);
    for (let i = 0; i < candles.length; i++) {
      expect(out[i]!.close).toBeCloseTo(candles[i]!.close, 5);
    }
  });

  test("non-zero volPct produces different close values", () => {
    const candles = trendingCandles(20);
    const out = addNoiseBands(candles, 0.5, 42);
    const anyDifferent = out.some((c, i) => Math.abs(c.close - candles[i]!.close) > 1e-6);
    expect(anyDifferent).toBe(true);
  });

  test("OHLC ordering preserved (high >= open/close, low <= open/close)", () => {
    const candles = trendingCandles(30);
    const out = addNoiseBands(candles, 0.3, 7);
    for (const c of out) {
      expect(c.high).toBeGreaterThanOrEqual(c.open);
      expect(c.high).toBeGreaterThanOrEqual(c.close);
      expect(c.low).toBeLessThanOrEqual(c.open);
      expect(c.low).toBeLessThanOrEqual(c.close);
    }
  });

  test("throws on out-of-range volPct", () => {
    expect(() => addNoiseBands(trendingCandles(10), -0.1, 1)).toThrow(/volPct/);
    expect(() => addNoiseBands(trendingCandles(10), 1, 1)).toThrow(/volPct/);
    expect(() => addNoiseBands(trendingCandles(10), 1.5, 1)).toThrow(/volPct/);
  });

  test("empty input returns empty output", () => {
    expect(addNoiseBands([], 0.1, 1)).toEqual([]);
  });
});
