import { describe, expect, test } from "bun:test";
import { calculateResistanceTests } from "./resistance-tests.ts";
import type { Candle } from "./types.ts";

function bar(opts: Partial<Candle> & { close: number }): Candle {
  return {
    open: opts.open ?? opts.close,
    high: opts.high ?? opts.close,
    low: opts.low ?? opts.close,
    close: opts.close,
    volume: opts.volume ?? 1_000_000,
  };
}

/** Helper — touch a level at index then pull back. Returns candles. */
function buildTestSeries(options: {
  level: number;
  touches: number[]; // bar indices where price touches the level
  pullbackPct: number; // pullback after each touch
  totalBars: number;
  baselineClose: number;
}): Candle[] {
  const { level, touches, pullbackPct, totalBars, baselineClose } = options;
  const candles: Candle[] = [];
  for (let i = 0; i < totalBars; i++) {
    if (touches.includes(i)) {
      candles.push(
        bar({
          close: level * (1 - pullbackPct),
          high: level * 1.001,
          low: level * (1 - pullbackPct) * 0.99,
        }),
      );
    } else {
      candles.push(bar({ close: baselineClose }));
    }
  }
  return candles;
}

describe("calculateResistanceTests", () => {
  test("handles empty candles", () => {
    const r = calculateResistanceTests([], 100);
    expect(r.testCount).toBe(0);
    expect(r.confidence).toBe(0);
  });

  test("handles invalid level", () => {
    const candles = [bar({ close: 100 }), bar({ close: 101 })];
    const r = calculateResistanceTests(candles, -5);
    expect(r.testCount).toBe(0);
  });

  test("counts a single touch + rejection", () => {
    const candles = buildTestSeries({
      level: 100,
      touches: [10],
      pullbackPct: 0.03,
      totalBars: 30,
      baselineClose: 92,
    });
    const r = calculateResistanceTests(candles, 100);
    expect(r.testCount).toBe(1);
    expect(r.lastTestBarsAgo).toBe(19);
    expect(r.confidence).toBeGreaterThan(0);
    expect(r.confidence).toBeLessThan(0.5);
  });

  test("counts three distinct tests with sufficient gap", () => {
    const candles = buildTestSeries({
      level: 100,
      touches: [10, 20, 30],
      pullbackPct: 0.025,
      totalBars: 40,
      baselineClose: 93,
    });
    const r = calculateResistanceTests(candles, 100);
    expect(r.testCount).toBe(3);
    expect(r.confidence).toBeCloseTo(0.85, 1);
  });

  test("collapses consecutive touches into one test", () => {
    const candles = buildTestSeries({
      level: 100,
      touches: [10, 11, 12], // back-to-back touches collapse
      pullbackPct: 0.025,
      totalBars: 30,
      baselineClose: 93,
    });
    const r = calculateResistanceTests(candles, 100);
    expect(r.testCount).toBe(1);
  });

  test("ignores touches without rejection (minRejectionPct gate)", () => {
    // Touch the level but only pull back 0.3% — below the 1% default.
    const candles = buildTestSeries({
      level: 100,
      touches: [10, 20, 30],
      pullbackPct: 0.003,
      totalBars: 40,
      baselineClose: 99.7,
    });
    const r = calculateResistanceTests(candles, 100);
    expect(r.testCount).toBe(0);
  });

  test("respects the windowBars limit", () => {
    // Touches are all > 60 bars ago — outside the default window.
    const candles = buildTestSeries({
      level: 100,
      touches: [5, 10, 15],
      pullbackPct: 0.03,
      totalBars: 100,
      baselineClose: 90,
    });
    const r = calculateResistanceTests(candles, 100, { windowBars: 30 });
    expect(r.testCount).toBe(0);
  });

  test("confidence caps at 1.0 for 4+ tests", () => {
    const candles = buildTestSeries({
      level: 100,
      touches: [10, 20, 30, 40, 50],
      pullbackPct: 0.025,
      totalBars: 60,
      baselineClose: 93,
    });
    const r = calculateResistanceTests(candles, 100);
    expect(r.testCount).toBeGreaterThanOrEqual(4);
    expect(r.confidence).toBe(1.0);
  });

  test("interpretation reflects test count", () => {
    const none = calculateResistanceTests([bar({ close: 50 }), bar({ close: 51 })], 100);
    expect(none.interpretation).toContain("hasn't been tested");

    const single = calculateResistanceTests(
      buildTestSeries({
        level: 100,
        touches: [10],
        pullbackPct: 0.025,
        totalBars: 30,
        baselineClose: 93,
      }),
      100,
    );
    expect(single.interpretation).toContain("once");

    const multi = calculateResistanceTests(
      buildTestSeries({
        level: 100,
        touches: [10, 20, 30],
        pullbackPct: 0.025,
        totalBars: 40,
        baselineClose: 93,
      }),
      100,
    );
    expect(multi.interpretation).toContain("well-defined");
  });

  test("avgRejectionPct averages across recorded tests", () => {
    // Two touches; baseline pulls back to 95 (a 5% rejection from the
    // level). The rejection scanner finds the DEEPEST close inside
    // rejectionWindow, so each touch maps to the 95-baseline pullback.
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) candles.push(bar({ close: 95 }));
    candles[10] = bar({ close: 98, high: 100.05, low: 97 });
    candles[20] = bar({ close: 96, high: 100.05, low: 95 });
    const r = calculateResistanceTests(candles, 100);
    expect(r.testCount).toBe(2);
    expect(r.avgRejectionPct).toBeCloseTo(0.05, 2);
  });
});
