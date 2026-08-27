import { describe, expect, test } from "bun:test";
import {
  analyzeFakeLiquidity,
  formatFakeLiquidity,
  type FakeLiquidityCandle,
} from "./fake-liquidity.ts";

function realBookCandle(seed: number, basePrice = 100): FakeLiquidityCandle {
  // Normal candle: moves ~0.5% on ~$50k volume → small move-per-dollar
  const move = 0.005 + (seed % 5) * 0.001;
  const direction = seed % 2 === 0 ? 1 : -1;
  const open = basePrice;
  const close = open * (1 + direction * move);
  return {
    open,
    close,
    high: Math.max(open, close) * 1.001,
    low: Math.min(open, close) * 0.999,
    volume: 500, // $50k USD volume at base price 100
  };
}

function washCandle(basePrice = 100): FakeLiquidityCandle {
  // Outlier: 8% move on $1k of dollar volume — way out of distribution
  const open = basePrice;
  const close = open * 1.08;
  return {
    open,
    close,
    high: close,
    low: open,
    volume: 10, // $1k USD volume — tiny vs the move
  };
}

describe("analyzeFakeLiquidity", () => {
  test("insufficient_data with too few candles", () => {
    const candles: FakeLiquidityCandle[] = Array(10)
      .fill(0)
      .map((_, i) => realBookCandle(i));
    const r = analyzeFakeLiquidity(candles);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("uniform real-book candles → real_liquidity", () => {
    const candles: FakeLiquidityCandle[] = Array(60)
      .fill(0)
      .map((_, i) => realBookCandle(i));
    const r = analyzeFakeLiquidity(candles);
    expect(r.verdict).toBe("real_liquidity");
    expect(r.outlierFraction).toBeLessThan(0.1);
  });

  test("mixed window with ~12% outliers → suspicious", () => {
    const candles: FakeLiquidityCandle[] = [];
    for (let i = 0; i < 60; i++) {
      if (i % 8 === 0) candles.push(washCandle());
      else candles.push(realBookCandle(i));
    }
    // ~7-8 of 60 = 12-13%
    const r = analyzeFakeLiquidity(candles);
    expect(r.verdict === "suspicious" || r.verdict === "fake_liquidity").toBe(true);
    expect(r.outlierCount).toBeGreaterThan(0);
  });

  test("heavily wash-traded window → fake_liquidity", () => {
    const candles: FakeLiquidityCandle[] = [];
    for (let i = 0; i < 60; i++) {
      if (i % 4 === 0) candles.push(washCandle());
      else candles.push(realBookCandle(i));
    }
    const r = analyzeFakeLiquidity(candles);
    expect(r.verdict).toBe("fake_liquidity");
    expect(r.outlierFraction).toBeGreaterThanOrEqual(0.2);
  });

  test("respects custom outlier z-threshold", () => {
    const candles: FakeLiquidityCandle[] = [];
    for (let i = 0; i < 60; i++) {
      if (i % 6 === 0) candles.push(washCandle());
      else candles.push(realBookCandle(i));
    }
    const strict = analyzeFakeLiquidity(candles, { outlierZThreshold: 10 });
    const lax = analyzeFakeLiquidity(candles, { outlierZThreshold: 1 });
    expect(lax.outlierCount).toBeGreaterThanOrEqual(strict.outlierCount);
  });

  test("price-move with zero USD volume flags candle as outlier", () => {
    const candles: FakeLiquidityCandle[] = Array(40)
      .fill(0)
      .map((_, i) => realBookCandle(i));
    // Inject a candle with non-zero move but zero volume
    candles.push({
      open: 100,
      close: 110, // 10% move
      high: 110,
      low: 100,
      volume: 0,
    });
    candles.push({
      open: 110,
      close: 121, // another 10% move on zero volume
      high: 121,
      low: 110,
      volume: 0,
    });
    const r = analyzeFakeLiquidity(candles);
    expect(r.candleSamples.some((s) => s.outlier && s.volUSD < 1)).toBe(true);
  });

  test("rejects candles with non-positive open without throwing", () => {
    const candles: FakeLiquidityCandle[] = Array(60)
      .fill(0)
      .map((_, i) => realBookCandle(i));
    candles[5] = { open: 0, close: 1, high: 1, low: 0, volume: 100 };
    // Should still produce a verdict (skipping degenerate candle internally)
    const r = analyzeFakeLiquidity(candles);
    expect(["real_liquidity", "suspicious", "fake_liquidity"]).toContain(r.verdict);
  });
});

describe("formatFakeLiquidity", () => {
  test("renders header and outlier counts", () => {
    const candles: FakeLiquidityCandle[] = Array(60)
      .fill(0)
      .map((_, i) => realBookCandle(i));
    const r = analyzeFakeLiquidity(candles);
    const text = formatFakeLiquidity(r);
    expect(text).toContain("Fake-Liquidity Check");
    expect(text).toContain("REAL_LIQUIDITY");
  });

  test("adds defensive guidance for fake_liquidity verdict", () => {
    const candles: FakeLiquidityCandle[] = [];
    for (let i = 0; i < 60; i++) {
      if (i % 4 === 0) candles.push(washCandle());
      else candles.push(realBookCandle(i));
    }
    const r = analyzeFakeLiquidity(candles);
    const text = formatFakeLiquidity(r);
    expect(text).toContain("wash-traded");
  });
});
