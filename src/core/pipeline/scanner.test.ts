/**
 * Tests for scanner module
 *
 * Tests deterministic functions: determineTrend, detectSupportBounce, categorizeRisk
 */

import { describe, test, expect } from "bun:test";
import { determineTrend, detectSupportBounce, categorizeRisk } from "./scanner.ts";
import {
  createMockCandle,
  createMockCandles,
  createMockIndicators,
  createMockLevel,
} from "../../test-utils/mocks.ts";
import type { Candle, Indicators, Level } from "../../types/index.ts";

describe("determineTrend", () => {
  test("returns 'range' for empty candle array", () => {
    const result = determineTrend([]);
    expect(result).toBe("range");
  });

  test("returns 'range' when fewer than 20 candles", () => {
    const candles = createMockCandles(10);
    const result = determineTrend(candles);
    expect(result).toBe("range");
  });

  test("returns 'range' for exactly 19 candles", () => {
    const candles = createMockCandles(19);
    const result = determineTrend(candles);
    expect(result).toBe("range");
  });

  test("detects uptrend with strong price increase and higher highs", () => {
    // Create candles with clear upward movement
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      const basePrice = 100 + i * 2; // Steady increase of 2 per candle
      candles.push(
        createMockCandle({
          openTime: i * 3600000,
          open: basePrice,
          high: basePrice + 1.5,
          low: basePrice - 0.5,
          close: basePrice + 1,
          closeTime: (i + 1) * 3600000,
        })
      );
    }

    const result = determineTrend(candles);
    expect(result).toBe("up");
  });

  test("detects downtrend with strong price decrease and lower lows", () => {
    // Create candles with clear downward movement
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      const basePrice = 200 - i * 2; // Steady decrease of 2 per candle
      candles.push(
        createMockCandle({
          openTime: i * 3600000,
          open: basePrice,
          high: basePrice + 0.5,
          low: basePrice - 1.5,
          close: basePrice - 1,
          closeTime: (i + 1) * 3600000,
        })
      );
    }

    const result = determineTrend(candles);
    expect(result).toBe("down");
  });

  test("returns 'range' for sideways price action", () => {
    // Create candles oscillating around same price
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      const basePrice = 100 + Math.sin(i) * 0.5; // Small oscillation
      candles.push(
        createMockCandle({
          openTime: i * 3600000,
          open: basePrice,
          high: basePrice + 0.5,
          low: basePrice - 0.5,
          close: basePrice + (i % 2 === 0 ? 0.2 : -0.2),
          closeTime: (i + 1) * 3600000,
        })
      );
    }

    const result = determineTrend(candles);
    expect(result).toBe("range");
  });
});

describe("detectSupportBounce", () => {
  test("returns no detection for empty candles", () => {
    const result = detectSupportBounce([], [], createMockIndicators());
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test("returns no detection when no support levels exist", () => {
    const candles = [createMockCandle({ close: 100 })];
    const levels: Level[] = [];
    const indicators = createMockIndicators({ rsi: 30, volumeRatio: 1.0 });

    const result = detectSupportBounce(candles, levels, indicators);
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test("returns no detection when only resistance levels exist", () => {
    const candles = [createMockCandle({ close: 100 })];
    const levels: Level[] = [createMockLevel({ price: 110, type: "resistance" })];
    const indicators = createMockIndicators({ rsi: 30, volumeRatio: 1.0 });

    const result = detectSupportBounce(candles, levels, indicators);
    expect(result.detected).toBe(false);
    expect(result.confidence).toBe(0);
  });

  test("returns no detection when price is far from support", () => {
    const candles = [createMockCandle({ close: 100 })];
    const levels: Level[] = [createMockLevel({ price: 80, type: "support" })]; // 20% below
    const indicators = createMockIndicators({ rsi: 30, volumeRatio: 1.0 });

    const result = detectSupportBounce(candles, levels, indicators);
    expect(result.detected).toBe(false);
  });

  test("returns no detection when RSI is not oversold", () => {
    const candles = [createMockCandle({ close: 100 })];
    const levels: Level[] = [createMockLevel({ price: 99, type: "support" })]; // 1% below
    const indicators = createMockIndicators({ rsi: 50, volumeRatio: 1.0 }); // Not oversold

    const result = detectSupportBounce(candles, levels, indicators);
    expect(result.detected).toBe(false);
  });

  test("returns no detection when volume is too low", () => {
    const candles = [createMockCandle({ close: 100 })];
    const levels: Level[] = [createMockLevel({ price: 99, type: "support" })];
    const indicators = createMockIndicators({ rsi: 30, volumeRatio: 0.5 }); // Low volume

    const result = detectSupportBounce(candles, levels, indicators);
    expect(result.detected).toBe(false);
  });

  test("detects support bounce when all conditions are met", () => {
    const candles = [createMockCandle({ close: 100 })];
    const levels: Level[] = [
      createMockLevel({ price: 99, type: "support", strength: 0.8 }),
    ];
    const indicators = createMockIndicators({ rsi: 30, volumeRatio: 1.0 });

    const result = detectSupportBounce(candles, levels, indicators);
    expect(result.detected).toBe(true);
    expect(result.confidence).toBeGreaterThan(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  test("uses nearest support level below current price", () => {
    const candles = [createMockCandle({ close: 100 })];
    const levels: Level[] = [
      createMockLevel({ price: 95, type: "support", strength: 0.5 }),
      createMockLevel({ price: 99, type: "support", strength: 0.8 }), // Nearest
      createMockLevel({ price: 80, type: "support", strength: 0.9 }),
    ];
    const indicators = createMockIndicators({ rsi: 30, volumeRatio: 1.0 });

    const result = detectSupportBounce(candles, levels, indicators);
    expect(result.detected).toBe(true);
  });

  test("returns higher confidence for stronger RSI oversold", () => {
    const candles = [createMockCandle({ close: 100 })];
    const levels: Level[] = [createMockLevel({ price: 99, type: "support", strength: 0.8 })];

    const weakOversold = detectSupportBounce(
      candles,
      levels,
      createMockIndicators({ rsi: 38, volumeRatio: 1.0 })
    );
    const strongOversold = detectSupportBounce(
      candles,
      levels,
      createMockIndicators({ rsi: 20, volumeRatio: 1.0 })
    );

    expect(strongOversold.confidence).toBeGreaterThan(weakOversold.confidence);
  });
});

describe("categorizeRisk", () => {
  test("returns 'medium' for empty analysis", () => {
    const result = categorizeRisk({});
    expect(result).toBe("medium");
  });

  test("returns medium for empty levels array with neutral indicators", () => {
    // Empty levels array doesn't trigger the support check (length > 0 is false)
    // Neutral volume (1.0) and RSI (50) don't affect score
    // Score = 0, which results in "medium"
    const result = categorizeRisk({
      levels: [],
      indicators: createMockIndicators({ volumeRatio: 1.0, rsi: 50 }),
    });
    expect(result).toBe("medium");
  });

  test("returns high when levels exist but no support types", () => {
    // Only resistance levels - supportLevels.length === 0, adds +1 risk
    const result = categorizeRisk({
      levels: [createMockLevel({ type: "resistance", strength: 0.9 })],
      indicators: createMockIndicators({ volumeRatio: 1.0, rsi: 50 }),
    });
    expect(result).toBe("high");
  });

  test("returns 'low' with strong support and high volume", () => {
    const result = categorizeRisk({
      levels: [createMockLevel({ type: "support", strength: 0.9 })],
      indicators: createMockIndicators({ volumeRatio: 2.0, rsi: 50 }),
    });
    expect(result).toBe("low");
  });

  test("returns 'high' with weak support and low volume", () => {
    const result = categorizeRisk({
      levels: [createMockLevel({ type: "support", strength: 0.2 })],
      indicators: createMockIndicators({ volumeRatio: 0.3, rsi: 50 }),
    });
    expect(result).toBe("high");
  });

  test("returns 'high' when RSI is extremely low", () => {
    const result = categorizeRisk({
      levels: [createMockLevel({ type: "support", strength: 0.5 })],
      indicators: createMockIndicators({ volumeRatio: 1.0, rsi: 15 }),
    });
    expect(result).toBe("high");
  });

  test("returns 'high' when RSI is extremely high", () => {
    const result = categorizeRisk({
      levels: [createMockLevel({ type: "support", strength: 0.5 })],
      indicators: createMockIndicators({ volumeRatio: 1.0, rsi: 85 }),
    });
    expect(result).toBe("high");
  });

  test("handles null volumeRatio", () => {
    const result = categorizeRisk({
      levels: [createMockLevel({ type: "support", strength: 0.5 })],
      indicators: createMockIndicators({ volumeRatio: null, rsi: 50 }),
    });
    expect(["low", "medium", "high"]).toContain(result);
  });

  test("handles null RSI", () => {
    const result = categorizeRisk({
      levels: [createMockLevel({ type: "support", strength: 0.5 })],
      indicators: createMockIndicators({ volumeRatio: 1.0, rsi: null }),
    });
    expect(["low", "medium", "high"]).toContain(result);
  });

  test("only considers support levels for strength calculation", () => {
    const result = categorizeRisk({
      levels: [
        createMockLevel({ type: "resistance", strength: 0.9 }),
        createMockLevel({ type: "support", strength: 0.2 }),
      ],
      indicators: createMockIndicators({ volumeRatio: 1.0, rsi: 50 }),
    });
    // Should use the weak support, not the strong resistance
    expect(result).toBe("high");
  });
});
