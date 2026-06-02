import { describe, expect, test } from "bun:test";
import { calculateStochastic } from "./stochastic.ts";
import type { Candle } from "./types.ts";

function bar(high: number, low: number, close: number): Candle {
  return { open: close, high, low, close, volume: 1 };
}

describe("Stochastic Oscillator (%K/%D)", () => {
  // With kSmooth=1, dPeriod=1, smoothed %K == raw %K and %D == %K.
  const fast = { kPeriod: 3, kSmooth: 1, dPeriod: 1 };

  test("close at period high → %K = 100", () => {
    // window highs/lows over 3 bars: HH=30, LL=10; last close=30 → 100*(30-10)/(30-10)=100
    const r = calculateStochastic(
      [bar(20, 10, 15), bar(25, 12, 20), bar(30, 18, 30)],
      fast,
    );
    expect(r.current.k).toBeCloseTo(100, 6);
    expect(r.signal).toBe("overbought");
  });

  test("close at period low → %K = 0", () => {
    // HH=30, LL=10; last close=10 → 100*(10-10)/20 = 0
    const r = calculateStochastic(
      [bar(20, 10, 15), bar(25, 12, 20), bar(30, 18, 10)],
      fast,
    );
    expect(r.current.k).toBeCloseTo(0, 6);
    expect(r.signal).toBe("oversold");
  });

  test("close at midpoint → %K = 50", () => {
    // HH=30, LL=10; last close=20 → 100*(20-10)/20 = 50
    const r = calculateStochastic(
      [bar(20, 10, 15), bar(25, 12, 18), bar(30, 18, 20)],
      fast,
    );
    expect(r.current.k).toBeCloseTo(50, 6);
    expect(r.signal).toBe("neutral");
  });

  test("hand-computed smoothed %K (kSmooth=2)", () => {
    // kPeriod=2, kSmooth=2, dPeriod=1
    // Bars (high,low,close):
    //   b0 (10,2,5)
    //   b1 (12,4,12)  window {b0,b1}: HH=12 LL=2 → rawK = 100*(12-2)/(12-2)=100
    //   b2 (14,6,8)   window {b1,b2}: HH=14 LL=4 → rawK = 100*(8-4)/(14-4)=40
    //   b3 (16,8,16)  window {b2,b3}: HH=16 LL=6 → rawK = 100*(16-6)/(16-6)=100
    // smoothed %K (SMA period 2):
    //   at b2: (100+40)/2 = 70
    //   at b3: (40+100)/2 = 70
    const r = calculateStochastic(
      [bar(10, 2, 5), bar(12, 4, 12), bar(14, 6, 8), bar(16, 8, 16)],
      { kPeriod: 2, kSmooth: 2, dPeriod: 1 },
    );
    expect(r.k[2]).toBeCloseTo(70, 6);
    expect(r.k[3]).toBeCloseTo(70, 6);
    expect(r.current.k).toBeCloseTo(70, 6);
    expect(r.current.d).toBeCloseTo(70, 6); // dPeriod=1 → %D == %K
  });

  test("flat-range bar (HH == LL) → null", () => {
    // All bars identical h/l → range 0 over the window → rawK null → k null
    const r = calculateStochastic(
      [bar(10, 10, 10), bar(10, 10, 10), bar(10, 10, 10)],
      fast,
    );
    expect(r.k[r.k.length - 1]).toBeNull();
    expect(r.current.k).toBeNull();
    expect(r.signal).toBe("neutral");
  });

  test("null warmup prefix before kPeriod", () => {
    const r = calculateStochastic(
      [bar(20, 10, 15), bar(25, 12, 20), bar(30, 18, 30)],
      fast,
    );
    expect(r.k[0]).toBeNull();
    expect(r.k[1]).toBeNull();
    expect(r.k[2]).not.toBeNull();
  });

  test("insufficient data → all null, neutral", () => {
    const r = calculateStochastic([bar(10, 5, 7), bar(11, 6, 8)]); // defaults need 14+3+3-2=18
    expect(r.k.every((v) => v === null)).toBe(true);
    expect(r.d.every((v) => v === null)).toBe(true);
    expect(r.current.k).toBeNull();
    expect(r.signal).toBe("neutral");
  });

  test("defaults (14/3/3) produce non-null tail on adequate data", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      const base = 100 + Math.sin(i / 2) * 10;
      candles.push(bar(base + 2, base - 2, base));
    }
    const r = calculateStochastic(candles);
    expect(r.current.k).not.toBeNull();
    expect(r.current.d).not.toBeNull();
    // null prefix length = (kPeriod-1)+(kSmooth-1)+(dPeriod-1) = 13+2+2 = 17 for %D
    expect(r.d[16]).toBeNull();
    expect(r.d[17]).not.toBeNull();
  });
});
