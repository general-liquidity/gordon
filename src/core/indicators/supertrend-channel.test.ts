import { describe, expect, test } from "bun:test";
import { calculateSupertrendChannel } from "./supertrend-channel.ts";
import type { Candle } from "./types.ts";

function bar(close: number, range = 1): Candle {
  return {
    open: close,
    high: close + range / 2,
    low: close - range / 2,
    close,
    volume: 1,
  };
}

describe("Supertrend Channel", () => {
  test("insufficient data → all nulls + warmup interpretation", () => {
    const candles = [bar(10), bar(11), bar(12)];
    const r = calculateSupertrendChannel(candles, { atrPeriod: 10 });
    expect(r.current.maxChannel).toBeNull();
    expect(r.current.minChannel).toBeNull();
    expect(r.current.supertrendAvg).toBeNull();
    expect(r.maxChannel.every((v) => v === null)).toBe(true);
    expect(r.interpretation).toContain("Insufficient");
  });

  test("warmup nulls before ATR is available, then channel populates", () => {
    // 40-bar clean uptrend
    const candles: Candle[] = [];
    for (let i = 0; i < 40; i++) candles.push(bar(100 + i, 1));
    const r = calculateSupertrendChannel(candles, { atrPeriod: 10, multiplier: 3 });
    // Early bars (within ATR warmup) must be null.
    expect(r.maxChannel[0]).toBeNull();
    expect(r.minChannel[0]).toBeNull();
    expect(r.direction[0]).toBe(0);
    // Last bar must be populated.
    expect(r.current.maxChannel).not.toBeNull();
    expect(r.current.minChannel).not.toBeNull();
  });

  test("clean uptrend: channel brackets price, midline sits between bands", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) candles.push(bar(100 + i * 2, 1));
    const r = calculateSupertrendChannel(candles, { atrPeriod: 10, multiplier: 3 });

    const n = candles.length;
    const close = candles[n - 1]!.close;
    const max = r.current.maxChannel!;
    const min = r.current.minChannel!;
    const avg = r.current.supertrendAvg!;

    expect(r.current.direction).toBe(1);
    // channel brackets price
    expect(min).toBeLessThanOrEqual(close);
    expect(max).toBeGreaterThanOrEqual(close);
    // midline strictly between bands
    expect(avg).toBeGreaterThanOrEqual(min);
    expect(avg).toBeLessThanOrEqual(max);
    expect(avg).toBeCloseTo((max + min) / 2, 6);

    // Structural: every non-null bar has min <= max and midline between.
    for (let i = 0; i < n; i++) {
      const mx = r.maxChannel[i];
      const mn = r.minChannel[i];
      const av = r.supertrendAvg[i];
      if (mx == null || mn == null || av == null) continue;
      expect(mn).toBeLessThanOrEqual(mx);
      expect(av).toBeGreaterThanOrEqual(mn);
      expect(av).toBeLessThanOrEqual(mx);
    }
  });

  test("direction flip resets/clamps the channel to a tighter band", () => {
    // up leg then sharp down leg to force a flip
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) candles.push(bar(100 + i * 2, 1));
    for (let i = 0; i < 30; i++) candles.push(bar(160 - i * 3, 1));
    const r = calculateSupertrendChannel(candles, { atrPeriod: 10, multiplier: 3 });

    // A flip must occur somewhere after the warmup.
    let flipIdx = -1;
    for (let i = 1; i < r.direction.length; i++) {
      const d = r.direction[i]!;
      const p = r.direction[i - 1]!;
      if (d !== 0 && p !== 0 && d !== p) {
        flipIdx = i;
        break;
      }
    }
    expect(flipIdx).toBeGreaterThan(0);

    // On the flip bar the channel is re-seeded from the supertrend pivot + this
    // bar's extremes (a reset), so the band still brackets the flip-bar close
    // and is exactly the seed — not an accumulation off the prior leg.
    const flipClose = candles[flipIdx]!.close;
    expect(r.minChannel[flipIdx]!).toBeLessThanOrEqual(flipClose + 1e-6);
    expect(r.maxChannel[flipIdx]!).toBeGreaterThanOrEqual(flipClose - 1e-6);

    // The accumulated band immediately AFTER the flip must be monotonically
    // non-shrinking within the new leg (running min/max only widen).
    if (flipIdx + 1 < r.direction.length && r.direction[flipIdx + 1] === r.direction[flipIdx]) {
      expect(r.maxChannel[flipIdx + 1]!).toBeGreaterThanOrEqual(r.maxChannel[flipIdx]! - 1e-6);
      expect(r.minChannel[flipIdx + 1]!).toBeLessThanOrEqual(r.minChannel[flipIdx]! + 1e-6);
    }
  });

  test("hand-checked clamp: flip-bar band = pivot/extreme seed", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) candles.push(bar(100 + i * 2, 1));
    for (let i = 0; i < 30; i++) candles.push(bar(160 - i * 3, 1));
    const r = calculateSupertrendChannel(candles, { atrPeriod: 10, multiplier: 3 });

    let flipIdx = -1;
    for (let i = 1; i < r.direction.length; i++) {
      const d = r.direction[i]!;
      const p = r.direction[i - 1]!;
      if (d !== 0 && p !== 0 && d !== p) {
        flipIdx = i;
        break;
      }
    }
    // At the flip bar, max = max(supertrend, high), min = min(supertrend, low).
    const high = candles[flipIdx]!.high;
    const low = candles[flipIdx]!.low;
    const st = r.supertrend[flipIdx]!;
    expect(r.maxChannel[flipIdx]!).toBeCloseTo(Math.max(st, high), 4);
    expect(r.minChannel[flipIdx]!).toBeCloseTo(Math.min(st, low), 4);
  });
});
