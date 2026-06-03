import { describe, expect, test } from "bun:test";
import { calculateFracDiff } from "./frac-diff.ts";
import type { Candle } from "./types.ts";

function candle(close: number): Candle {
  return { open: close, high: close, low: close, close, volume: 1 };
}

function makeCandles(closes: number[]): Candle[] {
  return closes.map(candle);
}

function mean(xs: number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

describe("calculateFracDiff", () => {
  test("d=1 approximates the first difference", () => {
    const closes = [100, 102, 101, 105, 110, 108, 112];
    const res = calculateFracDiff(makeCandles(closes), { d: 1 });
    const lastDiff = closes[closes.length - 1]! - closes[closes.length - 2]!;
    expect(res.current).not.toBeNull();
    expect(Math.abs(res.current! - lastDiff)).toBeLessThan(1e-6);
  });

  test("d=0 returns the original series (w0 only)", () => {
    const closes = [50, 51, 49, 53, 60];
    const res = calculateFracDiff(makeCandles(closes), { d: 0 });
    expect(res.weightsUsed).toBe(1);
    expect(res.windowSize).toBe(1);
    expect(res.values).toEqual(closes);
    expect(res.current).toBeCloseTo(60, 8);
  });

  test("0<d<1 trending series: K>1, finite, near-stationary", () => {
    const closes = Array.from({ length: 1500 }, (_, i) => 100 + i * 0.7);
    const res = calculateFracDiff(makeCandles(closes), { d: 0.6 });

    expect(res.weightsUsed).toBeGreaterThan(2);

    const fd = res.values.filter((v): v is number => v != null);
    expect(fd.length).toBeGreaterThan(0);
    for (const v of fd) expect(Number.isFinite(v)).toBe(true);

    const rawMean = Math.abs(mean(closes));
    const fdMean = Math.abs(mean(fd));
    expect(fdMean).toBeLessThan(rawMean * 0.1);
  });

  test("windowSize grows as threshold shrinks", () => {
    const closes = Array.from({ length: 300 }, (_, i) => 100 + i * 0.5);
    const coarse = calculateFracDiff(makeCandles(closes), { d: 0.5, threshold: 1e-3 });
    const fine = calculateFracDiff(makeCandles(closes), { d: 0.5, threshold: 1e-7 });
    expect(fine.windowSize).toBeGreaterThan(coarse.windowSize);
  });

  test("<2 candles is neutral", () => {
    const res = calculateFracDiff(makeCandles([100]));
    expect(res.values).toEqual([]);
    expect(res.current).toBeNull();
    expect(res.windowSize).toBe(0);
    expect(res.weightsUsed).toBe(0);
    expect(res.interpretation).toContain("Insufficient");
  });
});
