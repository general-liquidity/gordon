import { describe, expect, test } from "bun:test";
import { calculateSadf } from "./sadf.ts";
import type { Candle } from "./types.ts";

// Seeded LCG for reproducible noise.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff; // [0,1)
  };
}

function toCandles(prices: number[]): Candle[] {
  return prices.map((p) => ({ open: p, high: p, low: p, close: p, volume: 1 }));
}

function explosiveSeries(n: number, seed: number): number[] {
  const rng = lcg(seed);
  const out: number[] = [1];
  for (let i = 1; i < n; i++) {
    const noise = (rng() - 0.5) * 0.02;
    out.push(1.05 * out[i - 1]! + noise);
  }
  return out;
}

function ouSeries(n: number, seed: number): number[] {
  const rng = lcg(seed);
  const mean = 100;
  const out: number[] = [mean];
  for (let i = 1; i < n; i++) {
    const noise = (rng() - 0.5) * 4;
    // Strong mean reversion: x_t = x_{t-1} + 0.5*(mean - x_{t-1}) + noise.
    out.push(out[i - 1]! + 0.5 * (mean - out[i - 1]!) + noise);
  }
  return out;
}

describe("calculateSadf", () => {
  const explosive = calculateSadf(toCandles(explosiveSeries(120, 42)));
  const stationary = calculateSadf(toCandles(ouSeries(120, 7)));

  test("explosive bubble series → positive SADF, isExplosive true", () => {
    expect(explosive.sadf).toBeGreaterThan(0);
    expect(explosive.isExplosive).toBe(true);
  });

  test("stationary mean-reverting series → low/negative SADF, isExplosive false", () => {
    expect(stationary.isExplosive).toBe(false);
    expect(stationary.sadf).toBeLessThan(1.5);
  });

  test("explosive SADF clearly exceeds stationary SADF", () => {
    expect(explosive.sadf).toBeGreaterThan(stationary.sadf);
  });

  test("insufficient data → neutral", () => {
    const res = calculateSadf(toCandles([1, 2, 3, 4, 5]));
    expect(res.sadf).toBe(0);
    expect(res.isExplosive).toBe(false);
    expect(res.series.every((v) => v == null)).toBe(true);
    expect(res.interpretation).toContain("Insufficient");
  });

  test("series is null until minWindow then populated", () => {
    expect(explosive.series[0]).toBeNull();
    expect(explosive.series[explosive.minWindow - 2]).toBeNull();
    expect(explosive.series[explosive.series.length - 1]).not.toBeNull();
  });
});
