import { describe, expect, test } from "bun:test";
import { calculateStandardErrorBands } from "./standardErrorBands.ts";

function perfectUptrend(n: number, slope = 1, intercept = 100): number[] {
  return Array.from({ length: n }, (_, i) => slope * i + intercept);
}

function noisyUptrend(n: number, slope = 1, intercept = 100, seed = 42): number[] {
  let s = seed >>> 0;
  const rng = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff - 0.5;
  };
  return Array.from({ length: n }, (_, i) => slope * i + intercept + rng() * 4);
}

describe("standardErrorBands — clean trend", () => {
  test("perfect uptrend → upper = lower = centerline (zero residuals)", () => {
    const closes = perfectUptrend(30);
    const r = calculateStandardErrorBands(closes, { period: 21, multiplier: 2 });
    // Standard error on a perfect line is 0 — bands collapse to centerline.
    for (let i = 20; i < 30; i++) {
      expect(r.upperBand[i]!).toBeCloseTo(r.centerline[i]!, 5);
      expect(r.lowerBand[i]!).toBeCloseTo(r.centerline[i]!, 5);
    }
  });

  test("verdict is 'trending_up' on a clean uptrend", () => {
    const closes = perfectUptrend(30, 2);
    const r = calculateStandardErrorBands(closes, { period: 21 });
    expect(r.latestVerdict).toBe("trending_up");
    expect(r.latestSlope).toBeCloseTo(2, 4);
  });

  test("verdict is 'trending_down' on a clean downtrend", () => {
    const closes = perfectUptrend(30, -1.5);
    const r = calculateStandardErrorBands(closes, { period: 21 });
    expect(r.latestVerdict).toBe("trending_down");
    expect(r.latestSlope).toBeLessThan(0);
  });

  test("verdict is 'flat' on a flat series", () => {
    const closes = new Array(30).fill(100);
    const r = calculateStandardErrorBands(closes, { period: 21, slopeThreshold: 0.001 });
    expect(r.latestVerdict).toBe("flat");
  });
});

describe("standardErrorBands — noisy trend", () => {
  test("noisy series widens bands", () => {
    const clean = perfectUptrend(30);
    const noisy = noisyUptrend(30, 1, 100, 7);
    const c = calculateStandardErrorBands(clean, { period: 21 });
    const n = calculateStandardErrorBands(noisy, { period: 21 });
    const cWidth = c.latestUpperBand! - c.latestLowerBand!;
    const nWidth = n.latestUpperBand! - n.latestLowerBand!;
    expect(nWidth).toBeGreaterThan(cWidth);
  });

  test("low-R² window classified as 'noisy'", () => {
    // Pure random walk — should fit a regression line very poorly.
    let s = 5;
    const rng = () => {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 0xffffffff - 0.5;
    };
    const closes: number[] = [100];
    for (let i = 1; i < 30; i++) closes.push(closes[i - 1]! + rng() * 5);
    const r = calculateStandardErrorBands(closes, { period: 21, rSquaredThreshold: 0.8 });
    expect(r.latestVerdict).toBe("noisy");
  });
});

describe("standardErrorBands — edge cases", () => {
  test("insufficient data returns null latestVerdict + null latestCenterline", () => {
    const closes = [1, 2, 3, 4, 5];
    const r = calculateStandardErrorBands(closes, { period: 21 });
    expect(r.latestVerdict).toBeNull();
    expect(r.latestCenterline).toBeNull();
    expect(r.interpretation).toContain("Insufficient");
  });

  test("multiplier=0 collapses upper and lower to centerline", () => {
    const closes = noisyUptrend(30);
    const r = calculateStandardErrorBands(closes, { period: 21, multiplier: 0 });
    for (let i = 20; i < 30; i++) {
      expect(r.upperBand[i]).toBe(r.centerline[i]);
      expect(r.lowerBand[i]).toBe(r.centerline[i]);
    }
  });

  test("throws on invalid period", () => {
    expect(() => calculateStandardErrorBands([1, 2, 3], { period: 1 })).toThrow(/period/);
    expect(() => calculateStandardErrorBands([1, 2, 3], { period: 2.5 })).toThrow(/period/);
  });

  test("throws on negative multiplier", () => {
    expect(() => calculateStandardErrorBands([1, 2, 3], { multiplier: -1 })).toThrow(/multiplier/);
  });
});

describe("standardErrorBands — output shape", () => {
  test("array lengths match input", () => {
    const closes = noisyUptrend(50);
    const r = calculateStandardErrorBands(closes, { period: 21 });
    expect(r.centerline).toHaveLength(50);
    expect(r.upperBand).toHaveLength(50);
    expect(r.lowerBand).toHaveLength(50);
    expect(r.slopes).toHaveLength(50);
  });

  test("upper >= centerline >= lower at every defined bar", () => {
    const closes = noisyUptrend(50);
    const r = calculateStandardErrorBands(closes, { period: 21 });
    for (let i = 0; i < 50; i++) {
      if (r.upperBand[i] == null) continue;
      expect(r.upperBand[i]!).toBeGreaterThanOrEqual(r.centerline[i]!);
      expect(r.centerline[i]!).toBeGreaterThanOrEqual(r.lowerBand[i]!);
    }
  });

  test("returns the configured period + multiplier", () => {
    const closes = noisyUptrend(30);
    const r = calculateStandardErrorBands(closes, { period: 14, multiplier: 1.5 });
    expect(r.period).toBe(14);
    expect(r.multiplier).toBe(1.5);
  });
});
