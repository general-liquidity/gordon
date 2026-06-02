import { describe, expect, test } from "bun:test";
import { calculateCboeOdds } from "./cboe-odds-oscillator.ts";
import type { Candle } from "./types.ts";

function bar(close: number, volume: number, range = 1): Candle {
  return {
    open: close,
    high: close + range / 2,
    low: close - range / 2,
    close,
    volume,
  };
}

// Enough bars to clear length + Stoch-RSI warmup.
const N = 70;

function sumOK(r: ReturnType<typeof calculateCboeOdds>) {
  for (let i = 0; i < r.oddBull.length; i++) {
    const b = r.oddBull[i];
    const be = r.oddBear[i];
    const s = r.oddStagnant[i];
    if (b == null || be == null || s == null) continue;
    // sums to ~100
    expect(b + be + s).toBeCloseTo(100, 1);
    // bounds [0,100]
    for (const v of [b, be, s]) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  }
}

describe("CBOE Odds Oscillator", () => {
  test("insufficient data → nulls + warmup interpretation", () => {
    const candles = [bar(10, 100), bar(11, 100)];
    const r = calculateCboeOdds(candles, { length: 14 });
    expect(r.current.marketIndex).toBeNull();
    expect(r.current.oddBull).toBeNull();
    expect(r.interpretation).toContain("Insufficient");
  });

  test("all-up high-volume → oddBull dominant, marketIndex → 100", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < N; i++) candles.push(bar(100 + i, 1000));
    const r = calculateCboeOdds(candles, { length: 14 });
    expect(r.current.marketIndex).toBeGreaterThan(95);
    expect(r.current.oddBull!).toBeGreaterThan(r.current.oddBear!);
    expect(r.current.oddBull!).toBeGreaterThan(r.current.oddStagnant!);
    expect(r.current.state).toBe("bull");
    sumOK(r);
  });

  test("all-down high-volume → oddBear dominant, marketIndex → 0", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < N; i++) candles.push(bar(200 - i, 1000));
    const r = calculateCboeOdds(candles, { length: 14 });
    expect(r.current.marketIndex).toBeLessThan(5);
    expect(r.current.oddBear!).toBeGreaterThan(r.current.oddBull!);
    expect(r.current.oddBear!).toBeGreaterThan(r.current.oddStagnant!);
    expect(r.current.state).toBe("bear");
    sumOK(r);
  });

  test("choppy/flat → oddStagnant elevated, marketIndex near 50", () => {
    const candles: Candle[] = [];
    let p = 100;
    for (let i = 0; i < N; i++) {
      p = i % 2 === 0 ? 100.5 : 99.5; // alternate up/down, equal volume
      candles.push(bar(p, 1000));
    }
    const r = calculateCboeOdds(candles, { length: 14 });
    expect(r.current.marketIndex!).toBeGreaterThan(35);
    expect(r.current.marketIndex!).toBeLessThan(65);
    // Stagnant should dominate in a balanced chop.
    expect(r.current.oddStagnant!).toBeGreaterThanOrEqual(r.current.oddBull!);
    expect(r.current.oddStagnant!).toBeGreaterThanOrEqual(r.current.oddBear!);
    sumOK(r);
  });

  test("hand-checked: pure inflow window → marketIndex = 100", () => {
    // strictly increasing closes → every windowed bar is an up bar, downFlow=0.
    const candles: Candle[] = [];
    for (let i = 0; i < 20; i++) candles.push(bar(100 + i, 500));
    const r = calculateCboeOdds(candles, { length: 14 });
    // last index marketIndex: down=0 → 100
    expect(r.current.marketIndex).toBe(100);
    // with bias=+1 all directional weight is bull, none bear
    expect(r.current.oddBear).toBe(0);
    expect(r.current.oddBull! + r.current.oddStagnant!).toBeCloseTo(100, 1);
  });

  test("sum-to-100 + bounds hold on a mixed random-ish series", () => {
    const candles: Candle[] = [];
    let p = 100;
    const seq = [2, -1, 3, -2, 1, 1, -3, 4, -1, 2, -2, -2, 5, 1, -1, 2, 3, -4, 1, 2];
    for (let i = 0; i < N; i++) {
      p += seq[i % seq.length]!;
      candles.push(bar(p, 300 + (i % 5) * 100));
    }
    const r = calculateCboeOdds(candles, { length: 10, rsiPeriod: 10, stochPeriod: 10 });
    sumOK(r);
    expect(r.current.state).not.toBeNull();
  });
});
