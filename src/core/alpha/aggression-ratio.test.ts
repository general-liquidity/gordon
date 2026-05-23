import { describe, expect, test } from "bun:test";
import {
  computeAggressionRatio,
  formatAggressionRatio,
  type TakerVolumeBar,
} from "./aggression-ratio.ts";

function bar(buy: number, sell: number): TakerVolumeBar {
  return { takerBuyVolume: buy, takerSellVolume: sell };
}

describe("computeAggressionRatio", () => {
  test("insufficient bars → insufficient_data", () => {
    const r = computeAggressionRatio([bar(100, 100), bar(100, 100)]);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("balanced buy/sell volumes → neutral", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(100, 100));
    const r = computeAggressionRatio(bars);
    expect(r.verdict).toBe("neutral");
    expect(r.ratio).toBeCloseTo(1, 3);
    expect(r.logRatio).toBeCloseTo(0, 3);
    expect(r.directionalBias).toBeNull();
  });

  test("steady buyer dominance → strong_buy", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(200, 50));
    const r = computeAggressionRatio(bars);
    expect(r.verdict).toBe("strong_buy");
    expect(r.ratio).toBeCloseTo(4, 1);
    expect(r.directionalBias).toBe("long");
  });

  test("moderate buyer dominance → buy", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(120, 100));
    const r = computeAggressionRatio(bars);
    expect(r.verdict).toBe("buy");
    expect(r.directionalBias).toBe("long");
  });

  test("steady seller dominance → strong_sell", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(50, 200));
    const r = computeAggressionRatio(bars);
    expect(r.verdict).toBe("strong_sell");
    expect(r.ratio).toBeCloseTo(0.25, 1);
    expect(r.directionalBias).toBe("short");
  });

  test("moderate seller dominance → sell", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(100, 120));
    const r = computeAggressionRatio(bars);
    expect(r.verdict).toBe("sell");
    expect(r.directionalBias).toBe("short");
  });

  test("EMA weighs recent bars more than old", () => {
    // First 25 bars neutral, last 5 bars heavy buy
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 25; i++) bars.push(bar(100, 100));
    for (let i = 0; i < 5; i++) bars.push(bar(500, 50));
    const r = computeAggressionRatio(bars, { lookback: 30 });
    // Recent heavy buys should pull the EMA upward
    expect(r.ratio).toBeGreaterThan(1.5);
  });

  test("zero-volume bars don't crash", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(0, 0));
    const r = computeAggressionRatio(bars);
    expect(r).toBeDefined();
    expect(Number.isFinite(r.ratio)).toBe(true);
  });

  test("custom thresholds respected", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(115, 100)); // small bias
    const strict = computeAggressionRatio(bars, { buyThreshold: 0.50 });
    const lax = computeAggressionRatio(bars, { buyThreshold: 0.05 });
    expect(strict.verdict).toBe("neutral");
    expect(["buy", "strong_buy"]).toContain(lax.verdict);
  });

  test("lookback option uses only most-recent N bars", () => {
    // 50 bars: first 40 heavy sell, last 10 balanced
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 40; i++) bars.push(bar(50, 200));
    for (let i = 0; i < 10; i++) bars.push(bar(100, 100));
    const long = computeAggressionRatio(bars, { lookback: 50 });
    const short = computeAggressionRatio(bars, { lookback: 10 });
    // Short lookback sees only the balanced tail
    expect(short.ratio).toBeCloseTo(1, 1);
    // Long lookback weighs the heavy-sell history (but EMA still emphasizes recent)
    expect(long.ratio).toBeLessThan(short.ratio);
  });

  test("ratio symmetry: swapping buy/sell flips sign and inverts ratio", () => {
    const buyBars: TakerVolumeBar[] = [];
    const sellBars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) {
      buyBars.push(bar(200, 100));
      sellBars.push(bar(100, 200));
    }
    const buyR = computeAggressionRatio(buyBars);
    const sellR = computeAggressionRatio(sellBars);
    expect(buyR.logRatio).toBeCloseTo(-sellR.logRatio, 3);
    expect(buyR.ratio).toBeCloseTo(1 / sellR.ratio, 3);
  });

  test("negative input volumes clamped to 0", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(-50, 100));
    const r = computeAggressionRatio(bars);
    // Buy volumes clamped to 0 → ratio very low
    expect(r.directionalBias).toBe("short");
  });
});

describe("formatAggressionRatio", () => {
  test("renders header + EMA + verdict", () => {
    const bars: TakerVolumeBar[] = [];
    for (let i = 0; i < 30; i++) bars.push(bar(200, 50));
    const r = computeAggressionRatio(bars);
    const text = formatAggressionRatio(r);
    expect(text).toContain("Aggression Ratio");
    expect(text).toContain("STRONG_BUY");
    expect(text).toContain("Ratio");
  });
});
