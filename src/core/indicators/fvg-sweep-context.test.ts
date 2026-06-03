import { describe, expect, it } from "bun:test";
import { calculateFvgSweepContext } from "./fvg-sweep-context.ts";
import type { Candle } from "./types.ts";

function bar(low: number, high: number, close?: number): Candle {
  return { open: (low + high) / 2, high, low, close: close ?? (low + high) / 2, volume: 1 };
}

describe("calculateFvgSweepContext", () => {
  it("returns neutral on insufficient data", () => {
    const r = calculateFvgSweepContext([bar(100, 102), bar(101, 103)]);
    expect(r.count).toBe(0);
    expect(r.nearestBullish).toBeNull();
  });

  it("classifies a bullish FVG formed out of a sell-side sweep as post_sweep", () => {
    // pivot low @ idx2 (100); idx6 dips to 99 (sweep); then a 3-candle up-impulse FVG.
    const candles: Candle[] = [
      bar(104, 106),
      bar(102, 104),
      bar(100, 102), // pivot low
      bar(101, 103),
      bar(103, 105),
      bar(103, 105),
      bar(99, 101), // sweep: low 99 < prior pivot low 100
      bar(101, 103),
      bar(104, 106), // FVG first candle (high 106)
      bar(108, 110), // displacement
      bar(110, 112), // third candle (low 110 > 106) -> bullish FVG
      bar(111, 113),
      bar(112, 114),
    ];
    const r = calculateFvgSweepContext(candles);
    expect(r.nearestBullish).not.toBeNull();
    expect(r.nearestBullish!.quality).toBe("post_sweep");
    expect(r.nearestBullish!.sweptLevel).toBe(100);
  });

  it("classifies a bullish FVG in a clean uptrend (no sweep) as pre_sweep", () => {
    const candles: Candle[] = [
      bar(100, 102),
      bar(101, 103),
      bar(102, 104),
      bar(103, 105),
      bar(104, 106), // FVG first candle (high 106)
      bar(108, 110),
      bar(110, 112), // low 110 > 106 -> bullish FVG, no preceding sweep
      bar(111, 113),
      bar(112, 114),
    ];
    const r = calculateFvgSweepContext(candles);
    expect(r.nearestBullish).not.toBeNull();
    expect(r.nearestBullish!.quality).toBe("pre_sweep");
    expect(r.nearestBullish!.sweptLevel).toBeNull();
  });

  it("classifies a bearish FVG formed out of a buy-side sweep as post_sweep", () => {
    const candles: Candle[] = [
      bar(96, 100),
      bar(98, 102),
      bar(100, 104), // pivot high (104)
      bar(97, 103),
      bar(95, 101),
      bar(95, 101),
      bar(101, 105), // sweep: high 105 > prior pivot high 104
      bar(99, 103),
      bar(96, 100), // FVG first candle (low 96)
      bar(92, 94),
      bar(88, 90), // high 90 < 96 -> bearish FVG
      bar(87, 89),
      bar(86, 88),
    ];
    const r = calculateFvgSweepContext(candles);
    expect(r.nearestBearish).not.toBeNull();
    expect(r.nearestBearish!.quality).toBe("post_sweep");
    expect(r.nearestBearish!.sweptLevel).toBe(104);
  });
});
