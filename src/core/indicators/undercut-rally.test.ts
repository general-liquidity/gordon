import { describe, expect, test } from "bun:test";
import { calculateUndercutRally } from "./undercut-rally.ts";
import type { Candle } from "./types.ts";

function bar(open: number, high: number, low: number, close: number, volume: number, ts: number): Candle {
  return {
    openTime: ts,
    open,
    high,
    low,
    close,
    volume,
    closeTime: ts + 60_000,
  } as Candle;
}

describe("calculateUndercutRally", () => {
  test("returns empty when insufficient data", () => {
    const r = calculateUndercutRally([bar(100, 101, 99, 100, 1000, 0)]);
    expect(r.detected).toBe(false);
  });

  test("detects undercut + reclaim with volume", () => {
    // Need ≥26 candles (srLookback=20 + reclaimWindow=5 + 1).
    const candles: Candle[] = [];
    for (let i = 0; i < 22; i++) {
      candles.push(bar(100, 100.5, 99.8, 100, 1000, i * 60_000));
    }
    candles.push(bar(100, 100.4, 99.9, 100.1, 950, 22 * 60_000));
    candles.push(bar(100, 100.3, 99.85, 100.05, 1000, 23 * 60_000));
    candles.push(bar(100, 100.2, 99.8, 99.9, 980, 24 * 60_000));
    candles.push(bar(99.9, 99.95, 98.5, 99.0, 1100, 25 * 60_000)); // undercut bar
    candles.push(bar(99.1, 100.8, 99.0, 100.6, 2000, 26 * 60_000)); // reclaim bar with vol

    const r = calculateUndercutRally(candles);
    expect(r.detected).toBe(true);
    expect(r.brokenSupport).toBeGreaterThan(99);
    expect(r.undercutLow).toBeLessThan(99);
    expect(r.reclaimClose).toBeGreaterThan(r.brokenSupport!);
    expect(r.volumeConfirmed).toBe(true);
    expect(r.confidence).toBeGreaterThan(40);
  });

  test("returns 'support held' when no undercut occurred", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) {
      candles.push(bar(100, 100.5, 99.8, 100, 1000, i * 60_000));
    }
    const r = calculateUndercutRally(candles);
    expect(r.detected).toBe(false);
    expect(r.interpretation).toContain("Support held");
  });

  test("returns 'no reclaim' when undercut occurred but didn't reverse", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      candles.push(bar(100, 100.5, 99.8, 100, 1000, i * 60_000));
    }
    // Undercut and stay down — true breakdown, not undercut-rally.
    candles.push(bar(100, 100.0, 98.0, 98.2, 1500, 25 * 60_000));
    candles.push(bar(98.2, 98.5, 97.8, 98.0, 1200, 26 * 60_000));
    candles.push(bar(98.0, 98.3, 97.5, 97.8, 1100, 27 * 60_000));
    candles.push(bar(97.8, 98.0, 97.0, 97.5, 1000, 28 * 60_000));

    const r = calculateUndercutRally(candles);
    expect(r.detected).toBe(false);
    expect(r.interpretation).toContain("no reclaim");
  });

  test("flags volumeConfirmed=false when reclaim bar has weak volume", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 22; i++) {
      candles.push(bar(100, 100.5, 99.8, 100, 2000, i * 60_000));
    }
    candles.push(bar(100, 100.4, 99.9, 100.1, 1900, 22 * 60_000));
    candles.push(bar(100, 100.3, 99.85, 100.05, 2000, 23 * 60_000));
    candles.push(bar(100, 100.2, 99.8, 99.9, 1950, 24 * 60_000));
    candles.push(bar(99.9, 99.95, 98.5, 99.0, 2200, 25 * 60_000));
    candles.push(bar(99.1, 100.8, 99.0, 100.6, 800, 26 * 60_000)); // weak volume reclaim

    const r = calculateUndercutRally(candles);
    expect(r.detected).toBe(true);
    expect(r.volumeConfirmed).toBe(false);
    // Confidence should reflect the weak-volume penalty.
    expect(r.confidence).toBeLessThan(75);
  });
});
