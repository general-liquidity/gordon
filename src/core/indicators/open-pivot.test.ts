import { describe, expect, test } from "bun:test";
import type { Candle } from "./types.ts";
import { calculateOpenPivot } from "./open-pivot.ts";

function c(open: number, high: number, low: number, close: number): Candle {
  return { open, high, low, close, volume: 1 };
}

describe("calculateOpenPivot", () => {
  test("insufficient data (<2 candles) → neutral, never throws", () => {
    const r0 = calculateOpenPivot([]);
    const r1 = calculateOpenPivot([c(100, 101, 99, 100)]);
    for (const r of [r0, r1]) {
      expect(r.openBias).toBe("at_open");
      expect(r.reclaimEvent).toBe("none");
      expect(r.wicklessDrive).toBe("none");
      expect(r.revertTarget).toBeNull();
      expect(r.interpretation).toContain("Insufficient");
    }
  });

  test("above_open bias + signed distance", () => {
    // sessionOpen=100, currentClose=110 → +10%.
    const candles: Candle[] = [c(100, 102, 98, 101), c(101, 112, 100, 110)];
    const r = calculateOpenPivot(candles);
    expect(r.sessionOpen).toBe(100);
    expect(r.currentClose).toBe(110);
    expect(r.openBias).toBe("above_open");
    expect(r.distanceFromOpenPct).toBe(10);
  });

  test("below_open bias with negative distance", () => {
    // sessionOpen=200, currentClose=190 → -5%.
    const candles: Candle[] = [c(200, 201, 199, 200), c(199, 199, 188, 190)];
    const r = calculateOpenPivot(candles);
    expect(r.openBias).toBe("below_open");
    expect(r.distanceFromOpenPct).toBe(-5);
  });

  test("at_open when close equals session open", () => {
    const candles: Candle[] = [c(100, 105, 95, 102), c(101, 106, 99, 100)];
    const r = calculateOpenPivot(candles);
    expect(r.openBias).toBe("at_open");
    expect(r.distanceFromOpenPct).toBe(0);
  });

  test("reclaimed: prev close below open, latest close above open", () => {
    // sessionOpen=100. prev.close=95 (<100), latest.close=105 (>100).
    const candles: Candle[] = [c(100, 101, 90, 95), c(95, 106, 94, 105)];
    const r = calculateOpenPivot(candles);
    expect(r.reclaimEvent).toBe("reclaimed");
  });

  test("lost: prev close above open, latest close below open", () => {
    // sessionOpen=100. prev.close=105 (>100), latest.close=95 (<100).
    const candles: Candle[] = [c(100, 110, 99, 105), c(105, 106, 90, 95)];
    const r = calculateOpenPivot(candles);
    expect(r.reclaimEvent).toBe("lost");
  });

  test("no reclaim when both bars on the same side of open", () => {
    const candles: Candle[] = [c(100, 110, 101, 108), c(108, 112, 102, 109)];
    const r = calculateOpenPivot(candles);
    expect(r.reclaimEvent).toBe("none");
  });

  test("up_drive: green wickless-bottom candle → revertTarget = its open", () => {
    // Latest: open=100, low=100 (zero lower wick), high=110, close=109.
    // range=10, body=9 (0.9 > 0.05), lowerWickFrac=0 ≤ 0.05.
    const candles: Candle[] = [c(100, 101, 99, 100), c(100, 110, 100, 109)];
    const r = calculateOpenPivot(candles);
    expect(r.wicklessDrive).toBe("up_drive");
    expect(r.revertTarget).toBe(100);
  });

  test("down_drive: red wickless-top candle → revertTarget = its open", () => {
    // Latest: open=110, high=110 (zero upper wick), low=100, close=101.
    // range=10, body=9, upperWickFrac=0 ≤ 0.05.
    const candles: Candle[] = [c(110, 111, 109, 110), c(110, 110, 100, 101)];
    const r = calculateOpenPivot(candles);
    expect(r.wicklessDrive).toBe("down_drive");
    expect(r.revertTarget).toBe(110);
  });

  test("no drive when opposite wick exceeds threshold", () => {
    // Green candle with a large lower wick: open=105, low=100 → lowerWickFrac=0.5.
    const candles: Candle[] = [c(100, 101, 99, 100), c(105, 110, 100, 109)];
    const r = calculateOpenPivot(candles);
    expect(r.wicklessDrive).toBe("none");
    expect(r.revertTarget).toBeNull();
  });

  test("no drive on a trivial body even if opposite wick is zero (doji-like)", () => {
    // open=100, low=100 (zero lower wick) but close=100.2 → body/range tiny.
    const candles: Candle[] = [c(100, 101, 99, 100), c(100, 110, 100, 100.2)];
    const r = calculateOpenPivot(candles);
    expect(r.wicklessDrive).toBe("none");
    expect(r.revertTarget).toBeNull();
  });

  test("custom wickFracThreshold loosens the wick tolerance", () => {
    // lowerWickFrac=0.1: rejected at default 0.05, accepted at 0.2.
    // open=101, low=100, high=110, close=109 → range=10, lowerWick=1 → 0.1.
    const candles: Candle[] = [c(100, 101, 99, 100), c(101, 110, 100, 109)];
    expect(calculateOpenPivot(candles).wicklessDrive).toBe("none");
    expect(calculateOpenPivot(candles, { wickFracThreshold: 0.2 }).wicklessDrive).toBe("up_drive");
  });

  test("zero-range latest candle never flags a drive, never throws", () => {
    const candles: Candle[] = [c(100, 101, 99, 100), c(100, 100, 100, 100)];
    const r = calculateOpenPivot(candles);
    expect(r.wicklessDrive).toBe("none");
    expect(r.revertTarget).toBeNull();
  });
});
