import { describe, expect, test } from "bun:test";
import {
  buildInformationBars,
  buildInformationBarsFromOHLCV,
  type Tick,
} from "./information-bars.ts";

const ticks: Tick[] = [
  { price: 10, volume: 60, timestamp: 1 },
  { price: 11, volume: 50, timestamp: 2 }, // cum vol 110 ≥ 100 → bar 1 closes
  { price: 12, volume: 30, timestamp: 3 },
  { price: 9, volume: 80, timestamp: 4 }, // cum vol 110 ≥ 100 → bar 2 closes
  { price: 13, volume: 20, timestamp: 5 }, // partial (20 < 100)
];

describe("volume bars", () => {
  test("threshold 100 → two closed bars with correct OHLC/VWAP + partial", () => {
    const r = buildInformationBars(ticks, "volume", 100);
    expect(r.bars).toHaveLength(2);

    const b1 = r.bars[0]!;
    expect(b1.open).toBe(10);
    expect(b1.high).toBe(11);
    expect(b1.low).toBe(10);
    expect(b1.close).toBe(11);
    expect(b1.volume).toBeCloseTo(110, 6);
    expect(b1.tickCount).toBe(2);
    // VWAP = (10*60 + 11*50)/110 = 1150/110
    expect(b1.vwap).toBeCloseTo(1150 / 110, 5);
    expect(b1.openTime).toBe(1);
    expect(b1.closeTime).toBe(2);

    const b2 = r.bars[1]!;
    expect(b2.open).toBe(12);
    expect(b2.high).toBe(12);
    expect(b2.low).toBe(9);
    expect(b2.close).toBe(9);
    expect(b2.volume).toBeCloseTo(110, 6);

    expect(r.partial).not.toBeNull();
    expect(r.partial!.volume).toBeCloseTo(20, 6);
    expect(r.partial!.close).toBe(13);
  });
});

describe("dollar bars", () => {
  test("threshold on cumulative price*volume", () => {
    // tick1 dollar = 600 ≥ 500 → bar closes immediately on tick 1.
    const r = buildInformationBars(ticks, "dollar", 500);
    expect(r.bars[0]!.dollarValue).toBeCloseTo(600, 6);
    expect(r.bars[0]!.tickCount).toBe(1);
  });
});

describe("tick bars", () => {
  test("threshold 2 → bars of 2 ticks each", () => {
    const r = buildInformationBars(ticks, "tick", 2);
    expect(r.bars).toHaveLength(2);
    expect(r.bars[0]!.tickCount).toBe(2);
    expect(r.bars[1]!.tickCount).toBe(2);
    expect(r.partial!.tickCount).toBe(1); // last tick remains
  });
});

describe("OHLCV fallback", () => {
  test("builds volume bars from candle stream", () => {
    const r = buildInformationBarsFromOHLCV(
      [
        { close: 10, volume: 60, closeTime: 1 },
        { close: 11, volume: 50, closeTime: 2 },
      ],
      "volume",
      100
    );
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]!.close).toBe(11);
    expect(r.bars[0]!.volume).toBeCloseTo(110, 6);
  });
});

describe("edge cases", () => {
  test("empty input → empty bars, null partial", () => {
    const r = buildInformationBars([], "volume", 100);
    expect(r.bars).toHaveLength(0);
    expect(r.partial).toBeNull();
  });

  test("non-positive threshold → empty", () => {
    expect(buildInformationBars(ticks, "volume", 0).bars).toHaveLength(0);
    expect(buildInformationBars(ticks, "volume", -5).bars).toHaveLength(0);
  });
});
