import { describe, expect, test } from "bun:test";
import { nadarayaWatsonSmooth, findAlternatingExtrema, detectLmwPatterns } from "./lmw-patterns.ts";

/** Piecewise-linear ramp helper: appends a segment from `from` to `to`. */
function segment(out: number[], from: number, to: number, steps: number): void {
  for (let i = 1; i <= steps; i++) out.push(from + ((to - from) * i) / steps);
}

/**
 * Symmetric head-and-shoulders: shoulders at 100, troughs at 95, head at 110.
 * Peaks ~20 bars apart; symmetric about the head so smoothing preserves the
 * shoulder/trough equality the HS definition requires.
 */
function headAndShoulders(): number[] {
  const p: number[] = [90];
  segment(p, 90, 100, 10); // left shoulder peak @ ~10
  segment(p, 100, 95, 10); // left trough @ ~20
  segment(p, 95, 110, 10); // head @ ~30
  segment(p, 110, 95, 10); // right trough @ ~40
  segment(p, 95, 100, 10); // right shoulder @ ~50
  segment(p, 100, 90, 10); // decline
  return p;
}

describe("nadarayaWatsonSmooth", () => {
  test("preserves length and smooths noise", () => {
    const prices = [10, 12, 9, 13, 8, 14, 7, 15, 6, 16];
    const s = nadarayaWatsonSmooth(prices, 2);
    expect(s.length).toBe(prices.length);
    // Smoothed range is tighter than raw range.
    const rawRange = Math.max(...prices) - Math.min(...prices);
    const smRange = Math.max(...s) - Math.min(...s);
    expect(smRange).toBeLessThan(rawRange);
  });
});

describe("findAlternatingExtrema", () => {
  test("returns strictly alternating max/min on the HS series", () => {
    const smoothed = nadarayaWatsonSmooth(headAndShoulders(), 3);
    const ex = findAlternatingExtrema(smoothed);
    expect(ex.length).toBeGreaterThanOrEqual(5);
    for (let i = 1; i < ex.length; i++) {
      expect(ex[i]!.kind).not.toBe(ex[i - 1]!.kind);
    }
  });
});

describe("detectLmwPatterns", () => {
  test("detects a head-and-shoulders", () => {
    const r = detectLmwPatterns(headAndShoulders(), { bandwidth: 3 });
    const hs = r.matches.filter((m) => m.pattern === "HS");
    expect(hs.length).toBeGreaterThanOrEqual(1);
    // The middle extremum (head) is the highest of the five.
    const head = hs[0]!.extremaIndices[2]!;
    expect(head).toBeGreaterThan(hs[0]!.extremaIndices[0]!);
  });

  test("a monotonic ramp yields no head-and-shoulders", () => {
    const ramp = Array.from({ length: 60 }, (_, i) => 100 + i);
    const r = detectLmwPatterns(ramp, { bandwidth: 3 });
    expect(r.matches.filter((m) => m.pattern === "HS").length).toBe(0);
  });

  test("detects a double bottom (two ~equal troughs ≥ minSep apart)", () => {
    const p: number[] = [105];
    segment(p, 105, 95, 10); // trough 1 @ ~10
    segment(p, 95, 106, 15); // peak @ ~25
    segment(p, 106, 95.3, 25); // trough 2 @ ~50 (≥22 from trough 1)
    segment(p, 95.3, 106, 10);
    const r = detectLmwPatterns(p, { bandwidth: 3, doubleMinSeparation: 22 });
    expect(r.matches.some((m) => m.pattern === "DBOT")).toBe(true);
  });

  test("guards against short series", () => {
    const r = detectLmwPatterns([1, 2, 3], {});
    expect(r.matches).toEqual([]);
    expect(r.interpretation).toContain("Insufficient");
  });
});
