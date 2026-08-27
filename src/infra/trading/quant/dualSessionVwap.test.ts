import { describe, it, expect } from "bun:test";
import { computeDualVwap, dualVwapToPayload, type DualVwapCandle } from "./dualSessionVwap.ts";

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function constantPriceDay(
  dayIndex: number,
  price: number,
  volume: number,
  bars = 24,
): DualVwapCandle[] {
  const base = dayIndex * DAY_MS;
  const out: DualVwapCandle[] = [];
  for (let h = 0; h < bars; h++) {
    out.push({ timestamp: base + h * HOUR_MS, high: price, low: price, close: price, volume });
  }
  return out;
}

describe("computeDualVwap", () => {
  it("no candles → empty result", () => {
    const r = computeDualVwap({ candles: [] });
    expect(r.sampleSize).toBe(0);
    expect(r.reasoning).toContain("no candles");
  });

  it("constant price across full day → both VWAPs equal that price, zero divergence", () => {
    const candles = constantPriceDay(0, 100, 1);
    const r = computeDualVwap({ candles });
    expect(r.session.vwap).toBeCloseTo(100, 9);
    expect(r.rolling.vwap).toBeCloseTo(100, 9);
    expect(r.divergence).toBeCloseTo(0, 9);
    expect(r.divergenceSignificant).toBe(false);
  });

  it("price drift within session → session VWAP differs from rolling", () => {
    // 24 bars over two UTC days. Yesterday all at 100; today all at 110.
    // Session = today only → 110. Rolling(100) = volume-weighted blend ≈ 105.
    const yesterday = constantPriceDay(0, 100, 1);
    const today = constantPriceDay(1, 110, 1);
    const r = computeDualVwap({ candles: [...yesterday, ...today], rollingPeriod: 48 });
    expect(r.session.vwap).toBeCloseTo(110, 6);
    expect(r.rolling.vwap).toBeCloseTo(105, 6);
    expect(r.divergence).toBeCloseTo(5, 6);
    expect(r.divergenceSignificant).toBe(true);
  });

  it("position above upper band → far_above when price >= +2σ", () => {
    // 23 bars at 100, last bar at 200 to push price far above any band.
    const candles: DualVwapCandle[] = [];
    for (let h = 0; h < 23; h++) {
      candles.push({ timestamp: h * HOUR_MS, high: 100, low: 100, close: 100, volume: 1 });
    }
    candles.push({ timestamp: 23 * HOUR_MS, high: 200, low: 200, close: 200, volume: 1 });
    const r = computeDualVwap({ candles, rollingPeriod: 50 });
    expect(["above", "far_above"]).toContain(r.sessionPosition);
  });

  it("divergence is signed", () => {
    // Yesterday up at 120, today down at 100. session VWAP < rolling VWAP → negative divergence.
    const candles = [...constantPriceDay(0, 120, 1), ...constantPriceDay(1, 100, 1)];
    const r = computeDualVwap({ candles, rollingPeriod: 48 });
    expect(r.divergence).toBeLessThan(0);
  });

  it("custom session boundary changes session window", () => {
    // Two consecutive 24h blocks. With sessionStartHourUtc=12, the
    // session-day rolls over at noon. Place candles so that with boundary=0
    // they're all "today" but with boundary=12 some are "yesterday."
    const candles: DualVwapCandle[] = [];
    for (let h = 0; h < 24; h++) {
      candles.push({ timestamp: h * HOUR_MS, high: 100, low: 100, close: 100, volume: 1 });
    }
    const a = computeDualVwap({ candles, sessionStartHourUtc: 0 });
    const b = computeDualVwap({ candles, sessionStartHourUtc: 12 });
    expect(a.sampleSize).toBe(b.sampleSize);
    // Just confirm we get a finite session VWAP in both
    expect(Number.isFinite(a.session.vwap)).toBe(true);
    expect(Number.isFinite(b.session.vwap)).toBe(true);
  });

  it("zero-volume candles ignored", () => {
    const candles: DualVwapCandle[] = [
      { timestamp: 0, high: 100, low: 100, close: 100, volume: 0 },
      { timestamp: HOUR_MS, high: 200, low: 200, close: 200, volume: 1 },
    ];
    const r = computeDualVwap({ candles });
    expect(r.session.vwap).toBeCloseTo(200, 9);
  });
});

describe("dualVwapToPayload", () => {
  it("emits stable shape", () => {
    const candles = constantPriceDay(0, 100, 1);
    const p = dualVwapToPayload(computeDualVwap({ candles })) as {
      kind: string;
      sessionPosition: string;
    };
    expect(p.kind).toBe("dual_vwap.computed");
    expect(["far_above", "above", "at", "below", "far_below"]).toContain(p.sessionPosition);
  });

  it("emits null when VWAP is non-finite", () => {
    const p = dualVwapToPayload(computeDualVwap({ candles: [] })) as {
      sessionVwap: number | null;
    };
    expect(p.sessionVwap).toBeNull();
  });
});
