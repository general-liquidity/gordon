import { describe, expect, it } from "bun:test";
import { calculateOvernightIntraday } from "./overnight-intraday.ts";
import type { Candle } from "../../types/index.ts";

// Minimal candle factory (the op only reads open + close).
function mk(open: number, close: number): Candle {
  const hi = Math.max(open, close);
  const lo = Math.min(open, close);
  return { timestamp: 0, open, high: hi, low: lo, close, volume: 1 } as unknown as Candle;
}

// Build a series with a fixed overnight gap and intraday drift per bar.
function series(overnightPct: number, intradayPct: number, n: number): Candle[] {
  const candles: Candle[] = [mk(100, 100)];
  let prevClose = 100;
  for (let i = 1; i < n; i++) {
    const open = prevClose * (1 + overnightPct / 100);
    const close = open * (1 + intradayPct / 100);
    candles.push(mk(open, close));
    prevClose = close;
  }
  return candles;
}

describe("calculateOvernightIntraday", () => {
  it("flags the overnight-premium / buy-high-sell-low signature (overnight +, intraday −)", () => {
    const r = calculateOvernightIntraday(series(1, -0.5, 60)); // gap up each night, drift down each day
    expect(r.cumulativeOvernightReturnPct).toBeGreaterThan(0);
    expect(r.cumulativeIntradayReturnPct).toBeLessThan(0);
    expect(r.divergence).toBe("overnight_premium");
    expect(r.suspiciousSignature).toBe(true); // both legs strong (>10% over 60 bars)
  });

  it("detects the intraday-premium case (overnight −, intraday +)", () => {
    const r = calculateOvernightIntraday(series(-0.5, 1, 60));
    expect(r.cumulativeIntradayReturnPct).toBeGreaterThan(0);
    expect(r.cumulativeOvernightReturnPct).toBeLessThan(0);
    expect(r.divergence).toBe("intraday_premium");
  });

  it("balanced when neither leg dominates", () => {
    const r = calculateOvernightIntraday(series(0.1, 0.1, 40));
    expect(r.divergence).toBe("balanced");
    expect(r.suspiciousSignature).toBe(false);
  });

  it("overnight + intraday legs compose to the total return", () => {
    const r = calculateOvernightIntraday(series(0.5, 0.3, 30));
    // (1+cumOn)(1+cumId) − 1 ≈ cumTotal
    const composed = (1 + r.cumulativeOvernightReturnPct / 100) * (1 + r.cumulativeIntradayReturnPct / 100) - 1;
    expect(composed * 100).toBeCloseTo(r.cumulativeTotalReturnPct, 1);
    expect(r.bars).toBe(29);
  });

  it("insufficient data → neutral", () => {
    expect(calculateOvernightIntraday([mk(100, 100)]).bars).toBe(0);
  });
});
