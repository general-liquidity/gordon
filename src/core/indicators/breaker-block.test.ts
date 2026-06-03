import { describe, expect, test } from "bun:test";
import { calculateBreakerBlock } from "./breaker-block.ts";
import type { Candle } from "./types.ts";

function c(open: number, high: number, low: number, close: number): Candle {
  return { open, high, low, close, volume: 1 };
}

describe("calculateBreakerBlock", () => {
  test("insufficient data -> neutral", () => {
    const candles = [c(10, 11, 9, 10), c(10, 11, 9, 10), c(10, 11, 9, 10)];
    const r = calculateBreakerBlock(candles);
    expect(r.breaker).toBe("none");
    expect(r.zone).toBeNull();
    expect(r.mssLevel).toBeNull();
    expect(r.tested).toBe(false);
    expect(r.pivotWindow).toBe(2);
    expect(r.interpretation).toBe("Insufficient data / no breaker block");
  });

  test("bullish breaker: SH then SL then close above SH", () => {
    // indices:        0          1          2(SH)       3            4(SL)        5          6          7
    // SH at i=2 high=120 strictly > neighbors (i0,1 highs 100,105; i3,4 highs 110,95).
    // down-leg from i2..i4: i3 is a down candle (close<open) -> zone, i4 is also down but i4 is SL.
    // SL at i=4 low=85, strictly < neighbors.
    // last close (i7) = 130 > 120 (SH) -> bullish MSS.
    const candles: Candle[] = [
      c(98, 100, 96, 99), // 0
      c(99, 105, 98, 104), // 1
      c(105, 120, 104, 118), // 2 SH (high 120)
      c(116, 117, 100, 102), // 3 down candle (close 102 < open 116) -> last down before SL? SL is i4
      c(101, 102, 85, 88), // 4 SL (low 85), down candle too
      c(90, 112, 89, 110), // 5
      c(112, 125, 111, 124), // 6
      c(124, 132, 123, 130), // 7 close 130 > SH 120
    ];
    const r = calculateBreakerBlock(candles);
    expect(r.breaker).toBe("bullish");
    expect(r.mssLevel).toBe(120);
    expect(r.zone).not.toBeNull();
    // last down candle in leg i2..i4 is i4 (close 88 < open 101): top=open=101, bottom=close=88
    expect(r.zone!.barIndex).toBe(4);
    expect(r.zone!.top).toBe(101);
    expect(r.zone!.bottom).toBe(88);
    expect(r.pivotWindow).toBe(2);
  });

  test("bearish breaker: SL then SH then close below SL (mirror)", () => {
    // SL at i=2 low=80 strictly < neighbors. up-leg i2..i4. SH at i=4 high=115.
    // last close (i7)=70 < SL 80 -> bearish MSS.
    const candles: Candle[] = [
      c(102, 104, 100, 101), // 0
      c(101, 102, 96, 97), // 1
      c(95, 96, 80, 82), // 2 SL (low 80)
      c(83, 100, 82, 98), // 3 up candle (close 98 > open 83)
      c(98, 115, 97, 112), // 4 SH (high 115), up candle (close 112 > open 98)
      c(110, 111, 88, 90), // 5
      c(89, 90, 75, 78), // 6
      c(77, 79, 68, 70), // 7 close 70 < SL 80
    ];
    const r = calculateBreakerBlock(candles);
    expect(r.breaker).toBe("bearish");
    expect(r.mssLevel).toBe(80);
    expect(r.zone).not.toBeNull();
    // last up candle in leg i2..i4 is i4 (close 112 > open 98): bottom=open=98, top=close=112
    expect(r.zone!.barIndex).toBe(4);
    expect(r.zone!.top).toBe(112);
    expect(r.zone!.bottom).toBe(98);
  });

  test("no breaker: choppy range, no MSS break", () => {
    const candles: Candle[] = [
      c(100, 102, 98, 101),
      c(101, 103, 99, 100),
      c(100, 102, 98, 99),
      c(99, 101, 97, 100),
      c(100, 102, 98, 101),
      c(101, 103, 99, 100),
      c(100, 102, 98, 99),
      c(99, 101, 97, 100),
      c(100, 102, 98, 101),
      c(101, 103, 99, 100),
    ];
    const r = calculateBreakerBlock(candles);
    expect(r.breaker).toBe("none");
    expect(r.zone).toBeNull();
  });

  test("tested breaker: price returns into the zone after MSS", () => {
    // Same bullish setup but with a pullback bar that re-enters the zone (88-101) after the break.
    const candles: Candle[] = [
      c(98, 100, 96, 99), // 0
      c(99, 105, 98, 104), // 1
      c(105, 120, 104, 118), // 2 SH
      c(116, 117, 100, 102), // 3
      c(101, 102, 85, 88), // 4 SL, zone top=101 bottom=88
      c(90, 112, 89, 110), // 5
      c(112, 125, 111, 124), // 6
      c(124, 132, 123, 130), // 7
      c(128, 135, 95, 131), // 8 deep pullback wick: low 95 within zone [88,101], closes 131 > SH 120
    ];
    const r = calculateBreakerBlock(candles);
    expect(r.breaker).toBe("bullish");
    expect(r.tested).toBe(true);
  });
});
