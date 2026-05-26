import { describe, expect, test } from "bun:test";
import { calculateTightConsolidation } from "./tight-consolidation.ts";
import type { Candle } from "./types.ts";

function makeCandle(open: number, high: number, low: number, close: number, volume: number, ts: number): Candle {
  return {
    openTime: ts,
    open,
    high,
    low,
    close,
    volume,
    closeTime: ts + 60_000,
  } as Candle;
}

function constantBaseCandles(price: number, n: number, rangePct: number, volume = 1000): Candle[] {
  const halfRange = (price * rangePct) / 2;
  const out: Candle[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makeCandle(price, price + halfRange, price - halfRange, price, volume, i * 60_000));
  }
  return out;
}

describe("calculateTightConsolidation", () => {
  test("returns empty result when below window", () => {
    const r = calculateTightConsolidation(constantBaseCandles(100, 5, 0.02));
    expect(r.inConsolidation).toBe(false);
    expect(r.tightnessScore).toBe(0);
  });

  test("detects a tight base with declining volume", () => {
    // 10 bars of high volume, then 10 bars of low volume — all within 4% range.
    const high = constantBaseCandles(100, 10, 0.04, 2000);
    const low = constantBaseCandles(100, 10, 0.04, 800);
    const r = calculateTightConsolidation([...high, ...low]);
    expect(r.inConsolidation).toBe(true);
    expect(r.volumeTrend).toBe("declining");
    expect(r.tightnessScore).toBeGreaterThan(0.6);
  });

  test("rejects a wide range as not consolidated", () => {
    // 20 bars but 15% range — too wide.
    const wide = constantBaseCandles(100, 20, 0.15);
    const r = calculateTightConsolidation(wide);
    expect(r.inConsolidation).toBe(false);
    expect(r.rangePct).toBeGreaterThan(0.08);
  });

  test("identifies the breakout and breakdown levels", () => {
    const candles = constantBaseCandles(50, 20, 0.04);
    const r = calculateTightConsolidation(candles);
    expect(r.breakoutLevel).toBeCloseTo(50 + 1, 4); // high = 50 + halfRange where halfRange = 1
    expect(r.breakdownLevel).toBeCloseTo(50 - 1, 4);
  });

  test("penalises position below the consolidation midpoint", () => {
    // Build a base, then last close at the bottom — bear-flag shape, not bull-flag.
    const base = constantBaseCandles(100, 19, 0.04);
    const lastBar = makeCandle(100, 100, 98, 98.1, 800, 19 * 60_000);
    const r = calculateTightConsolidation([...base, lastBar]);
    expect(r.inConsolidation).toBe(true);
    // Score should be lower than a top-of-range close because position factor penalty.
    expect(r.tightnessScore).toBeLessThan(0.7);
  });

  test("respects custom params", () => {
    const candles = constantBaseCandles(100, 30, 0.06);
    const r = calculateTightConsolidation(candles, { window: 30, maxRangePct: 0.1, minDays: 10 });
    expect(r.inConsolidation).toBe(true);
    expect(r.daysInRange).toBeGreaterThanOrEqual(10);
  });
});
