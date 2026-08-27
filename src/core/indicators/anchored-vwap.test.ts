import { describe, expect, it } from "bun:test";
import { calculateAnchoredVWAP } from "./vwap.ts";
import type { Candle } from "./types.ts";

const bar = (price: number, vol = 100): Candle => ({
  open: price,
  high: price + 0.5,
  low: price - 0.5,
  close: price,
  volume: vol,
});

describe("calculateAnchoredVWAP", () => {
  it("auto-anchors to the swing low and only computes from there", () => {
    // V-shape: falls to a low at index 5, then rises.
    const prices = [110, 108, 106, 104, 102, 100, 102, 104, 106, 108, 110];
    const candles = prices.map((p) => bar(p));
    const r = calculateAnchoredVWAP(candles, "low");
    expect(r.anchorIndex).toBe(5); // the 100 bar
    // Null before the anchor, defined from the anchor on.
    expect(r.values[4]).toBeNull();
    expect(r.values[5]).not.toBeNull();
    expect(r.current).toBeGreaterThan(100); // accumulated up the right side of the V
    expect(r.slope).toBe("rising");
  });

  it("rising AVWAP off the low with price above reads as dynamic support", () => {
    const prices = [100, 101, 102, 103, 104, 105, 106, 107];
    const r = calculateAnchoredVWAP(
      prices.map((p) => bar(p)),
      "low",
    );
    expect(r.anchorIndex).toBe(0);
    expect(r.pricePosition).toBe("above");
    expect(r.slope).toBe("rising");
    expect(r.signal).toBe("support");
  });

  it("flags a reclaim when price crosses back above the AVWAP", () => {
    // Below the running AVWAP, then a sharp close back above it on the last bar.
    const prices = [100, 99, 98, 97, 96, 95, 103];
    const r = calculateAnchoredVWAP(
      prices.map((p) => bar(p)),
      "first",
    );
    expect(r.signal).toBe("reclaim");
  });

  it("explicit numeric anchor + volume-weighted bands bracket the AVWAP", () => {
    const prices = [50, 52, 48, 53, 47, 54, 46, 55];
    const r = calculateAnchoredVWAP(
      prices.map((p) => bar(p)),
      2,
      1,
    );
    expect(r.anchorIndex).toBe(2);
    expect(r.values[1]).toBeNull();
    expect(r.upperBand!).toBeGreaterThan(r.current!);
    expect(r.lowerBand!).toBeLessThan(r.current!);
  });

  it("is neutral/empty on insufficient data", () => {
    expect(calculateAnchoredVWAP([], "low").current).toBeNull();
  });
});
