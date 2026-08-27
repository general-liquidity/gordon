import { describe, expect, test } from "bun:test";
import {
  rankCrossSectionalMomentum,
  formatCrossSectionalMomentum,
  type AssetReturnSeries,
} from "./cross-sectional-momentum.ts";

function series(symbol: string, start: number, end: number): AssetReturnSeries {
  return { symbol, prices: [start, end] };
}

describe("rankCrossSectionalMomentum", () => {
  test("insufficient symbols → insufficient_data", () => {
    const r = rankCrossSectionalMomentum([series("A", 100, 110), series("B", 100, 90)]);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("ranks 10 symbols by return descending", () => {
    const assets: AssetReturnSeries[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push(series(`S${i}`, 100, 100 + i)); // ret = 0%, 1%, 2%, ..., 9%
    }
    const r = rankCrossSectionalMomentum(assets);
    expect(r.verdict).toBe("ranked");
    expect(r.ranked[0]!.symbol).toBe("S9"); // highest return first
    expect(r.ranked[r.ranked.length - 1]!.symbol).toBe("S0");
  });

  test("default 20% top/bottom split with 10 symbols → 2 long, 2 short", () => {
    const assets: AssetReturnSeries[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push(series(`S${i}`, 100, 100 + i));
    }
    const r = rankCrossSectionalMomentum(assets);
    expect(r.longBasket.length).toBe(2);
    expect(r.shortBasket.length).toBe(2);
    expect(r.longBasket).toContain("S9");
    expect(r.longBasket).toContain("S8");
    expect(r.shortBasket).toContain("S0");
    expect(r.shortBasket).toContain("S1");
  });

  test("custom fractions respected", () => {
    const assets: AssetReturnSeries[] = [];
    for (let i = 0; i < 20; i++) {
      assets.push(series(`S${i}`, 100, 100 + i));
    }
    const r = rankCrossSectionalMomentum(assets, {
      topFraction: 0.1,
      bottomFraction: 0.1,
    });
    expect(r.longBasket.length).toBe(2); // 10% of 20
    expect(r.shortBasket.length).toBe(2);
  });

  test("long-short spread positive when basket dispersion exists", () => {
    const assets: AssetReturnSeries[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push(series(`S${i}`, 100, 100 + i * 5)); // 0%, 5%, 10%, ..., 45%
    }
    const r = rankCrossSectionalMomentum(assets);
    expect(r.longShortSpread).toBeGreaterThan(0);
    expect(r.meanReturn).toBeGreaterThan(0);
  });

  test("minEndingPrice filter drops low-priced symbols", () => {
    const assets = [
      series("HIGH", 100, 200),
      series("LOW", 0.5, 1.0),
      series("MID", 50, 60),
      series("BIG", 1000, 1500),
      series("OK", 100, 120),
      series("ALSO_OK", 100, 105),
      series("ANOTHER", 100, 110),
    ];
    const r = rankCrossSectionalMomentum(assets, { minEndingPrice: 5 });
    expect(r.ranked.find((x) => x.symbol === "LOW")).toBeUndefined();
    expect(r.validSymbols).toBe(6);
  });

  test("symbolFilter respected", () => {
    const assets: AssetReturnSeries[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push(series(`S${i}`, 100, 100 + i));
    }
    const r = rankCrossSectionalMomentum(assets, {
      symbolFilter: (s) => !s.endsWith("0"), // drop S0
    });
    expect(r.validSymbols).toBe(9);
    expect(r.ranked.find((x) => x.symbol === "S0")).toBeUndefined();
  });

  test("rank percentile is 0..1", () => {
    const assets: AssetReturnSeries[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push(series(`S${i}`, 100, 100 + i));
    }
    const r = rankCrossSectionalMomentum(assets);
    expect(r.ranked[0]!.percentile).toBeGreaterThanOrEqual(0.85);
    expect(r.ranked[r.ranked.length - 1]!.percentile).toBe(0);
  });

  test("invalid series (length < 2) filtered out", () => {
    const assets: AssetReturnSeries[] = [
      { symbol: "ONE_BAR", prices: [100] },
      ...Array.from({ length: 5 }, (_, i) => series(`S${i}`, 100, 100 + i)),
    ];
    const r = rankCrossSectionalMomentum(assets);
    expect(r.totalSymbols).toBe(6);
    expect(r.validSymbols).toBe(5);
  });

  test("zero starting price doesn't crash", () => {
    const assets: AssetReturnSeries[] = [
      { symbol: "BAD", prices: [0, 100] },
      ...Array.from({ length: 6 }, (_, i) => series(`S${i}`, 100, 100 + i)),
    ];
    const r = rankCrossSectionalMomentum(assets);
    // BAD has 0 ending price ≥ minEndingPrice default 0 so it's valid
    // but its return is 0, sorted to the bottom
    expect(r.verdict).toBe("ranked");
  });

  test("uniform returns produces well-defined baskets", () => {
    const assets: AssetReturnSeries[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push(series(`S${i}`, 100, 110)); // all 10% return
    }
    const r = rankCrossSectionalMomentum(assets);
    expect(r.verdict).toBe("ranked");
    expect(r.longShortSpread).toBeCloseTo(0, 5);
  });

  test("multi-bar prices used for return", () => {
    const a: AssetReturnSeries = { symbol: "A", prices: [100, 50, 200] }; // start 100, end 200 → 100%
    const others = Array.from({ length: 5 }, (_, i) => series(`S${i}`, 100, 100 + i));
    const r = rankCrossSectionalMomentum([a, ...others]);
    expect(r.ranked[0]!.symbol).toBe("A");
    expect(r.ranked[0]!.returnFraction).toBeCloseTo(1.0, 5);
  });
});

describe("formatCrossSectionalMomentum", () => {
  test("renders header + basket list", () => {
    const assets: AssetReturnSeries[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push(series(`S${i}`, 100, 100 + i));
    }
    const r = rankCrossSectionalMomentum(assets);
    const text = formatCrossSectionalMomentum(r);
    expect(text).toContain("Cross-Sectional Momentum");
    expect(text).toContain("RANKED");
    expect(text).toContain("Long basket");
  });
});
