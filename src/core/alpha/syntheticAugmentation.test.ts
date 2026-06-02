import { describe, expect, test } from "bun:test";
import {
  shiftBars,
  mcpPermute,
  addNoiseBands,
  injectGaps,
  injectCrashBlocks,
  injectFlatlineBlocks,
  stretchVolatility,
  reversePath,
  invertTrendWindows,
  type Candle,
} from "./syntheticAugmentation.ts";

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

function flatCandles(n: number, price = 100): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) out.push(bar(price, price, price, price));
  return out;
}

describe("injectGaps", () => {
  test("exact +2% jump at atIndices=[2] on a flat series", () => {
    const candles = flatCandles(5, 100);
    const out = injectGaps(candles, { magnitudePct: 2, atIndices: [2] });
    expect(out[2]!.open).toBeCloseTo(102, 8);
    expect(out[2]!.high).toBeCloseTo(102, 8);
    expect(out[2]!.close).toBeCloseTo(102, 8);
    // Other bars untouched.
    expect(out[1]!.open).toBe(100);
    expect(out[3]!.open).toBe(100);
  });

  test("down direction drops the bar", () => {
    const out = injectGaps(flatCandles(5), { magnitudePct: 2, atIndices: [1], direction: "down" });
    expect(out[1]!.open).toBeCloseTo(98, 8);
  });

  test("alternate direction flips sign across targets", () => {
    const out = injectGaps(flatCandles(6), {
      magnitudePct: 10,
      atIndices: [1, 2, 3],
      direction: "alternate",
    });
    expect(out[1]!.open).toBeCloseTo(110, 8); // +
    expect(out[2]!.open).toBeCloseTo(90, 8); // −
    expect(out[3]!.open).toBeCloseTo(110, 8); // +
  });

  test("everyN stride hits the expected bars", () => {
    const out = injectGaps(flatCandles(7), { magnitudePct: 5, everyN: 3 });
    expect(out[3]!.open).toBeCloseTo(105, 8);
    expect(out[6]!.open).toBeCloseTo(105, 8);
    expect(out[1]!.open).toBe(100);
  });

  test("zero magnitude returns copy unchanged", () => {
    const candles = flatCandles(4);
    const out = injectGaps(candles, { magnitudePct: 0, atIndices: [1] });
    expect(out.map((c) => c.open)).toEqual(candles.map((c) => c.open));
  });

  test("empty input returns empty", () => {
    expect(injectGaps([], { magnitudePct: 2, atIndices: [0] })).toEqual([]);
  });
});

describe("injectCrashBlocks", () => {
  test("3-bar block, 9% drop → close at block end ≈ start × 0.91", () => {
    const candles = flatCandles(8, 100);
    const out = injectCrashBlocks(candles, { dropPct: 9, lengthBars: 3, startIndices: [2] });
    // Block spans bars 2,3,4. Close at bar 4 ≈ 91.
    expect(out[4]!.close).toBeCloseTo(91, 6);
    // Pre-block bar untouched.
    expect(out[1]!.close).toBe(100);
    // Crash persists after the block.
    expect(out[5]!.close).toBeCloseTo(91, 6);
  });

  test("invalid lengthBars returns copy unchanged", () => {
    const candles = flatCandles(5);
    expect(injectCrashBlocks(candles, { dropPct: 9, lengthBars: 0 }).map((c) => c.close)).toEqual(
      candles.map((c) => c.close),
    );
  });

  test("seeded count is deterministic", () => {
    const candles = flatCandles(40);
    const a = injectCrashBlocks(candles, { dropPct: 10, lengthBars: 3, count: 2, seed: 7 });
    const b = injectCrashBlocks(candles, { dropPct: 10, lengthBars: 3, count: 2, seed: 7 });
    expect(a.map((c) => c.close)).toEqual(b.map((c) => c.close));
  });

  test("empty input returns empty", () => {
    expect(injectCrashBlocks([], { dropPct: 9, lengthBars: 3 })).toEqual([]);
  });
});

describe("injectFlatlineBlocks", () => {
  test("O==H==L==C across the block", () => {
    const candles = flatCandles(8, 100).map((_, i) => bar(100 + i, 101 + i, 99 + i, 100 + i));
    const out = injectFlatlineBlocks(candles, { lengthBars: 3, startIndices: [3] });
    for (let i = 3; i < 6; i++) {
      expect(out[i]!.open).toBe(out[i]!.high);
      expect(out[i]!.high).toBe(out[i]!.low);
      expect(out[i]!.low).toBe(out[i]!.close);
      expect(out[i]!.volume).toBe(0);
    }
  });

  test("freezes at the pre-block close", () => {
    const candles = [
      bar(100, 101, 99, 105),
      bar(105, 106, 104, 110),
      bar(110, 111, 109, 115),
      bar(115, 116, 114, 120),
    ];
    const out = injectFlatlineBlocks(candles, { lengthBars: 2, startIndices: [2] });
    // Frozen at bar 1's close = 110.
    expect(out[2]!.close).toBe(110);
    expect(out[3]!.close).toBe(110);
  });

  test("empty input returns empty", () => {
    expect(injectFlatlineBlocks([], { lengthBars: 2 })).toEqual([]);
  });
});

describe("stretchVolatility", () => {
  test("factor 2 doubles the range, close unchanged", () => {
    const candles = [bar(98, 104, 96, 100)];
    const out = stretchVolatility(candles, { factor: 2 });
    const origRange = 104 - 96;
    const newRange = out[0]!.high - out[0]!.low;
    expect(newRange).toBeCloseTo(origRange * 2, 6);
    expect(out[0]!.close).toBeCloseTo(100, 8);
  });

  test("factor <= 0 returns copy unchanged", () => {
    const candles = [bar(98, 104, 96, 100)];
    expect(stretchVolatility(candles, { factor: 0 })[0]!.high).toBe(104);
  });

  test("empty input returns empty", () => {
    expect(stretchVolatility([], { factor: 2 })).toEqual([]);
  });
});

describe("reversePath", () => {
  test("output[0] OHLC equals original last bar", () => {
    const candles = [bar(100, 102, 99, 101), bar(101, 103, 100, 102), bar(102, 104, 101, 103)];
    const out = reversePath(candles);
    const last = candles[candles.length - 1]!;
    expect(out[0]!.open).toBe(last.open);
    expect(out[0]!.high).toBe(last.high);
    expect(out[0]!.low).toBe(last.low);
    expect(out[0]!.close).toBe(last.close);
  });

  test("preserves length and monotonic time axis", () => {
    const candles = trendingCandles(10).map((c, i) => ({ ...c, openTime: i * 1000 }));
    const out = reversePath(candles);
    expect(out).toHaveLength(10);
    for (let i = 1; i < out.length; i++) {
      expect(out[i]!.openTime!).toBeGreaterThan(out[i - 1]!.openTime!);
    }
  });

  test("empty input returns empty", () => {
    expect(reversePath([])).toEqual([]);
  });
});

describe("invertTrendWindows", () => {
  test("trending window flattened to O=H=L=C at first open", () => {
    const candles = trendingCandles(8, 100, 0.02); // strong uptrend
    const out = invertTrendWindows(candles, { window: 4 });
    // First window [0..3] should be flattened.
    const frozen = candles[0]!.open;
    for (let i = 0; i < 4; i++) {
      expect(out[i]!.open).toBeCloseTo(frozen, 8);
      expect(out[i]!.open).toBe(out[i]!.close);
    }
  });

  test("flat window left unchanged", () => {
    const candles = flatCandles(8, 100);
    const out = invertTrendWindows(candles, { window: 4 });
    expect(out.map((c) => c.close)).toEqual(candles.map((c) => c.close));
  });

  test("too-short / invalid window returns copy", () => {
    const candles = trendingCandles(3);
    expect(invertTrendWindows(candles, { window: 4 }).map((c) => c.close)).toEqual(
      candles.map((c) => c.close),
    );
  });

  test("empty input returns empty", () => {
    expect(invertTrendWindows([], { window: 4 })).toEqual([]);
  });
});
