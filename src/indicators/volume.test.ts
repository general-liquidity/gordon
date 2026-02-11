import { describe, test, expect } from "bun:test";
import {
  calculateOBV,
  calculateVolumeMA,
  calculateVolumeRatio,
  calculateVWAP,
} from "./volume.ts";
import type { Candle } from "../types/index.ts";

function candle(close: number, volume: number, high = close + 1, low = close - 1): Candle {
  const openTime = Date.now();
  return {
    openTime,
    open: close,
    high,
    low,
    close,
    volume,
    closeTime: openTime + 60_000,
  };
}

describe("volume indicators", () => {
  test("calculateVolumeMA returns null for insufficient candles", () => {
    const result = calculateVolumeMA([candle(100, 10), candle(101, 20)], 3);
    expect(result).toBeNull();
  });

  test("calculateVolumeMA computes average over lookback period", () => {
    const candles = [candle(100, 10), candle(101, 20), candle(102, 30), candle(103, 40)];
    const result = calculateVolumeMA(candles, 3);
    expect(result).toBe((20 + 30 + 40) / 3);
  });

  test("calculateVolumeRatio handles insufficient data and zero MA", () => {
    expect(calculateVolumeRatio([candle(100, 10)], 2)).toBeNull();
    expect(calculateVolumeRatio([candle(100, 0), candle(101, 0)], 2)).toBeNull();
  });

  test("calculateVolumeRatio uses last candle volume against MA", () => {
    const candles = [candle(100, 10), candle(101, 20), candle(102, 30)];
    const ratio = calculateVolumeRatio(candles, 3);
    expect(ratio).toBe(30 / 20);
  });

  test("calculateOBV returns null with fewer than 2 candles", () => {
    expect(calculateOBV([candle(100, 10)])).toBeNull();
  });

  test("calculateOBV adds on up closes, subtracts on down closes, ignores equal closes", () => {
    const candles = [
      candle(100, 10),
      candle(101, 20), // +20
      candle(101, 30), // +0
      candle(99, 40), // -40
      candle(102, 50), // +50
    ];

    const obv = calculateOBV(candles);
    expect(obv).toBe(30);
  });

  test("calculateVWAP returns null for empty or zero-volume input", () => {
    expect(calculateVWAP([])).toBeNull();
    expect(calculateVWAP([candle(100, 0), candle(101, 0)])).toBeNull();
  });

  test("calculateVWAP computes volume-weighted typical price", () => {
    const c1 = candle(100, 10, 102, 98); // typical=100
    const c2 = candle(110, 30, 112, 108); // typical=110

    const vwap = calculateVWAP([c1, c2]);
    expect(vwap).toBe((100 * 10 + 110 * 30) / 40);
  });
});
