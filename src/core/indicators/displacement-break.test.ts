import { describe, it, expect } from "bun:test";
import { calculateDisplacementBreak } from "./displacement-break.ts";
import type { Candle } from "./types.ts";

// Helper: build a candle from a single price (flat OHLC) unless overrides given.
function c(price: number, o?: Partial<Candle>): Candle {
  return {
    open: price,
    high: o?.high ?? price,
    low: o?.low ?? price,
    close: o?.close ?? price,
    volume: o?.volume ?? 100,
  };
}

describe("calculateDisplacementBreak", () => {
  it("(e) returns neutral on insufficient data", () => {
    const candles = [c(10), c(11), c(12)];
    const r = calculateDisplacementBreak(candles);
    expect(r.break).toBe("none");
    expect(r.valid).toBe(false);
    expect(r.ratio).toBe(null);
    expect(r.breakLeg).toBe(null);
    expect(r.priorLeg).toBe(null);
    expect(r.brokenLevel).toBe(null);
    expect(r.interpretation).toBe("Insufficient data for displacement break");
  });

  it("(d) reports no break when close stays inside structure", () => {
    // Oscillating range, latest close in the middle — no swing exceeded.
    const candles: Candle[] = [
      c(10),
      c(11),
      c(15, { high: 15 }), // pivot high candidate
      c(11),
      c(8, { low: 8 }), // pivot low candidate
      c(11),
      c(14, { high: 14 }),
      c(11),
      c(12), // latest close: above low(8), below high(15)
    ];
    const r = calculateDisplacementBreak(candles);
    expect(r.break).toBe("none");
    expect(r.valid).toBe(false);
    expect(r.ratio).toBe(null);
  });

  it("(a) valid bearish break: small up-leg then large down-impulse, ratio >= 1.5", () => {
    // Build: pivot LOW at index 2 (low=10), pivot HIGH at index 7 (high=12),
    // prior swing leg = |12 - 10| = 2 (small up-leg).
    // Then the most recent pivot before the break is the HIGH at 12; but the
    // structural low being broken is the pivot LOW at 10. The break impulse
    // drops to low=4, breaking below 10. breakLeg measured from broken pivot.
    const candles: Candle[] = [
      c(11),
      c(11),
      c(10, { low: 10 }), // idx2 pivot LOW = 10
      c(11),
      c(11),
      c(11),
      c(11),
      c(12, { high: 12 }), // idx7 pivot HIGH = 12
      c(11),
      c(11),
      c(8, { low: 8, close: 8 }),
      c(4, { low: 4, close: 4 }), // breaking impulse: close 4 < pivot low 10
    ];
    const r = calculateDisplacementBreak(candles);
    expect(r.break).toBe("bearish");
    expect(r.brokenLevel).toBe(10);
    // priorLeg = |12 - 10| = 2 ; breakLeg = |10 - 4| = 6 ; ratio = 3.0
    expect(r.priorLeg).toBe(2);
    expect(r.breakLeg).toBe(6);
    expect(r.ratio).toBe(3);
    expect(r.valid).toBe(true);
    expect(r.interpretation).toContain("Valid");
  });

  it("(b) weak bearish break: big prior leg, tiny one-candle poke, ratio < 1.5", () => {
    // Big prior swing: pivot HIGH=30 then pivot LOW=10 → priorLeg = 20.
    // Latest close pokes just below 10 (to 9), breakLeg = |10 - 9| = 1.
    // ratio = 1/20 = 0.05 < 1.5 → break detected, valid=false.
    const candles: Candle[] = [
      c(20),
      c(20),
      c(30, { high: 30 }), // idx2 pivot HIGH = 30
      c(20),
      c(20),
      c(20),
      c(20),
      c(10, { low: 10 }), // idx7 pivot LOW = 10
      c(11),
      c(11),
      c(11),
      c(9, { low: 9, close: 9 }), // tiny poke below 10
    ];
    const r = calculateDisplacementBreak(candles);
    expect(r.break).toBe("bearish");
    expect(r.brokenLevel).toBe(10);
    expect(r.priorLeg).toBe(20);
    expect(r.breakLeg).toBe(1);
    expect(r.ratio).toBe(0.05);
    expect(r.valid).toBe(false);
    expect(r.interpretation).toContain("Weak");
  });

  it("(c) valid bullish break mirror: small down-leg then large up-impulse", () => {
    // pivot HIGH=10 at idx2, pivot LOW=8 at idx7 → priorLeg = |8 - 10| = 2.
    // Latest close breaks above pivot high 10 with high=16.
    // breakLeg = |10 - 16| = 6 ; ratio = 3.0 → valid.
    const candles: Candle[] = [
      c(9),
      c(9),
      c(10, { high: 10 }), // idx2 pivot HIGH = 10
      c(9),
      c(9),
      c(9),
      c(9),
      c(8, { low: 8 }), // idx7 pivot LOW = 8
      c(9),
      c(9),
      c(13, { high: 13, close: 13 }),
      c(16, { high: 16, close: 16 }), // breaking impulse: close 16 > pivot high 10
    ];
    const r = calculateDisplacementBreak(candles);
    expect(r.break).toBe("bullish");
    expect(r.brokenLevel).toBe(10);
    expect(r.priorLeg).toBe(2);
    expect(r.breakLeg).toBe(6);
    expect(r.ratio).toBe(3);
    expect(r.valid).toBe(true);
    expect(r.interpretation).toContain("Valid");
  });

  it("respects a custom minRatio threshold", () => {
    const candles: Candle[] = [
      c(11),
      c(11),
      c(10, { low: 10 }),
      c(11),
      c(11),
      c(11),
      c(11),
      c(12, { high: 12 }),
      c(11),
      c(11),
      c(8, { low: 8, close: 8 }),
      c(4, { low: 4, close: 4 }),
    ];
    // ratio = 3.0; with minRatio 5 it should be flagged weak.
    const r = calculateDisplacementBreak(candles, { minRatio: 5 });
    expect(r.ratio).toBe(3);
    expect(r.valid).toBe(false);
    expect(r.minRatio).toBe(5);
  });
});
