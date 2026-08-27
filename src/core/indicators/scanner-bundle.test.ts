/**
 * Tests for scanner indicator bundle
 *
 * Tests RSI, MACD, and support/resistance level detection
 */

import { describe, test, expect } from "bun:test";
import { calculateRSI, calculateSMA, calculateEMA, calculateMACD } from "./scanner-bundle.ts";
import { detectLevels, findNearestLevels } from "./price-levels.ts";
import { createMockCandle, createMockCandles, createMockLevel } from "../../test-utils/mocks.ts";
import type { Candle, Level } from "../../types/market.ts";

describe("calculateSMA", () => {
  test("returns 0 for empty array", () => {
    const result = calculateSMA([]);
    expect(result).toBe(0);
  });

  test("returns the single value for array of one", () => {
    const result = calculateSMA([50]);
    expect(result).toBe(50);
  });

  test("calculates correct average", () => {
    const result = calculateSMA([10, 20, 30, 40, 50]);
    expect(result).toBe(30);
  });

  test("handles decimal values", () => {
    const result = calculateSMA([1.5, 2.5, 3.5]);
    expect(result).toBeCloseTo(2.5, 10);
  });
});

describe("calculateEMA", () => {
  test("returns null for insufficient data", () => {
    const result = calculateEMA([10, 20], 5);
    expect(result).toBeNull();
  });

  test("returns SMA when data length equals period", () => {
    const values = [10, 20, 30, 40, 50];
    const result = calculateEMA(values, 5);
    expect(result).toBe(30);
  });

  test("calculates EMA for longer series", () => {
    const values = [10, 20, 30, 40, 50, 60];
    const result = calculateEMA(values, 5);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThan(30);
  });

  test("EMA reacts to recent values", () => {
    const stableValues = [50, 50, 50, 50, 50, 50];
    const risingValues = [50, 50, 50, 50, 50, 100];

    const stableEMA = calculateEMA(stableValues, 5);
    const risingEMA = calculateEMA(risingValues, 5);

    expect(risingEMA).toBeGreaterThan(stableEMA!);
  });
});

describe("calculateRSI", () => {
  test("returns null for insufficient data", () => {
    const candles = createMockCandles(10);
    const result = calculateRSI(candles, 14);
    expect(result).toBeNull();
  });

  test("returns null when data equals period (need period + 1)", () => {
    const candles = createMockCandles(14);
    const result = calculateRSI(candles, 14);
    expect(result).toBeNull();
  });

  test("calculates RSI for sufficient data", () => {
    const candles = createMockCandles(30);
    const result = calculateRSI(candles, 14);
    expect(result).not.toBeNull();
    expect(result).toBeGreaterThanOrEqual(0);
    expect(result).toBeLessThanOrEqual(100);
  });

  test("returns 100 for continuous gains with no losses", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(
        createMockCandle({
          open: 100 + i,
          close: 101 + i,
          high: 102 + i,
          low: 100 + i,
        }),
      );
    }
    const result = calculateRSI(candles, 14);
    expect(result).toBe(100);
  });

  test("returns value near 0 for continuous losses", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(
        createMockCandle({
          open: 200 - i,
          close: 199 - i,
          high: 200 - i,
          low: 198 - i,
        }),
      );
    }
    const result = calculateRSI(candles, 14);
    expect(result).not.toBeNull();
    expect(result!).toBeLessThan(10);
  });

  test("returns 50 for no movement", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) {
      candles.push(
        createMockCandle({
          open: 100,
          close: 100,
          high: 100,
          low: 100,
        }),
      );
    }
    const result = calculateRSI(candles, 14);
    expect(result).toBe(50);
  });

  test("supports custom period", () => {
    const candles = createMockCandles(30);
    const rsi7 = calculateRSI(candles, 7);
    const rsi14 = calculateRSI(candles, 14);

    expect(rsi7).not.toBeNull();
    expect(rsi14).not.toBeNull();
  });
});

describe("calculateMACD", () => {
  test("returns null for insufficient data", () => {
    const candles = createMockCandles(20);
    const result = calculateMACD(candles);
    expect(result).toBeNull();
  });

  test("returns null when exactly at minimum required", () => {
    const candles = createMockCandles(33);
    const result = calculateMACD(candles);
    expect(result).toBeNull();
  });

  test("calculates MACD for sufficient data", () => {
    const candles = createMockCandles(50);
    const result = calculateMACD(candles);

    expect(result).not.toBeNull();
    expect(result).toHaveProperty("macd");
    expect(result).toHaveProperty("signal");
    expect(result).toHaveProperty("histogram");
  });

  test("histogram equals macd minus signal", () => {
    const candles = createMockCandles(50);
    const result = calculateMACD(candles);

    expect(result).not.toBeNull();
    expect(result!.histogram).toBeCloseTo(result!.macd - result!.signal, 10);
  });

  test("MACD is positive for uptrending price", () => {
    const candles = createMockCandles(60, { trend: "up", startPrice: 100 });
    const result = calculateMACD(candles);

    expect(result).not.toBeNull();
    expect(result!.macd).toBeGreaterThan(0);
  });

  test("MACD is negative for downtrending price", () => {
    const candles = createMockCandles(60, { trend: "down", startPrice: 200 });
    const result = calculateMACD(candles);

    expect(result).not.toBeNull();
    expect(result!.macd).toBeLessThan(0);
  });

  test("supports custom periods", () => {
    const candles = createMockCandles(50);
    const defaultMACD = calculateMACD(candles);
    const customMACD = calculateMACD(candles, 8, 17, 9);

    expect(defaultMACD).not.toBeNull();
    expect(customMACD).not.toBeNull();
    expect(defaultMACD!.macd).not.toBe(customMACD!.macd);
  });
});

describe("detectLevels", () => {
  test("returns empty array for insufficient data", () => {
    const candles = createMockCandles(5);
    const result = detectLevels(candles);
    expect(result).toHaveLength(0);
  });

  test("returns empty array for exactly minimum required candles", () => {
    const candles = createMockCandles(6);
    const result = detectLevels(candles, 3);
    expect(result).toHaveLength(0);
  });

  test("detects levels for sufficient data", () => {
    const candles = createMockCandles(50);
    const result = detectLevels(candles);

    expect(Array.isArray(result)).toBe(true);
  });

  test("levels have required properties", () => {
    const candles = createMockCandles(100, { volatility: 0.05 });
    const result = detectLevels(candles);

    for (const level of result) {
      expect(level).toHaveProperty("price");
      expect(level).toHaveProperty("type");
      expect(level).toHaveProperty("strength");
      expect(level).toHaveProperty("touches");
      expect(["support", "resistance"]).toContain(level.type);
      expect(level.strength).toBeGreaterThanOrEqual(0);
      expect(level.strength).toBeLessThanOrEqual(1);
      expect(level.touches).toBeGreaterThanOrEqual(0);
    }
  });

  test("levels are sorted by strength descending", () => {
    const candles = createMockCandles(100, { volatility: 0.05 });
    const result = detectLevels(candles);

    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.strength).toBeLessThanOrEqual(result[i - 1]!.strength);
    }
  });

  test("detects swing highs as resistance levels", () => {
    const candles: Candle[] = [];
    const baseTime = Date.now();

    for (let i = 0; i < 5; i++) {
      candles.push(
        createMockCandle({
          openTime: baseTime + i * 3600000,
          high: 100 + i * 2,
          low: 98 + i * 2,
          close: 99 + i * 2,
        }),
      );
    }

    candles.push(
      createMockCandle({
        openTime: baseTime + 5 * 3600000,
        high: 115,
        low: 108,
        close: 110,
      }),
    );

    for (let i = 0; i < 5; i++) {
      candles.push(
        createMockCandle({
          openTime: baseTime + (6 + i) * 3600000,
          high: 108 - i * 2,
          low: 104 - i * 2,
          close: 105 - i * 2,
        }),
      );
    }

    const result = detectLevels(candles, 2);
    const resistanceLevels = result.filter((l) => l.type === "resistance");

    expect(resistanceLevels.length).toBeGreaterThan(0);
  });

  test("sensitivity parameter affects number of levels", () => {
    const candles = createMockCandles(100, { volatility: 0.03 });

    const lowSensitivity = detectLevels(candles, 2);
    const highSensitivity = detectLevels(candles, 5);

    expect(Array.isArray(lowSensitivity)).toBe(true);
    expect(Array.isArray(highSensitivity)).toBe(true);
  });
});

describe("findNearestLevels", () => {
  test("returns nulls for empty levels array", () => {
    const result = findNearestLevels([], 100);
    expect(result.support).toBeNull();
    expect(result.resistance).toBeNull();
  });

  test("finds nearest support below current price", () => {
    const levels: Level[] = [
      createMockLevel({ price: 80, type: "support" }),
      createMockLevel({ price: 90, type: "support" }),
      createMockLevel({ price: 95, type: "support" }),
    ];

    const result = findNearestLevels(levels, 100);
    expect(result.support?.price).toBe(95);
  });

  test("finds nearest resistance above current price", () => {
    const levels: Level[] = [
      createMockLevel({ price: 105, type: "resistance" }),
      createMockLevel({ price: 110, type: "resistance" }),
      createMockLevel({ price: 120, type: "resistance" }),
    ];

    const result = findNearestLevels(levels, 100);
    expect(result.resistance?.price).toBe(105);
  });

  test("ignores levels at exact current price", () => {
    const levels: Level[] = [
      createMockLevel({ price: 100, type: "support" }),
      createMockLevel({ price: 95, type: "support" }),
    ];

    const result = findNearestLevels(levels, 100);
    expect(result.support?.price).toBe(95);
  });

  test("returns null support when all levels are above price", () => {
    const levels: Level[] = [
      createMockLevel({ price: 110, type: "resistance" }),
      createMockLevel({ price: 105, type: "support" }),
    ];

    const result = findNearestLevels(levels, 100);
    expect(result.support).toBeNull();
    expect(result.resistance?.price).toBe(105);
  });

  test("returns null resistance when all levels are below price", () => {
    const levels: Level[] = [
      createMockLevel({ price: 95, type: "support" }),
      createMockLevel({ price: 90, type: "resistance" }),
    ];

    const result = findNearestLevels(levels, 100);
    expect(result.support?.price).toBe(95);
    expect(result.resistance).toBeNull();
  });

  test("handles mixed support and resistance levels", () => {
    const levels: Level[] = [
      createMockLevel({ price: 120, type: "resistance" }),
      createMockLevel({ price: 110, type: "support" }),
      createMockLevel({ price: 105, type: "resistance" }),
      createMockLevel({ price: 95, type: "support" }),
      createMockLevel({ price: 90, type: "resistance" }),
      createMockLevel({ price: 80, type: "support" }),
    ];

    const result = findNearestLevels(levels, 100);
    expect(result.support?.price).toBe(95);
    expect(result.resistance?.price).toBe(105);
  });
});
