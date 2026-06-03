import { describe, expect, test } from "bun:test";
import { calculateHiddenDivergence } from "./hidden-divergence.ts";
import type { Candle } from "./types.ts";

function candle(close: number, high?: number, low?: number): Candle {
  return {
    open: close,
    high: high ?? close,
    low: low ?? close,
    close,
    volume: 1000,
  };
}

describe("calculateHiddenDivergence", () => {
  test("insufficient data returns well-formed none result", () => {
    const candles = Array.from({ length: 10 }, (_, i) => candle(100 + i));
    const result = calculateHiddenDivergence(candles);

    expect(result.rsi).toBeNull();
    expect(result.rsiValues).toEqual([]);
    expect(result.divergenceDetected).toBe(false);
    expect(result.signal).toBe("none");
    expect(result.divergences).toEqual([]);
    expect(result.strength).toBe(0);
    expect(result.interpretation).toBe("Insufficient data for hidden divergence");
  });

  test("hidden bullish: price higher low while RSI lower low (uptrend continuation)", () => {
    // Uptrend with two pullbacks. The second pullback bottoms at a HIGHER price
    // than the first (higher low in price), but is a sharper drop in momentum
    // terms, driving the RSI to a LOWER low. RSI stays in the pullback zone (<60).
    const closes: number[] = [];

    // Warm-up base for RSI
    for (let i = 0; i < 20; i++) closes.push(100);

    // First leg up, then first pullback (mild) bottoming at price ~110
    for (let i = 0; i < 8; i++) closes.push(100 + i * 2); // 100 -> 114
    for (let i = 0; i < 8; i++) closes.push(114 - i * 0.5); // mild dip to 110.5 (first low)

    // Recover up
    for (let i = 0; i < 8; i++) closes.push(110.5 + i * 1.5); // up to ~121

    // Second pullback: sharper drop in momentum, but bottoms at higher price (~115)
    for (let i = 0; i < 8; i++) closes.push(121 - i * 0.85); // sharp dip, lands ~115 (higher low)

    const candles = closes.map(c => candle(c));
    const result = calculateHiddenDivergence(candles, { lookback: 8 });

    expect(result.rsi).not.toBeNull();
    expect(result.divergenceDetected).toBe(true);
    expect(result.signal).toBe("hidden_bullish");
    expect(result.strength).toBeGreaterThan(0);

    const sig = result.divergences[result.divergences.length - 1]!;
    expect(sig.type).toBe("hidden_bullish");
    // Price made a higher low
    expect(sig.currentPrice).toBeGreaterThan(sig.previousPrice);
    // RSI made a lower low
    expect(sig.currentRSI).toBeLessThan(sig.previousRSI);
    expect(result.interpretation).toContain("HIDDEN BULLISH");
  });

  test("hidden bearish: price lower high while RSI higher high (downtrend continuation)", () => {
    // Downtrend with two relief rallies. The second rally tops at a LOWER price
    // than the first (lower high in price), but is a stronger momentum push,
    // driving the RSI to a HIGHER high. RSI stays in the bounce zone (>40).
    const closes: number[] = [];

    // Warm-up base for RSI
    for (let i = 0; i < 20; i++) closes.push(100);

    // First leg down, then first relief rally (strong) topping at price ~90
    for (let i = 0; i < 8; i++) closes.push(100 - i * 2); // 100 -> 86
    for (let i = 0; i < 8; i++) closes.push(86 + i * 0.5); // mild bounce to 89.5 (first high)

    // Resume down
    for (let i = 0; i < 8; i++) closes.push(89.5 - i * 1.5); // down to ~79

    // Second relief rally: stronger momentum, but tops at lower price (~85)
    for (let i = 0; i < 8; i++) closes.push(79 + i * 0.85); // sharp bounce, lands ~85 (lower high)

    const candles = closes.map(c => candle(c));
    const result = calculateHiddenDivergence(candles, { lookback: 8 });

    expect(result.rsi).not.toBeNull();
    expect(result.divergenceDetected).toBe(true);
    expect(result.signal).toBe("hidden_bearish");
    expect(result.strength).toBeGreaterThan(0);

    const sig = result.divergences[result.divergences.length - 1]!;
    expect(sig.type).toBe("hidden_bearish");
    // Price made a lower high
    expect(sig.currentPrice).toBeLessThan(sig.previousPrice);
    // RSI made a higher high
    expect(sig.currentRSI).toBeGreaterThan(sig.previousRSI);
    expect(result.interpretation).toContain("HIDDEN BEARISH");
  });

  test("no-signal case: steady monotonic uptrend produces no hidden divergence", () => {
    // A clean, steady uptrend has aligned price/RSI lows — no hidden divergence.
    const closes = Array.from({ length: 60 }, (_, i) => 100 + i * 0.8);
    const candles = closes.map(c => candle(c));
    const result = calculateHiddenDivergence(candles, { lookback: 10 });

    expect(result.rsi).not.toBeNull();
    expect(result.divergenceDetected).toBe(false);
    expect(result.signal).toBe("none");
    expect(result.strength).toBe(0);
    expect(result.interpretation).toContain("No active hidden divergence");
  });

  test("rsiValues series is populated and rounded", () => {
    const closes = Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3) * 5);
    const candles = closes.map(c => candle(c));
    const result = calculateHiddenDivergence(candles);

    expect(result.rsiValues.length).toBeGreaterThan(0);
    // Rounded to 2 decimals
    for (const v of result.rsiValues) {
      expect(parseFloat(v.toFixed(2))).toBe(v);
    }
  });
});
