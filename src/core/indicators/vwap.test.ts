import { describe, expect, it } from "bun:test";
import { calculateRollingVWAP } from "./vwap.ts";
import type { Candle } from "./types.ts";

/** Build a candle with high=low=close=price so typical price == price. */
function c(price: number, volume: number): Candle {
  return { open: price, high: price, low: price, close: price, volume };
}

describe("calculateRollingVWAP", () => {
  it("returns empty/null on no data", () => {
    const r = calculateRollingVWAP([], 20);
    expect(r.values).toEqual([]);
    expect(r.current).toBeNull();
    expect(r.upperBand).toBeNull();
  });

  it("is null until the window is full, then windows correctly (drops old bars)", () => {
    // window=2; typical price == price.
    const candles = [c(10, 1), c(20, 1), c(30, 3), c(40, 1)];
    const r = calculateRollingVWAP(candles, 2, 0); // bands disabled

    // i=0 has no full window → null. i=1: (10·1+20·1)/2 = 15.
    expect(r.values[0]).toBeNull();
    expect(r.values[1]!).toBeCloseTo(15, 10);
    // i=2: window [c1,c2] = (20·1+30·3)/(1+3) = 110/4 = 27.5 (c0 dropped).
    expect(r.values[2]!).toBeCloseTo(27.5, 10);
    // i=3: window [c2,c3] = (30·3+40·1)/(3+1) = 130/4 = 32.5 (c0,c1 dropped).
    expect(r.values[3]!).toBeCloseTo(32.5, 10);
    expect(r.current!).toBeCloseTo(32.5, 10);
  });

  it("differs from a cumulative VWAP — it drops stale data", () => {
    const candles = [c(10, 1), c(20, 1), c(30, 3), c(40, 1)];
    const rolling = calculateRollingVWAP(candles, 2, 0).current!;
    // Cumulative VWAP over all 4 = 160/6 ≈ 26.67; rolling (last 2) = 32.5.
    const cumulative = 160 / 6;
    expect(rolling).toBeCloseTo(32.5, 10);
    expect(Math.abs(rolling - cumulative)).toBeGreaterThan(5);
  });

  it("equals the constant price on a flat series, with ~zero bands", () => {
    const candles = Array.from({ length: 30 }, () => c(100, 5));
    const r = calculateRollingVWAP(candles, 10, 1);
    expect(r.current!).toBeCloseTo(100, 10);
    expect(r.upperBand!).toBeCloseTo(100, 8);
    expect(r.lowerBand!).toBeCloseTo(100, 8);
    expect(r.pricePosition).toBe("at");
  });

  it("reports price position relative to the rolling VWAP", () => {
    const candles = [c(10, 1), c(20, 1), c(30, 3), c(40, 1)];
    // last close = 40, current rolling VWAP = 32.5 → above.
    const r = calculateRollingVWAP(candles, 2, 0);
    expect(r.pricePosition).toBe("above");
    expect(r.deviation!).toBeCloseTo(((40 - 32.5) / 32.5) * 100, 8);
  });

  it("brackets the current value with ±σ bands when there is dispersion", () => {
    const candles = [c(10, 1), c(20, 1), c(30, 3), c(40, 1)];
    const r = calculateRollingVWAP(candles, 2, 1);
    expect(r.upperBand!).toBeGreaterThan(r.current!);
    expect(r.lowerBand!).toBeLessThan(r.current!);
    // window [c2,c3]: tp {30,40}, current 32.5 → σ = sqrt((6.25+56.25)/2) ≈ 5.590.
    const sd = Math.sqrt((6.25 + 56.25) / 2);
    expect(r.upperBand!).toBeCloseTo(32.5 + sd, 8);
    expect(r.lowerBand!).toBeCloseTo(32.5 - sd, 8);
  });

  it("disables bands when stdDevMultiplier is 0", () => {
    const candles = [c(10, 1), c(20, 1), c(30, 3), c(40, 1)];
    const r = calculateRollingVWAP(candles, 2, 0);
    expect(r.upperBand).toBeNull();
    expect(r.lowerBand).toBeNull();
  });
});
