import { describe, expect, test } from "bun:test";
import { calculateRollSpread } from "./roll-spread.ts";
import type { Candle } from "./types.ts";

function mk(close: number, high?: number, low?: number): Candle {
  const h = high ?? close * 1.001;
  const l = low ?? close * 0.999;
  return { open: close, high: h, low: l, close, volume: 1000 };
}

describe("calculateRollSpread — Roll (1984)", () => {
  test("strong bid-ask bounce (alternating Δp, negative serial cov) → rollSpread > 0", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      // alternating closes create negatively autocorrelated price changes
      const close = 100 + (i % 2 === 0 ? -0.5 : 0.5);
      candles.push(mk(close));
    }
    const res = calculateRollSpread(candles);
    expect(res.rollSpread).toBeGreaterThan(0);
    expect(res.rollSpreadPct).toBeGreaterThan(0);
  });

  test("smooth trend (positive serial cov) → rollSpread = 0 (undefined handled)", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      candles.push(mk(100 + i * 0.5));
    }
    const res = calculateRollSpread(candles);
    expect(res.rollSpread).toBe(0);
    expect(res.rollSpreadPct).toBe(0);
  });
});

describe("calculateRollSpread — Corwin-Schultz (2012)", () => {
  test("wide high-low ranges → larger CS spread than tight ranges (monotonic)", () => {
    const wide: Candle[] = [];
    const tight: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const c = 100 + (i % 2 === 0 ? -0.2 : 0.2);
      wide.push(mk(c, c * 1.03, c * 0.97));
      tight.push(mk(c, c * 1.0005, c * 0.9995));
    }
    const wideRes = calculateRollSpread(wide);
    const tightRes = calculateRollSpread(tight);
    expect(wideRes.corwinSchultzSpread).toBeGreaterThan(
      tightRes.corwinSchultzSpread,
    );
  });

  test("CS spread sits in sane fractional range [0, ~0.5]", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 50; i++) {
      const c = 100 + (i % 2 === 0 ? -0.3 : 0.3);
      candles.push(mk(c, c * 1.02, c * 0.98));
    }
    const res = calculateRollSpread(candles);
    expect(res.corwinSchultzSpread).toBeGreaterThanOrEqual(0);
    expect(res.corwinSchultzSpread).toBeLessThanOrEqual(0.5);
  });
});

describe("calculateRollSpread — neutral", () => {
  test("<3 candles → neutral zeros with note", () => {
    const res = calculateRollSpread([mk(100), mk(101)]);
    expect(res.rollSpread).toBe(0);
    expect(res.rollSpreadPct).toBe(0);
    expect(res.corwinSchultzSpread).toBe(0);
    expect(res.window).toBe(0);
    expect(res.interpretation).toContain("Insufficient");
  });
});
