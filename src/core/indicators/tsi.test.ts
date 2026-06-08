import { describe, expect, it } from "bun:test";
import { calculateTSI } from "./tsi.ts";

describe("calculateTSI", () => {
  it("steady uptrend → strongly positive TSI, bullish zero-line", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 100 + i); // m = +1 each bar
    const r = calculateTSI(closes);
    expect(r.current!).toBeGreaterThan(50); // m == |m| → TSI → +100
    expect(r.current!).toBeLessThanOrEqual(100);
    expect(r.zeroLine).toBe("bullish");
  });

  it("steady downtrend → strongly negative TSI, bearish", () => {
    const closes = Array.from({ length: 80 }, (_, i) => 200 - i);
    const r = calculateTSI(closes);
    expect(r.current!).toBeLessThan(-50);
    expect(r.current!).toBeGreaterThanOrEqual(-100);
    expect(r.zeroLine).toBe("bearish");
  });

  it("choppy/flat → TSI near zero", () => {
    const closes = Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i) * 0.5);
    const r = calculateTSI(closes);
    expect(Math.abs(r.current!)).toBeLessThan(40); // momentum largely cancels
  });

  it("TSI is bounded in [−100, 100]", () => {
    const closes = Array.from({ length: 120 }, (_, i) => 100 + 10 * Math.sin(i * 0.4) + i * 0.1);
    const r = calculateTSI(closes);
    for (const v of r.values) if (v !== null) {
      expect(v).toBeGreaterThanOrEqual(-100.0001);
      expect(v).toBeLessThanOrEqual(100.0001);
    }
  });

  it("flips to a bullish crossover when a downtrend turns up", () => {
    const down = Array.from({ length: 50 }, (_, i) => 150 - i);
    const up = Array.from({ length: 40 }, (_, i) => 100 + i * 1.5);
    const r = calculateTSI([...down, ...up]);
    expect(["bullish", "none"]).toContain(r.crossover);
    expect(Number.isFinite(r.current!)).toBe(true);
    expect(r.current!).toBeGreaterThan(0); // recovered into positive momentum by the end
  });

  it("insufficient data → neutral/empty", () => {
    const r = calculateTSI(Array.from({ length: 20 }, (_, i) => 100 + i));
    expect(r.current).toBeNull();
    expect(r.zeroLine).toBe("neutral");
  });
});
