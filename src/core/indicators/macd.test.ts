import { describe, expect, test } from "bun:test";
import { calculateMACD } from "./macd.ts";

function syntheticCloses(n: number, start = 100, step = 0.3): number[] {
  return Array.from({ length: n }, (_, i) => start + i * step);
}

describe("MACD", () => {
  test("sufficient data → aligned macd/signal/histogram series", () => {
    const closes = syntheticCloses(40);
    const r = calculateMACD(closes);
    expect(r.macd.length).toBe(closes.length);
    expect(r.signal.length).toBe(closes.length);
    expect(r.histogram.length).toBe(closes.length);
    expect(r.current.macd).not.toBeNull();
    expect(r.current.signal).not.toBeNull();
    expect(r.current.histogram).not.toBeNull();
    expect(["bullish", "bearish", "neutral"]).toContain(r.trend);
    expect(["bullish_cross", "bearish_cross", "none"]).toContain(r.crossover);
    expect(r.interpretation.length).toBeGreaterThan(0);
  });

  test("histogram equals macd minus signal at last bar", () => {
    const closes = syntheticCloses(50, 100, 0.8);
    const r = calculateMACD(closes);
    const { macd, signal, histogram } = r.current;
    expect(macd).not.toBeNull();
    expect(signal).not.toBeNull();
    expect(histogram).toBeCloseTo(macd! - signal!, 10);
  });

  test("insufficient data → all null series", () => {
    const closes = syntheticCloses(20);
    const r = calculateMACD(closes);
    expect(r.macd.every((v) => v === null)).toBe(true);
    expect(r.current.macd).toBeNull();
    expect(r.interpretation).toContain("Insufficient data");
  });
});