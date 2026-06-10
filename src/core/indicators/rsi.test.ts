import { describe, expect, test } from "bun:test";
import { calculateRSI } from "./rsi.ts";

describe("RSI", () => {
  test("monotonic uptrend → RSI above 50 once warm", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 100 + i);
    const r = calculateRSI(closes, 14);
    expect(r.values.filter((v) => v !== null).length).toBeGreaterThan(0);
    expect(r.current!).toBeGreaterThan(50);
    expect(["neutral", "overbought"]).toContain(r.signal);
    expect(r.period).toBe(14);
  });

  test("monotonic downtrend → RSI below 50 once warm", () => {
    const closes = Array.from({ length: 20 }, (_, i) => 120 - i);
    const r = calculateRSI(closes, 14);
    expect(r.current!).toBeLessThan(50);
  });

  test("insufficient data → all null, current null", () => {
    const r = calculateRSI([100, 101, 102], 14);
    expect(r.values.every((v) => v === null)).toBe(true);
    expect(r.current).toBeNull();
    expect(r.action).toBe("hold");
  });

  test("prefix nulls then numeric values aligned to closes length", () => {
    const closes = Array.from({ length: 16 }, (_, i) => 100 + i * 0.5);
    const r = calculateRSI(closes, 14);
    expect(r.values.length).toBe(closes.length);
    expect(r.values.slice(0, 14).every((v) => v === null)).toBe(true);
    expect(r.values[15]).not.toBeNull();
  });
});