import { describe, expect, it } from "bun:test";
import { calculateCusumFilter } from "./cusum-filter.ts";
import type { Candle } from "./types.ts";

function mkCandle(close: number): Candle {
  return { open: close, high: close, low: close, close, volume: 1 };
}

function fromCloses(closes: number[]): Candle[] {
  return closes.map(mkCandle);
}

describe("calculateCusumFilter", () => {
  it("emits zero events on a flat / tiny-noise series", () => {
    const closes: number[] = [];
    let p = 100;
    for (let i = 0; i < 50; i++) {
      // alternating ±0.01% noise — far below any reasonable threshold
      p = p * (i % 2 === 0 ? 1.0001 : 0.9999);
      closes.push(p);
    }
    const res = calculateCusumFilter(fromCloses(closes), { threshold: 0.05 });
    expect(res.eventCount).toBe(0);
    expect(res.eventIndices).toEqual([]);
    expect(res.firedThisBar).toBe(false);
    expect(res.lastEventIndex).toBeNull();
  });

  it("fires events at the indices of large up/down jumps", () => {
    // flat base, big up jump at index 5, big down jump at index 10
    const closes = [100, 100, 100, 100, 100, 120, 120, 120, 120, 120, 100];
    const res = calculateCusumFilter(fromCloses(closes), { threshold: 0.1 });
    expect(res.eventIndices).toContain(5);
    expect(res.eventIndices).toContain(10);
    // last bar (index 10) is the down jump → firedThisBar
    expect(res.lastEventIndex).toBe(10);
    expect(res.firedThisBar).toBe(true);
  });

  it("fires fewer (monotonic) events as threshold increases", () => {
    const closes: number[] = [];
    let p = 100;
    const seed = [1.03, 0.97, 1.04, 0.96, 1.05, 0.95, 1.02, 0.98];
    for (let i = 0; i < 40; i++) {
      p = p * seed[i % seed.length]!;
      closes.push(p);
    }
    const candles = fromCloses(closes);
    const low = calculateCusumFilter(candles, { threshold: 0.01 });
    const mid = calculateCusumFilter(candles, { threshold: 0.05 });
    const high = calculateCusumFilter(candles, { threshold: 0.2 });
    expect(low.eventCount).toBeGreaterThanOrEqual(mid.eventCount);
    expect(mid.eventCount).toBeGreaterThanOrEqual(high.eventCount);
  });

  it("is neutral with fewer than 3 candles", () => {
    const res = calculateCusumFilter(fromCloses([100, 101]));
    expect(res.eventCount).toBe(0);
    expect(res.eventIndices).toEqual([]);
    expect(res.threshold).toBe(0);
    expect(res.lastEventIndex).toBeNull();
    expect(res.firedThisBar).toBe(false);
    expect(res.interpretation).toContain("Insufficient");
  });

  it("defaults threshold to stdev of log returns", () => {
    const closes = [100, 102, 101, 103, 100, 104, 99];
    const res = calculateCusumFilter(fromCloses(closes));
    expect(res.threshold).toBeGreaterThan(0);
  });
});
