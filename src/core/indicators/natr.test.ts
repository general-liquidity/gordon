import { describe, expect, test } from "bun:test";
import { calculateNATR } from "./natr.ts";
import { calculateATR } from "./atr.ts";
import type { Candle } from "./types.ts";

function bar(high: number, low: number, close: number): Candle {
  return { open: close, high, low, close, volume: 1 };
}

describe("NATR", () => {
  test("NATR = ATR / close * 100 (consistency with calculateATR)", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      const base = 100 + i;
      candles.push(bar(base + 2, base - 2, base + 0.5));
    }
    const atr = calculateATR(candles, 14);
    const natr = calculateNATR(candles, 14);
    const lastClose = candles[candles.length - 1]!.close;
    const expected = (atr.current! / lastClose) * 100;
    expect(natr.current).toBeCloseTo(parseFloat(expected.toFixed(2)), 2);
  });

  test("constant-range bar at price 100, TR=4 → NATR ≈ 4%", () => {
    // high-low = 4 each bar, price ~100 → ATR≈4 → NATR≈4.
    const candles: Candle[] = Array.from({ length: 30 }, () => bar(102, 98, 100));
    const natr = calculateNATR(candles, 14);
    expect(natr.current).toBeCloseTo(4, 1);
    expect(natr.volatility).toBe("elevated");
  });

  test("insufficient data → null", () => {
    const natr = calculateNATR([bar(102, 98, 100)], 14);
    expect(natr.current).toBeNull();
    expect(natr.interpretation).toContain("Insufficient");
  });
});
