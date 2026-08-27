import { describe, expect, it } from "bun:test";
import { computeNakedPoc } from "./naked-poc.ts";
import type { Candle } from "./types.ts";

const bar = (price: number): Candle => ({
  open: price,
  high: price + 0.5,
  low: price - 0.5,
  close: price,
  volume: 100,
});

describe("computeNakedPoc", () => {
  it("marks an unrevisited period POC as naked and a revisited one as filled", () => {
    // 3 periods of 5 bars: ~100, ~110, back to ~100.
    const candles: Candle[] = [
      ...Array.from({ length: 5 }, () => bar(100)),
      ...Array.from({ length: 5 }, () => bar(110)),
      ...Array.from({ length: 5 }, () => bar(100)),
    ];
    const r = computeNakedPoc({ candles, periodBars: 5 });
    // period0 POC(~100) is revisited by period2 (~100) → filled.
    expect(r.filledCount).toBe(1);
    // period1 POC(~110) and period2 POC(~100) are not revisited → naked.
    expect(r.nakedPocs.length).toBe(2);
    expect(r.nakedPocs.some((p) => p.poc > 105)).toBe(true); // the ~110 magnet
  });

  it("is neutral on insufficient data", () => {
    const r = computeNakedPoc({
      candles: Array.from({ length: 6 }, () => bar(100)),
      periodBars: 5,
    });
    expect(r.nakedPocs).toEqual([]);
    expect(r.interpretation).toContain("insufficient");
  });
});
