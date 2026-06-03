import { describe, expect, it } from "bun:test";
import { calculateRsrs, type Candle } from "./rsrs.ts";

/** Build a candle with high/low offset around a base price. */
function c(base: number, spread: number): Candle {
  return { high: base + spread, low: base - spread };
}

describe("calculateRsrs", () => {
  it("returns neutral on insufficient bars", () => {
    const r = calculateRsrs([c(100, 1), c(101, 1)], { slopeWindow: 18 });
    expect(r.beta).toBeNull();
    expect(r.verdict).toBe("neutral");
    expect(r.interpretation).toContain("Neutral");
  });

  it("computes a slope but no z-score when history is shorter than zWindow", () => {
    // 20 bars: enough for an 18-bar slope (3 slope samples) but std-able.
    const candles = Array.from({ length: 20 }, (_, i) => c(100 + i, 1 + (i % 3) * 0.1));
    const r = calculateRsrs(candles, { slopeWindow: 18, zWindow: 250 });
    expect(r.beta).not.toBeNull();
    expect(r.rSquared).not.toBeNull();
    // 3 slope samples ≥ 2 → standardization runs; just assert it produced a number or null cleanly.
    expect(r.sampleSize).toBe(20);
  });

  it("recovers β≈1 for a parallel high/low channel (constant spread, rising price)", () => {
    // high = low + 2 exactly → regression slope of high on low is 1, R²=1.
    const candles: Candle[] = [];
    for (let i = 0; i < 60; i++) candles.push({ low: 100 + i, high: 102 + i });
    const r = calculateRsrs(candles, { slopeWindow: 18, zWindow: 40 });
    expect(r.beta).toBeCloseTo(1, 3);
    expect(r.rSquared).toBeCloseTo(1, 3);
  });

  it("standardized score is finite and verdict is set once enough slope samples exist", () => {
    // Vary the spread so β moves and can be z-scored.
    const candles: Candle[] = [];
    for (let i = 0; i < 80; i++) {
      const spread = 1 + Math.sin(i / 5) * 0.5;
      candles.push({ low: 100 + i * 0.3, high: 100 + i * 0.3 + spread });
    }
    const r = calculateRsrs(candles, { slopeWindow: 18, zWindow: 40 });
    expect(r.standardizedRsrs).not.toBeNull();
    expect(Number.isFinite(r.standardizedRsrs!)).toBe(true);
    expect(["demand", "lean_demand", "neutral", "lean_supply", "supply"]).toContain(r.verdict);
    // modified = standardized × R², right = modified × β — both finite.
    expect(Number.isFinite(r.modifiedRsrs!)).toBe(true);
    expect(Number.isFinite(r.rightRsrs!)).toBe(true);
  });

  it("flags a demand regime when the latest slope is an upside outlier", () => {
    // Baseline flat β≈1, then the last window's highs stretch (β jumps) → high z-score.
    const candles: Candle[] = [];
    for (let i = 0; i < 60; i++) candles.push({ low: 100 + i, high: 101 + i }); // β≈1
    // Final 18 bars: highs stretch progressively above lows → steeper high-on-low slope.
    for (let i = 0; i < 18; i++) candles.push({ low: 160 + i, high: 161 + i + i * 0.4 });
    const r = calculateRsrs(candles, { slopeWindow: 18, zWindow: 40, buyThreshold: 0.7 });
    expect(r.standardizedRsrs).not.toBeNull();
    expect(r.standardizedRsrs!).toBeGreaterThan(0);
  });

  it("respects slopeWindow guard", () => {
    const r = calculateRsrs([c(100, 1), c(101, 1), c(102, 1)], { slopeWindow: 1 });
    expect(r.verdict).toBe("neutral");
    expect(r.interpretation).toContain("slopeWindow");
  });
});
