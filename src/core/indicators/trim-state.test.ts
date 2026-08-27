import { describe, expect, test } from "bun:test";
import { calculateTrimState } from "./trim-state.ts";
import type { Candle } from "./types.ts";

/** Build a Candle from close-only data. high = close * 1.005, low = close * 0.995. */
function c(close: number, opts: { high?: number; low?: number; volume?: number } = {}): Candle {
  return {
    open: close,
    high: opts.high ?? close * 1.005,
    low: opts.low ?? close * 0.995,
    close,
    volume: opts.volume ?? 1_000_000,
  };
}

/** Steady uptrend, then breakdown — enough bars to seat the 50 EMA. */
function uptrendThenBreakdown(
  steps: { phase: "up" | "side" | "down"; bars: number; rate: number }[],
): Candle[] {
  const closes: number[] = [];
  let price = 100;
  for (const step of steps) {
    for (let i = 0; i < step.bars; i++) {
      if (step.phase === "up") price = price * (1 + step.rate);
      else if (step.phase === "down") price = price * (1 - step.rate);
      // "side" leaves price unchanged
      closes.push(price);
    }
  }
  return closes.map((p) => c(p));
}

describe("calculateTrimState", () => {
  test("handles empty candles without throwing", () => {
    const r = calculateTrimState([]);
    expect(r.severityLevel).toBe(0);
    expect(r.ema8).toBeNull();
    expect(r.reachedFirstResistance).toBeNull();
  });

  test("reachedFirstResistance is null when no level supplied", () => {
    const candles = uptrendThenBreakdown([{ phase: "up", bars: 80, rate: 0.01 }]);
    const r = calculateTrimState(candles, { entryBarIndex: 60 });
    expect(r.reachedFirstResistance).toBeNull();
  });

  test("reachedFirstResistance is true when a post-entry high reaches the level", () => {
    const candles = uptrendThenBreakdown([{ phase: "up", bars: 80, rate: 0.01 }]);
    // Entry at bar 60 — by bar 79 (last), price has risen substantially.
    const entryPrice = candles[60]!.close;
    const target = entryPrice * 1.05;
    const r = calculateTrimState(candles, { entryBarIndex: 60, firstResistanceLevel: target });
    expect(r.reachedFirstResistance).toBe(true);
  });

  test("reachedFirstResistance is false when no post-entry high reaches the level", () => {
    const candles = uptrendThenBreakdown([{ phase: "up", bars: 80, rate: 0.01 }]);
    // Pick a level far above any high since entry.
    const r = calculateTrimState(candles, { entryBarIndex: 60, firstResistanceLevel: 10_000 });
    expect(r.reachedFirstResistance).toBe(false);
  });

  test("severityLevel = 1 when first resistance hit but EMAs intact", () => {
    const candles = uptrendThenBreakdown([{ phase: "up", bars: 80, rate: 0.01 }]);
    // Price keeps climbing — latest close is above all EMAs. Set a
    // resistance below current price so it's already been hit.
    const last = candles[candles.length - 1]!.close;
    const r = calculateTrimState(candles, {
      entryBarIndex: 60,
      firstResistanceLevel: last * 0.95,
    });
    expect(r.latestCloseBelowEma8).toBe(false);
    expect(r.severityLevel).toBe(1);
    expect(r.recommendation).toContain("First resistance");
  });

  test("severityLevel = 2 when latest close drops below 8 EMA only", () => {
    // 60 bars rising at +2%: spot ≈ 328, 8 EMA ≈ 301 (~8% lag), 21 EMA
    // ≈ 268, 50 EMA ≈ 217. Two -5% bars drop close to ≈ 296 — under
    // the 8 EMA but well above the 21/50.
    const candles = uptrendThenBreakdown([
      { phase: "up", bars: 60, rate: 0.02 },
      { phase: "down", bars: 2, rate: 0.05 },
    ]);
    const r = calculateTrimState(candles, { entryBarIndex: 30 });
    expect(r.latestCloseBelowEma8).toBe(true);
    expect(r.latestCloseBelowEma21).toBe(false);
    expect(r.latestCloseBelowEma50).toBe(false);
    expect(r.severityLevel).toBe(2);
  });

  test("severityLevel = 4 when latest close is below 50 EMA", () => {
    // Long uptrend then sharp multi-bar breakdown.
    const candles = uptrendThenBreakdown([
      { phase: "up", bars: 60, rate: 0.02 },
      { phase: "down", bars: 12, rate: 0.05 },
    ]);
    const r = calculateTrimState(candles, { entryBarIndex: 30 });
    expect(r.latestCloseBelowEma50).toBe(true);
    expect(r.severityLevel).toBe(4);
    expect(r.recommendation).toContain("50 EMA");
  });

  test("close-below counts only the bars after entryBarIndex", () => {
    // Down-then-up: first 30 bars drop (many closes below EMA, but
    // these are BEFORE entry), then a long rally. The 8 EMA lags the
    // turn — entering right at the bottom would still count
    // closes-below for ~5 bars while the EMA catches up. Enter 15 bars
    // into the rally so spot has cleanly crossed above the EMA.
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 30; i++) {
      p = p * 0.98;
      closes.push(p);
    }
    for (let i = 0; i < 60; i++) {
      p = p * 1.02;
      closes.push(p);
    }
    const candles = closes.map((x) => c(x));
    const r = calculateTrimState(candles, { entryBarIndex: 45 });
    expect(r.closesBelowEma8SinceEntry).toBe(0);
  });

  test("daysSinceEntry matches lastIdx - entryIdx", () => {
    const candles = uptrendThenBreakdown([{ phase: "up", bars: 80, rate: 0.01 }]);
    const r = calculateTrimState(candles, { entryBarIndex: 40 });
    expect(r.daysSinceEntry).toBe(39);
  });

  test("clamps entryBarIndex to valid range", () => {
    const candles = uptrendThenBreakdown([{ phase: "up", bars: 80, rate: 0.01 }]);
    const r = calculateTrimState(candles, { entryBarIndex: 999 });
    // Clamped to last bar — no bars after entry.
    expect(r.daysSinceEntry).toBe(0);
    expect(r.closesBelowEma8SinceEntry).toBe(0);
  });
});
