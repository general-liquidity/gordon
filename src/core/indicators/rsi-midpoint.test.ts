import { describe, it, expect } from "bun:test";
import { calculateRsiMidpoint } from "./rsi-midpoint.ts";

/** Steady uptrend → RSI persistently > 50 → bullish bias. */
function bullishCloses(n: number): number[] {
  const out: number[] = [100];
  for (let i = 1; i < n; i++) {
    // mostly up, occasional tiny down so RSI isn't pinned at 100
    const step = i % 5 === 0 ? -0.3 : 1.2;
    out.push(out[i - 1]! + step);
  }
  return out;
}

/** Steady downtrend → RSI persistently < 50 → bearish bias. */
function bearishCloses(n: number): number[] {
  const out: number[] = [200];
  for (let i = 1; i < n; i++) {
    const step = i % 5 === 0 ? 0.3 : -1.2;
    out.push(out[i - 1]! + step);
  }
  return out;
}

/** Oscillating chop around a flat mean → RSI repeatedly crosses 50. */
function choppyCloses(n: number): number[] {
  const out: number[] = [100];
  for (let i = 1; i < n; i++) {
    // alternating up/down runs of length 2 → RSI swings across 50
    const phase = Math.floor((i - 1) / 2) % 2;
    const step = phase === 0 ? 1.0 : -1.0;
    out.push(out[i - 1]! + step);
  }
  return out;
}

describe("calculateRsiMidpoint", () => {
  it("flags a bullish bias on a persistent uptrend", () => {
    const res = calculateRsiMidpoint(bullishCloses(80));
    expect(res.bias).toBe("bullish");
    expect(res.pctAbove50).toBeGreaterThanOrEqual(0.6);
    expect(res.currentRsi).not.toBeNull();
    expect(res.currentRsi!).toBeGreaterThan(50);
    expect(res.distanceFrom50!).toBeGreaterThan(0);
    expect(res.consolidation).toBe(false);
    expect(res.rsiPeriod).toBe(14);
  });

  it("flags a bearish bias on a persistent downtrend", () => {
    const res = calculateRsiMidpoint(bearishCloses(80));
    expect(res.bias).toBe("bearish");
    expect(res.pctAbove50).toBeLessThanOrEqual(0.4);
    expect(res.currentRsi!).toBeLessThan(50);
    expect(res.distanceFrom50!).toBeLessThan(0);
    expect(res.consolidation).toBe(false);
  });

  it("detects consolidation when RSI chops across 50", () => {
    const res = calculateRsiMidpoint(choppyCloses(100));
    expect(res.crossings).toBeGreaterThan(0);
    expect(res.crossingsPerBar).toBeGreaterThanOrEqual(0.25);
    expect(res.meanAbsDevFrom50).toBeLessThanOrEqual(10);
    expect(res.consolidation).toBe(true);
    expect(res.bias).toBe("neutral");
    expect(res.lastTest).toBe("none");
  });

  it("classifies a held support test in a bullish regime", () => {
    const res = calculateRsiMidpoint(bullishCloses(80));
    expect(["held_support", "broke_support", "none"]).toContain(res.lastTest);
    // strong uptrend should not register a resistance test
    expect(res.lastTest).not.toBe("held_resistance");
    expect(res.lastTest).not.toBe("broke_resistance");
  });

  it("returns a neutral result on insufficient data", () => {
    const res = calculateRsiMidpoint([100, 101, 102]);
    expect(res.bias).toBe("neutral");
    expect(res.consolidation).toBe(false);
    expect(res.lastTest).toBe("none");
    expect(res.crossings).toBe(0);
    expect(res.pctAbove50).toBe(0);
    expect(res.currentRsi).toBeNull();
    expect(res.distanceFrom50).toBeNull();
    expect(res.interpretation).toBe(
      "Insufficient data for RSI midpoint analysis"
    );
  });

  it("returns neutral when fewer than ~5 non-null RSI values exist", () => {
    // period 14 needs 15 closes for first RSI; 17 closes → 3 RSI values < 5
    const closes = Array.from({ length: 17 }, (_, i) => 100 + i);
    const res = calculateRsiMidpoint(closes);
    expect(res.currentRsi).toBeNull();
    expect(res.bias).toBe("neutral");
  });

  it("honors a custom rsiPeriod and clamps lookback to available RSI count", () => {
    const res = calculateRsiMidpoint(bullishCloses(40), {
      rsiPeriod: 7,
      lookback: 200,
    });
    expect(res.rsiPeriod).toBe(7);
    // available non-null RSI = 40 - 7 = 33; lookback clamped to that
    expect(res.lookback).toBeLessThanOrEqual(33);
    expect(res.lookback).toBeGreaterThan(0);
  });

  it("rounds numeric outputs", () => {
    const res = calculateRsiMidpoint(choppyCloses(100));
    expect(res.meanAbsDevFrom50).toBe(
      parseFloat(res.meanAbsDevFrom50.toFixed(2))
    );
    expect(res.pctAbove50).toBe(parseFloat(res.pctAbove50.toFixed(4)));
  });
});
