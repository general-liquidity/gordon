import { describe, expect, test } from "bun:test";
import { calculateUltimateOscillator } from "./ultimate-oscillator.ts";
import type { Candle } from "./types.ts";

describe("Ultimate Oscillator", () => {
  test("every bar fully bullish (BP==TR) → UO = 100", () => {
    // Build bars where high=close, low=prevClose so BP==TR each bar → all avgs=1.
    const closes = [10, 11, 12, 13, 14];
    const candles: Candle[] = closes.map((c, i) => {
      const prev = i === 0 ? c : closes[i - 1]!;
      return { open: prev, high: c, low: prev, close: c, volume: 1 };
    });
    // periods 2/3/4, needs long+1 = 5 bars.
    const r = calculateUltimateOscillator(candles, 2, 3, 4);
    expect(r.current).toBeCloseTo(100, 4);
    expect(r.signal).toBe("overbought");
  });

  test("every bar fully bearish (BP==0) → UO = 0", () => {
    // Falling: high=prevClose, low=close → BP = close - min(low,prevClose) = 0.
    const closes = [14, 13, 12, 11, 10];
    const candles: Candle[] = closes.map((c, i) => {
      const prev = i === 0 ? c : closes[i - 1]!;
      return { open: prev, high: prev, low: c, close: c, volume: 1 };
    });
    const r = calculateUltimateOscillator(candles, 2, 3, 4);
    expect(r.current).toBeCloseTo(0, 4);
    expect(r.signal).toBe("oversold");
  });

  test("insufficient data → null", () => {
    const candles: Candle[] = [{ open: 1, high: 2, low: 1, close: 1.5, volume: 1 }];
    const r = calculateUltimateOscillator(candles, 7, 14, 28);
    expect(r.current).toBeNull();
    expect(r.interpretation).toContain("Insufficient");
  });
});
