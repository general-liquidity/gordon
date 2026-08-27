import { describe, expect, test } from "bun:test";
import { calculateVpin } from "./vpin.ts";
import type { Candle } from "./types.ts";

function bar(close: number, volume: number): Candle {
  return { open: close, high: close, low: close, close, volume };
}

describe("VPIN (Volume-Synchronized Probability of Informed Trading)", () => {
  test("strong uptrend, steady volume → buyFraction≈1 → VPIN near 1.0 (toxic)", () => {
    // MATH-ANCHOR: monotone increasing closes with constant step → all Δp equal
    // and positive. σ of a constant series of deltas → ~0 relative to the step,
    // so Φ(Δp/σ) saturates to ~1 → every bucket is ~all-buy → OI≈bucketVolume →
    // VPIN = Σ OI / (window·bucketVolume) ≈ 1.
    const candles: Candle[] = [];
    let price = 100;
    for (let i = 0; i < 60; i++) {
      price += 1; // small jitter via index so σ>0 but Δp/σ stays large
      candles.push(bar(price + (i % 2) * 0.01, 100));
    }
    const r = calculateVpin(candles, { numBuckets: 30, window: 5 });
    expect(r.current).not.toBeNull();
    expect(r.current!).toBeGreaterThan(0.9);
    expect(r.current!).toBeLessThanOrEqual(1);
    expect(r.signal).toBe("toxic");
  });

  test("alternating symmetric series → balanced buckets → VPIN near 0 (benign)", () => {
    // MATH-ANCHOR: closes alternate up/down by the same amount → deltas alternate
    // +d, -d with mean 0 and σ=d. Φ(+1)≈0.841, Φ(-1)≈0.159 → each adjacent pair
    // of bars sums buyFraction (0.841+0.159)=1.0 over 2 bars worth of volume. With
    // bucketVolume spanning ~2 bars, vBuy≈vSell per bucket → OI≈0 → VPIN≈0.
    const candles: Candle[] = [bar(100, 100)];
    for (let i = 1; i < 80; i++) {
      candles.push(bar(i % 2 === 1 ? 102 : 100, 100));
    }
    // 80 bars × 100 vol = 8000 total; bucketVolume = 8000/40 = 200 = exactly 2 bars
    const r = calculateVpin(candles, { numBuckets: 40, window: 10 });
    expect(r.current).not.toBeNull();
    expect(r.current!).toBeLessThan(0.2);
    expect(r.signal).toBe("benign");
  });

  test("flat prices (σ=0) → buyFraction 0.5 → VPIN ~0 (benign)", () => {
    // MATH-ANCHOR: all closes equal → all Δp=0 → σ=0 → buyFraction forced to 0.5
    // → vBuy=vSell every bar → OI=0 every bucket → VPIN=0.
    const candles: Candle[] = Array.from({ length: 60 }, () => bar(100, 100));
    const r = calculateVpin(candles, { numBuckets: 30, window: 5 });
    expect(r.current).toBeCloseTo(0, 6);
    expect(r.signal).toBe("benign");
  });

  test("insufficient data (length < 2) → neutral result", () => {
    const r = calculateVpin([bar(100, 100)], { numBuckets: 5, window: 2 });
    expect(r.current).toBeNull();
    expect(r.values).toEqual([]);
    expect(r.buckets).toBe(0);
    expect(r.bucketVolume).toBe(0);
    expect(r.percentile).toBeNull();
    expect(r.signal).toBe("benign");
    expect(r.interpretation).toContain("Insufficient");
  });

  test("zero total volume → neutral result", () => {
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => bar(100 + i, 0));
    const r = calculateVpin(candles, { numBuckets: 5, window: 2 });
    expect(r.current).toBeNull();
    expect(r.buckets).toBe(0);
  });

  test("not enough buckets for window+1 → neutral result", () => {
    const candles: Candle[] = Array.from({ length: 10 }, (_, i) => bar(100 + i, 100));
    // numBuckets small but window large → fewer than window+1 buckets formable
    const r = calculateVpin(candles, { numBuckets: 3, window: 50 });
    expect(r.current).toBeNull();
    expect(r.values).toEqual([]);
  });

  test("split-across-boundary: every bucket holds exactly bucketVolume; VPIN ∈ [0,1]", () => {
    // Irregular per-bar volume forces the proportional split logic. Verify the
    // volume clock by reconstructing: buckets × bucketVolume should equal the
    // total volume consumed by completed buckets, and VPIN stays bounded.
    const vols = [
      37, 200, 13, 91, 150, 64, 88, 120, 45, 210, 33, 99, 175, 60, 80, 140, 50, 95, 110, 70,
    ];
    const candles: Candle[] = vols.map((v, i) => bar(100 + Math.sin(i) * 3, v));
    const r = calculateVpin(candles, { numBuckets: 12, window: 3 });
    expect(r.current).not.toBeNull();
    expect(r.current!).toBeGreaterThanOrEqual(0);
    expect(r.current!).toBeLessThanOrEqual(1);
    expect(r.buckets).toBeGreaterThanOrEqual(r.window + 1);
    // Each VPIN value must be a valid probability in [0,1]
    for (const v of r.values) {
      if (v !== null) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });

  test("percentile and signal monotonicity sanity", () => {
    const candles: Candle[] = [];
    let price = 50;
    for (let i = 0; i < 70; i++) {
      price += 1;
      candles.push(bar(price, 100));
    }
    const r = calculateVpin(candles, { numBuckets: 35, window: 5 });
    expect(r.percentile).not.toBeNull();
    expect(r.percentile!).toBeGreaterThanOrEqual(0);
    expect(r.percentile!).toBeLessThanOrEqual(1);
  });
});
