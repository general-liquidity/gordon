import { describe, expect, it } from "bun:test";
import { calculateGMMA } from "./gmma.ts";

const rising = Array.from({ length: 140 }, (_, i) => 100 * 1.005 ** i);
const falling = Array.from({ length: 140 }, (_, i) => 100 * 0.995 ** i);
const flat = Array.from({ length: 140 }, (_, i) => 100 + 0.5 * Math.sin(i * 0.3));

describe("calculateGMMA", () => {
  it("steady uptrend: trader bundle above investor, trend up", () => {
    const r = calculateGMMA(rising);
    expect(r.traderMean).toBeGreaterThan(r.investorMean);
    expect(r.separationPct).toBeGreaterThan(0);
    expect(r.trend).toBe("up");
    expect(["trend_up", "breakout", "exhaustion"]).toContain(r.signal);
  });

  it("steady downtrend: trader bundle below investor, trend down", () => {
    const r = calculateGMMA(falling);
    expect(r.traderMean).toBeLessThan(r.investorMean);
    expect(r.trend).toBe("down");
    expect(r.signal).toBe("trend_down");
  });

  it("flat/oscillating: bundles intertwined → neutral, narrow investor band", () => {
    const r = calculateGMMA(flat);
    expect(r.trend).toBe("neutral");
    expect(r.investorSpreadPct).toBeLessThan(1); // tightly compressed band
    expect(["neutral"]).toContain(r.signal);
  });

  it("flat-then-rally flips to an uptrend signal without NaN", () => {
    const series = [
      ...Array.from({ length: 80 }, () => 100 + 0.3 * Math.sin(Math.random())),
      ...Array.from({ length: 40 }, (_, i) => 100 * 1.01 ** (i + 1)),
    ];
    const r = calculateGMMA(series);
    expect(Number.isFinite(r.separationPct)).toBe(true);
    expect(r.trend).toBe("up");
  });

  it("exposes the 6+6 bundle values", () => {
    const r = calculateGMMA(rising);
    expect(r.trader).toHaveLength(6);
    expect(r.investor).toHaveLength(6);
  });

  it("insufficient data (<60 closes) is neutral/empty", () => {
    const r = calculateGMMA(rising.slice(0, 40));
    expect(r.signal).toBe("neutral");
    expect(r.trader).toHaveLength(0);
  });
});
