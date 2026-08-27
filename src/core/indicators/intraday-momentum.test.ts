import { describe, it, expect } from "bun:test";
import { calculateIntradayMomentum } from "./intraday-momentum.ts";
import type { Candle } from "./types.ts";

/**
 * Build a single day of `barsPerDay` bars where the first `firstW` bars produce
 * a window return of `firstRet` and the last `lastW` bars produce `lastRet`.
 * Middle bars are flat. Each bar's open==close so a window return over bars
 * [a..b] = (close[b]-open[a])/open[a] is fully controlled.
 */
function makeDay(
  barsPerDay: number,
  firstW: number,
  lastW: number,
  firstRet: number,
  lastRet: number,
  base = 100,
): Candle[] {
  const bars: Candle[] = [];
  // First window: open at base, close so (close - base)/base = firstRet.
  const firstClose = base * (1 + firstRet);
  for (let i = 0; i < firstW; i++) {
    const open = i === 0 ? base : firstClose;
    const close = firstClose;
    bars.push(bar(open, close));
  }
  // Middle flat bars at firstClose.
  const mid = barsPerDay - firstW - lastW;
  for (let i = 0; i < mid; i++) bars.push(bar(firstClose, firstClose));
  // Last window: open at firstClose, close so (close - firstClose)/firstClose = lastRet.
  const lastClose = firstClose * (1 + lastRet);
  for (let i = 0; i < lastW; i++) {
    const open = i === 0 ? firstClose : lastClose;
    const close = lastClose;
    bars.push(bar(open, close));
  }
  return bars;
}

function bar(open: number, close: number): Candle {
  const high = Math.max(open, close);
  const low = Math.min(open, close);
  return { open, high, low, close, volume: 1000 };
}

describe("calculateIntradayMomentum", () => {
  const barsPerDay = 24;
  const firstWindowBars = 6;
  const predictWindowBars = 6;

  it("high hit-rate: first-window sign reliably predicts last-window sign", () => {
    const days: Candle[][] = [
      makeDay(barsPerDay, 6, 6, 0.01, 0.008),
      makeDay(barsPerDay, 6, 6, -0.01, -0.006),
      makeDay(barsPerDay, 6, 6, 0.02, 0.012),
      makeDay(barsPerDay, 6, 6, -0.015, -0.009),
      makeDay(barsPerDay, 6, 6, 0.005, 0.004),
    ];
    const candles = days.flat();
    const r = calculateIntradayMomentum(candles, {
      firstWindowBars,
      predictWindowBars,
      barsPerDay,
    });

    expect(r.sampleDays).toBe(5);
    expect(r.hitRate).toBe(1);
    expect(r.meanLastGivenPositiveFirst).not.toBeNull();
    expect(r.meanLastGivenNegativeFirst).not.toBeNull();
    expect(r.meanLastGivenPositiveFirst!).toBeGreaterThan(0);
    expect(r.meanLastGivenNegativeFirst!).toBeLessThan(0);
    // Latest day's first window is positive (0.005) → long.
    expect(r.signal).toBe("long");
    expect(r.currentFirstReturn).not.toBeNull();
    expect(r.currentFirstReturn!).toBeGreaterThan(0);
  });

  it("no predictive power: first and last signs uncorrelated → hit-rate ~0.5", () => {
    // Alternate so half the days match and half don't.
    const days: Candle[][] = [
      makeDay(barsPerDay, 6, 6, 0.01, 0.01), // match
      makeDay(barsPerDay, 6, 6, 0.01, -0.01), // miss
      makeDay(barsPerDay, 6, 6, -0.01, -0.01), // match
      makeDay(barsPerDay, 6, 6, -0.01, 0.01), // miss
    ];
    const candles = days.flat();
    const r = calculateIntradayMomentum(candles, {
      firstWindowBars,
      predictWindowBars,
      barsPerDay,
    });

    expect(r.sampleDays).toBe(4);
    expect(r.hitRate).toBe(0.5);
  });

  it("single session (no barsPerDay): first-window return drives signal, no cross-day stats", () => {
    const candles = makeDay(barsPerDay, 6, 6, 0.02, 0.01);
    const r = calculateIntradayMomentum(candles, { firstWindowBars, predictWindowBars });

    expect(r.hitRate).toBeNull();
    expect(r.sampleDays).toBe(0);
    expect(r.signal).toBe("long");
    expect(r.currentFirstReturn).not.toBeNull();
    expect(r.currentFirstReturn!).toBeGreaterThan(0);

    const candlesDown = makeDay(barsPerDay, 6, 6, -0.02, 0.01);
    const rDown = calculateIntradayMomentum(candlesDown, { firstWindowBars, predictWindowBars });
    expect(rDown.signal).toBe("short");
  });

  it("insufficient data: fewer than firstWindowBars+predictWindowBars bars → neutral", () => {
    const candles: Candle[] = Array.from({ length: 5 }, () => bar(100, 100));
    const r = calculateIntradayMomentum(candles, { firstWindowBars, predictWindowBars });

    expect(r.signal).toBe("flat");
    expect(r.hitRate).toBeNull();
    expect(r.sampleDays).toBe(0);
    expect(r.currentFirstReturn).toBeNull();
    expect(r.interpretation).toBe("Insufficient data for intraday momentum");
  });

  it("insufficient data: barsPerDay given but only one full day → neutral", () => {
    const candles = makeDay(barsPerDay, 6, 6, 0.01, 0.01);
    const r = calculateIntradayMomentum(candles, {
      firstWindowBars,
      predictWindowBars,
      barsPerDay,
    });

    expect(r.signal).toBe("flat");
    expect(r.sampleDays).toBe(0);
    expect(r.hitRate).toBeNull();
    expect(r.currentFirstReturn).toBeNull();
  });

  it("ignores days with a zero first-window return when scoring hit-rate", () => {
    const days: Candle[][] = [
      makeDay(barsPerDay, 6, 6, 0, 0.01), // first return 0 → ignored
      makeDay(barsPerDay, 6, 6, 0.01, 0.01), // match
      makeDay(barsPerDay, 6, 6, -0.01, -0.01), // match
    ];
    const candles = days.flat();
    const r = calculateIntradayMomentum(candles, {
      firstWindowBars,
      predictWindowBars,
      barsPerDay,
    });

    expect(r.sampleDays).toBe(2);
    expect(r.hitRate).toBe(1);
  });

  it("uses trailing partial day for the live signal", () => {
    // Two full days plus a partial day with a positive first window.
    const full = [
      makeDay(barsPerDay, 6, 6, -0.01, -0.01),
      makeDay(barsPerDay, 6, 6, -0.01, -0.01),
    ].flat();
    const partial = makeDay(barsPerDay, 6, 6, 0.03, 0.0).slice(0, firstWindowBars + 1);
    const r = calculateIntradayMomentum([...full, ...partial], {
      firstWindowBars,
      predictWindowBars,
      barsPerDay,
    });

    expect(r.sampleDays).toBe(2);
    // Partial-day first window is positive → long, even though full days were negative.
    expect(r.signal).toBe("long");
    expect(r.currentFirstReturn!).toBeGreaterThan(0);
  });
});
