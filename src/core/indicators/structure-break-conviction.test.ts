import { describe, expect, it } from "bun:test";
import { calculateStructureBreakConviction } from "./structure-break-conviction.ts";
import type { Candle } from "./types.ts";

// Build a candle from a low/close, with high just above the low so pivot highs
// track the same indices as pivot lows (a monotonic +1 transform).
function bar(low: number, close: number): Candle {
  return { open: low + 0.5, high: low + 1, low, close, volume: 1 };
}

// Uptrend with two ascending HIGHER LOWS (90 @ idx2, 100 @ idx9) then a decline.
// lastClose set per-test to break zero / one / two of them.
function bearishScaffold(lastClose: number): Candle[] {
  const lows = [
    96, 94, 90, 92, 94, 95, 95, 104, 102, 100, 102, 104, 104, 104, 100, 95, 90, 88, 86,
  ];
  const candles = lows.map((l) => bar(l, l + 0.5));
  candles.push({ open: 86, high: 101, low: 84, close: lastClose, volume: 1 });
  return candles;
}

// Downtrend with two descending LOWER HIGHS (110 @ idx2, 100 @ idx9) then a rally.
function bullishScaffold(lastClose: number): Candle[] {
  const highs = [
    104, 106, 110, 108, 106, 105, 105, 96, 98, 100, 98, 96, 96, 96, 100, 105, 110, 112, 114,
  ];
  const candles = highs.map((h) => ({
    open: h - 0.5,
    high: h,
    low: h - 1,
    close: h - 0.5,
    volume: 1,
  }));
  candles.push({ open: 99, high: 116, low: 99, close: lastClose, volume: 1 });
  return candles;
}

describe("calculateStructureBreakConviction", () => {
  it("returns neutral on insufficient data", () => {
    const r = calculateStructureBreakConviction([bar(100, 100), bar(101, 101)]);
    expect(r.break).toBe("none");
    expect(r.conviction).toBe("none");
    expect(r.valid).toBe(false);
  });

  it("flags a two-level bearish break as high conviction", () => {
    const r = calculateStructureBreakConviction(bearishScaffold(85));
    expect(r.break).toBe("bearish");
    expect(r.conviction).toBe("high");
    expect(r.valid).toBe(true);
    expect(r.levelsBroken).toBe(2);
    expect(r.brokenLevels).toEqual([100, 90]);
  });

  it("flags a single-level bearish break as the MSS trap", () => {
    const r = calculateStructureBreakConviction(bearishScaffold(95));
    expect(r.break).toBe("bearish");
    expect(r.conviction).toBe("trap");
    expect(r.valid).toBe(false);
    expect(r.levelsBroken).toBe(1);
    expect(r.brokenLevels).toEqual([100]);
  });

  it("returns none when no significant level is taken out", () => {
    const r = calculateStructureBreakConviction(bearishScaffold(100.5));
    expect(r.break).toBe("none");
    expect(r.conviction).toBe("none");
    expect(r.levelsBroken).toBe(0);
  });

  it("flags a two-level bullish break as high conviction", () => {
    const r = calculateStructureBreakConviction(bullishScaffold(115));
    expect(r.break).toBe("bullish");
    expect(r.conviction).toBe("high");
    expect(r.valid).toBe(true);
    expect(r.levelsBroken).toBe(2);
    expect(r.brokenLevels).toEqual([100, 110]);
  });

  it("respects a custom minLevels threshold", () => {
    const r = calculateStructureBreakConviction(bearishScaffold(95), { minLevels: 1 });
    expect(r.valid).toBe(true);
    expect(r.conviction).toBe("high");
  });
});
