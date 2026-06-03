import { describe, expect, it } from "bun:test";
import { calculateVolumeImbalance } from "./volume-imbalance.ts";
import type { Candle } from "./types.ts";

function c(open: number, high: number, low: number, close: number, volume = 100): Candle {
  return { open, high, low, close, volume };
}

describe("calculateVolumeImbalance", () => {
  it("detects a bullish VI (body gap up, overlapping ranges) with correct zone", () => {
    const candles: Candle[] = [
      c(100, 105, 99, 102), // prev: close 102, high 105
      c(104, 108, 103, 107), // cur: open 104 > close 102, low 103 <= high 105 -> bullish VI
      c(107, 110, 106, 109),
    ];
    const r = calculateVolumeImbalance(candles);

    expect(r.bullishImbalances.length).toBe(1);
    expect(r.bearishImbalances.length).toBe(0);

    const vi = r.bullishImbalances[0]!;
    expect(vi.type).toBe("bullish");
    expect(vi.bottom).toBe(102); // close[i-1]
    expect(vi.top).toBe(104); // open[i]
    expect(vi.barIndex).toBe(1);
    expect(vi.filled).toBe(false);
    expect(r.nearestUnfilledBullish).not.toBeNull();
  });

  it("detects a bearish VI (body gap down, overlapping ranges) with correct zone", () => {
    const candles: Candle[] = [
      c(105, 106, 98, 103), // prev: close 103, low 98
      c(100, 102, 97, 99), // cur: open 100 < close 103, high 102 >= low 98 -> bearish VI
      c(99, 101, 96, 98),
    ];
    const r = calculateVolumeImbalance(candles);

    expect(r.bearishImbalances.length).toBe(1);
    expect(r.bullishImbalances.length).toBe(0);

    const vi = r.bearishImbalances[0]!;
    expect(vi.type).toBe("bearish");
    expect(vi.bottom).toBe(100); // open[i]
    expect(vi.top).toBe(103); // close[i-1]
    expect(vi.barIndex).toBe(1);
    expect(vi.filled).toBe(false);
    expect(r.nearestUnfilledBearish).not.toBeNull();
  });

  it("does NOT flag a true full price gap (FVG-style, no range overlap) as a VI", () => {
    const candles: Candle[] = [
      c(100, 105, 99, 102), // prev: high 105
      c(110, 115, 108, 112), // cur: open 110 > close 102 BUT low 108 > high 105 -> full gap, not VI
      c(112, 116, 111, 114),
    ];
    const r = calculateVolumeImbalance(candles);

    expect(r.imbalances.length).toBe(0);
    expect(r.bullishImbalances.length).toBe(0);
    expect(r.bearishImbalances.length).toBe(0);
    expect(r.nearestUnfilledBullish).toBeNull();
  });

  it("marks a bullish VI as filled when a later candle trades back through the zone bottom", () => {
    const candles: Candle[] = [
      c(100, 105, 99, 102), // prev
      c(104, 108, 103, 107), // bullish VI: bottom 102, top 104
      c(106, 109, 101, 103), // later low 101 <= bottom 102 -> filled
    ];
    const r = calculateVolumeImbalance(candles);

    expect(r.bullishImbalances.length).toBe(1);
    expect(r.bullishImbalances[0]!.filled).toBe(true);
    expect(r.nearestUnfilledBullish).toBeNull();
  });

  it("returns a neutral result on insufficient data", () => {
    const r = calculateVolumeImbalance([c(100, 105, 99, 102)]);

    expect(r.imbalances).toEqual([]);
    expect(r.bullishImbalances).toEqual([]);
    expect(r.bearishImbalances).toEqual([]);
    expect(r.nearestUnfilledBullish).toBeNull();
    expect(r.nearestUnfilledBearish).toBeNull();
    expect(r.currentPrice).toBeNull();
    expect(r.interpretation).toBe("Insufficient data for volume imbalance");
  });

  it("respects the lookback window", () => {
    const candles: Candle[] = [
      c(100, 105, 99, 102),
      c(104, 108, 103, 107), // bullish VI at index 1
      c(107, 110, 106, 109),
      c(109, 112, 108, 111),
    ];
    // lookback 2 -> startBar = length-2 = 2, so index-1 VI excluded
    const r = calculateVolumeImbalance(candles, { lookback: 2 });
    expect(r.imbalances.length).toBe(0);
  });
});
