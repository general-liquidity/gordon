import { describe, expect, it } from "bun:test";
import { calculateAmihud } from "./amihud-illiquidity.ts";
import type { Candle } from "./types.ts";

function bar(close: number, volume: number): Candle {
  return { open: close, high: close, low: close, close, volume };
}

// Build a series from a fixed sequence of close prices and a constant volume.
function series(closes: number[], volume: number): Candle[] {
  return closes.map((c) => bar(c, volume));
}

describe("calculateAmihud", () => {
  it("low-volume series is more illiquid than high-volume series with same returns", () => {
    const closes = [100, 101, 100, 101, 100, 101];
    const highVol = calculateAmihud(series(closes, 1_000_000));
    const lowVol = calculateAmihud(series(closes, 1_000));

    expect(lowVol.amihud).toBeGreaterThan(highVol.amihud);
    expect(lowVol.amihudScaled).toBeGreaterThan(highVol.amihudScaled);
  });

  it("skips zero-volume bars without producing NaN or Infinity", () => {
    const candles: Candle[] = [
      bar(100, 5000),
      bar(101, 0), // zero volume -> skipped
      bar(100, 5000),
      bar(102, 0), // zero volume -> skipped
      bar(101, 5000),
    ];
    const res = calculateAmihud(candles);

    expect(Number.isFinite(res.amihud)).toBe(true);
    expect(Number.isFinite(res.amihudScaled)).toBe(true);
    expect(Number.isNaN(res.amihud)).toBe(false);
    expect(res.sampleSize).toBeGreaterThan(0);
  });

  it("larger |returns| at the same volume => higher amihud", () => {
    const small = calculateAmihud(series([100, 101, 100, 101], 10_000));
    const large = calculateAmihud(series([100, 110, 100, 110], 10_000));

    expect(large.amihud).toBeGreaterThan(small.amihud);
  });

  it("returns neutral for <2 candles", () => {
    const res = calculateAmihud([bar(100, 1000)]);
    expect(res.sampleSize).toBe(0);
    expect(res.amihud).toBe(0);
    expect(res.amihudScaled).toBe(0);
  });

  it("returns neutral when all bars have zero dollar volume", () => {
    const res = calculateAmihud(series([100, 101, 102], 0));
    expect(res.sampleSize).toBe(0);
    expect(res.amihud).toBe(0);
    expect(res.interpretation).toContain("Insufficient");
  });
});
