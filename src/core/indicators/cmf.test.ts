import { describe, expect, test } from "bun:test";
import { calculateCMF } from "./cmf.ts";
import type { Candle } from "./types.ts";

function bar(high: number, low: number, close: number, volume: number): Candle {
  return { open: close, high, low, close, volume };
}

describe("Chaikin Money Flow (CMF)", () => {
  test("close at high every bar → MFM=+1 → CMF → +1 (pure accumulation)", () => {
    // MATH-ANCHOR: each bar MFM = ((10-0)-(10-10))/10 = +1, so
    // CMF = Σ(+1·V) / Σ(V) = +1.
    const candles: Candle[] = Array.from({ length: 5 }, () => bar(10, 0, 10, 100));
    const r = calculateCMF(candles, 5);
    expect(r.current).toBeCloseTo(1, 6);
    expect(r.signal).toBe("accumulation");
  });

  test("close at low every bar → MFM=-1 → CMF → -1 (pure distribution)", () => {
    // MATH-ANCHOR: MFM = ((0-0)-(10-0))/10 = -1, so CMF = -1.
    const candles: Candle[] = Array.from({ length: 5 }, () => bar(10, 0, 0, 100));
    const r = calculateCMF(candles, 5);
    expect(r.current).toBeCloseTo(-1, 6);
    expect(r.signal).toBe("distribution");
  });

  test("hand-computed mixed window → CMF = 0.3", () => {
    // MATH-ANCHOR (period=3):
    //   Bar1 H10 L0 C10 V100 → MFM=((10-0)-(10-10))/10=+1   → MFV=+100
    //   Bar2 H10 L0 C0  V100 → MFM=((0-0)-(10-0))/10=-1     → MFV=-100
    //   Bar3 H10 L0 C8  V200 → MFM=((8-0)-(10-8))/10=+0.6   → MFV=+120
    //   ΣMFV = 100 - 100 + 120 = 120 ; ΣV = 400 ; CMF = 120/400 = 0.3
    const candles: Candle[] = [bar(10, 0, 10, 100), bar(10, 0, 0, 100), bar(10, 0, 8, 200)];
    const r = calculateCMF(candles, 3);
    expect(r.current).toBeCloseTo(0.3, 6);
    expect(r.signal).toBe("accumulation");
  });

  test("flat-range bar (high==low) → MFM contributes 0, no NaN", () => {
    // MATH-ANCHOR (period=2): flat bar contributes 0 MFV but adds volume.
    //   Bar1 H10 L0 C10 V100 → MFV=+100
    //   Bar2 H5  L5 C5  V100 → flat range → MFV=0
    //   ΣMFV=100 ; ΣV=200 ; CMF=0.5
    const candles: Candle[] = [bar(10, 0, 10, 100), bar(5, 5, 5, 100)];
    const r = calculateCMF(candles, 2);
    expect(r.current).not.toBeNull();
    expect(Number.isNaN(r.current as number)).toBe(false);
    expect(r.current).toBeCloseTo(0.5, 6);
  });

  test("neutral band: small CMF → neutral signal", () => {
    // Mix of accumulation and distribution that nets near zero.
    const candles: Candle[] = [
      bar(10, 0, 6, 100), // MFM=+0.2 → +20
      bar(10, 0, 4, 100), // MFM=-0.2 → -20
    ];
    const r = calculateCMF(candles, 2);
    expect(r.current).toBeCloseTo(0, 6);
    expect(r.signal).toBe("neutral");
  });

  test("zero-volume window → null", () => {
    const candles: Candle[] = [bar(10, 0, 10, 0), bar(10, 0, 0, 0)];
    const r = calculateCMF(candles, 2);
    expect(r.current).toBeNull();
  });

  test("null warmup before period", () => {
    const candles: Candle[] = Array.from({ length: 4 }, () => bar(10, 0, 10, 100));
    const r = calculateCMF(candles, 3);
    expect(r.values).toHaveLength(4);
    expect(r.values[0]).toBeNull();
    expect(r.values[1]).toBeNull();
    expect(r.values[2]).not.toBeNull(); // first full window at index period-1
    expect(r.values[3]).not.toBeNull();
  });

  test("insufficient data → null current + all-null values", () => {
    const candles: Candle[] = [bar(10, 0, 10, 100), bar(10, 0, 10, 100)];
    const r = calculateCMF(candles, 20);
    expect(r.current).toBeNull();
    expect(r.values).toHaveLength(2);
    expect(r.values.every((v) => v === null)).toBe(true);
    expect(r.interpretation).toContain("Insufficient");
  });

  test("CMF stays bounded in [-1, 1]", () => {
    const candles: Candle[] = [
      bar(10, 0, 9, 50),
      bar(10, 0, 1, 300),
      bar(10, 0, 7, 120),
      bar(10, 0, 2, 80),
    ];
    const r = calculateCMF(candles, 4);
    expect(r.current!).toBeLessThanOrEqual(1);
    expect(r.current!).toBeGreaterThanOrEqual(-1);
  });
});
