import { describe, expect, test } from "bun:test";
import { computeOverthrowStop } from "./overthrow-stop.ts";
import type { Candle } from "../indicators/types.ts";

function c(open: number, high: number, low: number, close: number): Candle {
  return { open, high, low, close, volume: 1 };
}

describe("computeOverthrowStop — long reclaim", () => {
  // Two overshoot bars below 100 (lows 98, 97.5; highs < 100), then a reclaim
  // bar closing above 100 with low 99.5.
  const candles: Candle[] = [
    c(101, 101.5, 100.5, 101), // pre-break context (low >= level, ends run)
    c(99, 99.8, 98, 99), // overshoot bar (low 98 < 100)
    c(98.5, 99.9, 97.5, 99.2), // overshoot bar (low 97.5 < 100)
    c(99, 100.6, 99.5, 100.4), // thrust/reclaim bar (close 100.4 > 100, low 99.5)
  ];

  test("computes thrust + furthermost-deviation stops", () => {
    const r = computeOverthrowStop({ candles, brokenLevel: 100, side: "long" });
    expect(r).not.toBeNull();
    expect(r!.thrustCandleStop).toBe(99.5);
    expect(r!.furthermostDeviationStop).toBe(97.5);
    expect(r!.overshootBars).toBe(2);
    expect(r!.recommended).toBe(97.5);
    expect(r!.deviationPct).toBe(2.5); // |97.5 - 100| / 100 * 100
    expect(r!.caution).toBeNull();
  });

  test("caution fires when thrust stop hugs the level", () => {
    const tight: Candle[] = [
      c(99, 99.8, 98, 99),
      c(99, 100.6, 99.95, 100.4), // thrust low 99.95 within 0.1% of 100
    ];
    const r = computeOverthrowStop({
      candles: tight,
      brokenLevel: 100,
      side: "long",
    });
    expect(r).not.toBeNull();
    expect(r!.caution).toBe("stop is essentially at the level");
  });
});

describe("computeOverthrowStop — short reclaim (mirror)", () => {
  // Two overshoot bars above 100 (highs 102, 102.5; lows > 100), then a reclaim
  // bar closing below 100 with high 100.5.
  const candles: Candle[] = [
    c(99, 99.5, 98.5, 99), // pre-break context (high <= level, ends run)
    c(101, 102, 100.2, 101.5), // overshoot bar (high 102 > 100)
    c(101.5, 102.5, 100.5, 101.8), // overshoot bar (high 102.5 > 100)
    c(101, 100.5, 99.4, 99.6), // thrust/reclaim bar (close 99.6 < 100, high 100.5)
  ];

  test("computes thrust + furthermost-deviation stops", () => {
    const r = computeOverthrowStop({
      candles,
      brokenLevel: 100,
      side: "short",
    });
    expect(r).not.toBeNull();
    expect(r!.thrustCandleStop).toBe(100.5);
    expect(r!.furthermostDeviationStop).toBe(102.5);
    expect(r!.overshootBars).toBe(2);
    expect(r!.recommended).toBe(102.5);
    expect(r!.deviationPct).toBe(2.5);
    expect(r!.caution).toBeNull();
  });
});

describe("computeOverthrowStop — null cases", () => {
  test("no overshoot (reclaim with no preceding bars on wrong side)", () => {
    const candles: Candle[] = [
      c(101, 101.5, 100.5, 101), // low >= level
      c(100.5, 101, 100.2, 100.8), // reclaim, but preceding bar not below level
    ];
    expect(
      computeOverthrowStop({ candles, brokenLevel: 100, side: "long" }),
    ).toBeNull();
  });

  test("no thrust candle (never reclaims)", () => {
    const candles: Candle[] = [
      c(99, 99.5, 98, 98.5),
      c(98, 99, 97, 97.5),
    ];
    expect(
      computeOverthrowStop({ candles, brokenLevel: 100, side: "long" }),
    ).toBeNull();
  });

  test("bad level — non-finite", () => {
    const candles: Candle[] = [c(99, 99.8, 98, 99), c(99, 100.6, 99.5, 100.4)];
    expect(
      computeOverthrowStop({ candles, brokenLevel: NaN, side: "long" }),
    ).toBeNull();
  });

  test("bad level — <= 0", () => {
    const candles: Candle[] = [c(99, 99.8, 98, 99), c(99, 100.6, 99.5, 100.4)];
    expect(
      computeOverthrowStop({ candles, brokenLevel: 0, side: "long" }),
    ).toBeNull();
  });

  test("empty / too few candles", () => {
    expect(
      computeOverthrowStop({ candles: [], brokenLevel: 100, side: "long" }),
    ).toBeNull();
    expect(
      computeOverthrowStop({
        candles: [c(99, 100.6, 99.5, 100.4)],
        brokenLevel: 100,
        side: "long",
      }),
    ).toBeNull();
  });

  test("invalid side", () => {
    const candles: Candle[] = [c(99, 99.8, 98, 99), c(99, 100.6, 99.5, 100.4)];
    expect(
      computeOverthrowStop({
        candles,
        brokenLevel: 100,
        // @ts-expect-error invalid side
        side: "neutral",
      }),
    ).toBeNull();
  });
});
