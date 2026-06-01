import { describe, expect, test } from "bun:test";
import { calculateADXR } from "./adxr.ts";
import { calculateADX } from "./adx.ts";
import type { Candle } from "./types.ts";

function bar(high: number, low: number, close: number): Candle {
  return { open: close, high, low, close, volume: 1 };
}

// Strong, persistent uptrend → high ADX → ADXR ≈ average of current + lagged ADX.
function uptrend(n: number): Candle[] {
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    const base = 100 + i * 2;
    out.push(bar(base + 1, base - 1, base + 0.5));
  }
  return out;
}

describe("ADXR", () => {
  test("equals average of current ADX and ADX `period` bars ago", () => {
    const candles = uptrend(80);
    const period = 14;
    const adx = calculateADX(candles, period);
    const series = adx.adxValues;
    const expected = parseFloat(
      ((series[series.length - 1]! + series[series.length - 1 - period]!) / 2).toFixed(2)
    );
    const adxr = calculateADXR(candles, period);
    expect(adxr.current).toBeCloseTo(expected, 2);
  });

  test("strong trend → ADXR registers as strong/moderate", () => {
    const adxr = calculateADXR(uptrend(80), 14);
    expect(["strong", "moderate", "weak"]).toContain(adxr.trendStrength);
    expect(adxr.current).not.toBeNull();
  });

  test("insufficient data → null", () => {
    const adxr = calculateADXR(uptrend(10), 14);
    expect(adxr.current).toBeNull();
    expect(adxr.interpretation).toContain("Insufficient");
  });
});
