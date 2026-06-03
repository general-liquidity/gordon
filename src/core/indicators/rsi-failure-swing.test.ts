import { describe, it, expect } from "bun:test";
import { calculateRsiFailureSwing } from "./rsi-failure-swing.ts";

/**
 * Build a close series by applying signed per-bar deltas to a base price.
 * Positive deltas push RSI up, negative deltas push it down — letting us
 * deterministically sculpt the RSI line into a failure-swing shape.
 */
function fromDeltas(start: number, deltas: number[]): number[] {
  const closes = [start];
  for (const d of deltas) {
    closes.push(closes[closes.length - 1]! + d);
  }
  return closes;
}

describe("calculateRsiFailureSwing", () => {
  it("returns a well-formed none result on insufficient data", () => {
    const res = calculateRsiFailureSwing([1, 2, 3, 4, 5]);
    expect(res.signal).toBe("none");
    expect(res.confirmed).toBe(false);
    expect(res.firedOnLastBar).toBe(false);
    expect(res.confirmBar).toBeNull();
    expect(res.points).toBeNull();
    expect(res.currentRsi).toBeNull();
    expect(res.rsiPeriod).toBe(14);
    expect(res.interpretation).toContain("Insufficient data");
  });

  it("returns none (not a throw) on degenerate / NaN input", () => {
    const bad = new Array(40).fill(0).map((_, i) => (i === 10 ? NaN : 100));
    const res = calculateRsiFailureSwing(bad);
    expect(res.signal).toBe("none");
    expect(res.confirmed).toBe(false);
    expect(res.interpretation).toContain("Insufficient data");
  });

  it("flat series produces no failure swing", () => {
    const closes = new Array(60).fill(100);
    const res = calculateRsiFailureSwing(closes);
    expect(res.signal).toBe("none");
    expect(res.confirmed).toBe(false);
    expect(res.points).toBeNull();
  });

  it("detects a TOP (bearish) failure swing on the RSI line", () => {
    // Warmup, then: strong rally (RSI > 70, P1), pullback (trough),
    // weaker rally (lower RSI pivot-high P2), then a sharp drop below the trough.
    const deltas: number[] = [];
    // 16 bars of mild warmup chop to seed RSI near neutral
    for (let i = 0; i < 16; i++) deltas.push(i % 2 === 0 ? 0.5 : -0.4);
    // Strong rally -> RSI pivot-high P1 above 70
    for (let i = 0; i < 8; i++) deltas.push(6);
    // Pullback -> trough
    for (let i = 0; i < 5; i++) deltas.push(-3);
    // Weaker rally -> lower pivot-high P2 (smaller gains, fewer of them)
    for (let i = 0; i < 5; i++) deltas.push(1.4);
    // Sharp drop -> RSI breaks below trough level (confirmation)
    for (let i = 0; i < 8; i++) deltas.push(-5);

    const closes = fromDeltas(100, deltas);
    const res = calculateRsiFailureSwing(closes);

    expect(res.signal).toBe("top_failure_swing");
    expect(res.confirmed).toBe(true);
    expect(res.points).not.toBeNull();
    const p = res.points!;
    // P1 RSI was overbought (>70), trough below P1, P2 below P1.
    expect(p.p1Rsi).toBeGreaterThan(70);
    expect(p.troughRsi).toBeLessThan(p.p1Rsi);
    expect(p.p2Rsi).toBeLessThan(p.p1Rsi);
    // Ordering of pivots.
    expect(p.troughBar).toBeGreaterThan(p.p1Bar);
    expect(p.p2Bar).toBeGreaterThan(p.troughBar);
    // Confirmation after P2.
    expect(res.confirmBar!).toBeGreaterThan(p.p2Bar);
    expect(res.interpretation).toContain("BEARISH");
  });

  it("detects a BOTTOM (bullish) failure swing on the RSI line", () => {
    const deltas: number[] = [];
    for (let i = 0; i < 16; i++) deltas.push(i % 2 === 0 ? 0.5 : -0.4);
    // Strong selloff -> RSI pivot-low P1 below 30
    for (let i = 0; i < 8; i++) deltas.push(-6);
    // Bounce -> trough (a pivot-high in RSI)
    for (let i = 0; i < 5; i++) deltas.push(3);
    // Weaker selloff -> higher pivot-low P2
    for (let i = 0; i < 5; i++) deltas.push(-1.4);
    // Sharp rally -> RSI breaks above the trough level (confirmation)
    for (let i = 0; i < 8; i++) deltas.push(5);

    const closes = fromDeltas(500, deltas);
    const res = calculateRsiFailureSwing(closes);

    expect(res.signal).toBe("bottom_failure_swing");
    expect(res.confirmed).toBe(true);
    expect(res.points).not.toBeNull();
    const p = res.points!;
    expect(p.p1Rsi).toBeLessThan(30);
    expect(p.troughRsi).toBeGreaterThan(p.p1Rsi);
    expect(p.p2Rsi).toBeGreaterThan(p.p1Rsi);
    expect(p.troughBar).toBeGreaterThan(p.p1Bar);
    expect(p.p2Bar).toBeGreaterThan(p.troughBar);
    expect(res.confirmBar!).toBeGreaterThan(p.p2Bar);
    expect(res.interpretation).toContain("BULLISH");
  });

  it("respects custom rsiPeriod and pivotWindow options", () => {
    const closes = new Array(50).fill(0).map((_, i) => 100 + i);
    const res = calculateRsiFailureSwing(closes, { rsiPeriod: 7, pivotWindow: 1 });
    expect(res.rsiPeriod).toBe(7);
    // Pure uptrend -> RSI pinned high, no failure swing.
    expect(res.signal).toBe("none");
    expect(res.currentRsi).not.toBeNull();
  });

  it("rounds RSI outputs to one decimal place", () => {
    const closes = new Array(60).fill(0).map((_, i) => 100 + Math.sin(i / 3) * 10);
    const res = calculateRsiFailureSwing(closes);
    if (res.currentRsi !== null) {
      expect(parseFloat(res.currentRsi.toFixed(1))).toBe(res.currentRsi);
    }
    if (res.points) {
      expect(parseFloat(res.points.p1Rsi.toFixed(1))).toBe(res.points.p1Rsi);
    }
  });
});
