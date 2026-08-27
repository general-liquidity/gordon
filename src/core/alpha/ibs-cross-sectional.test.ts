import { describe, expect, test } from "bun:test";
import {
  rankIbsCrossSectional,
  formatIbsCrossSectional,
  type IbsBar,
} from "./ibs-cross-sectional.ts";

function bar(symbol: string, high: number, low: number, close: number): IbsBar {
  return { symbol, high, low, close };
}

describe("rankIbsCrossSectional", () => {
  test("close at the low yields IBS = 0 (long candidate)", () => {
    const bars = [
      bar("A", 100, 90, 90),
      bar("B", 100, 90, 95),
      bar("C", 100, 90, 99),
      bar("D", 100, 90, 91),
      bar("E", 100, 90, 92),
      bar("F", 100, 90, 99.5),
    ];
    const r = rankIbsCrossSectional(bars);
    expect(r.verdict).toBe("ranked");
    expect(r.longBasket).toContain("A");
    expect(r.shortBasket).toContain("F");
    expect(r.ranked.find((x) => x.symbol === "A")!.ibs).toBeCloseTo(0, 4);
    expect(r.ranked.find((x) => x.symbol === "F")!.ibs).toBeCloseTo(0.95, 4);
  });

  test("close at the high yields IBS = 1 (short candidate)", () => {
    const bars = [
      bar("BULL", 100, 90, 100),
      bar("MID", 100, 90, 95),
      bar("MID2", 100, 90, 94),
      bar("MID3", 100, 90, 96),
      bar("MID4", 100, 90, 95.5),
      bar("BEAR", 100, 90, 90),
    ];
    const r = rankIbsCrossSectional(bars);
    expect(r.ranked.find((x) => x.symbol === "BULL")!.ibs).toBeCloseTo(1.0, 4);
    expect(r.ranked.find((x) => x.symbol === "BEAR")!.ibs).toBeCloseTo(0.0, 4);
    expect(r.shortBasket).toContain("BULL");
    expect(r.longBasket).toContain("BEAR");
  });

  test("degenerate bars (range = 0) are filtered out", () => {
    const bars = [
      bar("FLAT", 100, 100, 100),
      bar("A", 100, 90, 92),
      bar("B", 100, 90, 95),
      bar("C", 100, 90, 99),
      bar("D", 100, 90, 91),
      bar("E", 100, 90, 96),
    ];
    const r = rankIbsCrossSectional(bars);
    expect(r.validSymbols).toBe(5);
    expect(r.ranked.find((x) => x.symbol === "FLAT")).toBeUndefined();
  });

  test("all degenerate → verdict degenerate_bars", () => {
    const bars = [bar("A", 100, 100, 100), bar("B", 50, 50, 50)];
    const r = rankIbsCrossSectional(bars);
    expect(r.verdict).toBe("degenerate_bars");
  });

  test("insufficient symbols → insufficient_data", () => {
    const bars = [bar("A", 100, 90, 92), bar("B", 100, 90, 95)];
    const r = rankIbsCrossSectional(bars);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("close outside [low, high] is rejected", () => {
    const bars = [
      bar("BAD", 100, 90, 105),
      bar("ALSOBAD", 100, 90, 85),
      bar("A", 100, 90, 92),
      bar("B", 100, 90, 95),
      bar("C", 100, 90, 99),
      bar("D", 100, 90, 91),
      bar("E", 100, 90, 96),
    ];
    const r = rankIbsCrossSectional(bars);
    expect(r.ranked.find((x) => x.symbol === "BAD")).toBeUndefined();
    expect(r.ranked.find((x) => x.symbol === "ALSOBAD")).toBeUndefined();
  });

  test("ranking is ascending by IBS", () => {
    const bars: IbsBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push(bar(`S${i}`, 100, 90, 90 + i * 0.5));
    }
    const r = rankIbsCrossSectional(bars);
    expect(r.verdict).toBe("ranked");
    for (let i = 1; i < r.ranked.length; i++) {
      expect(r.ranked[i]!.ibs).toBeGreaterThanOrEqual(r.ranked[i - 1]!.ibs);
    }
  });

  test("ibsSpread = mean(short) - mean(long), positive when sorted", () => {
    const bars: IbsBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push(bar(`S${i}`, 100, 90, 90 + i * 0.5));
    }
    const r = rankIbsCrossSectional(bars);
    expect(r.ibsSpread).toBeGreaterThan(0);
  });

  test("minRangeFraction filters thin bars", () => {
    const bars = [
      bar("THIN", 100.01, 100, 100.005),
      bar("A", 100, 90, 92),
      bar("B", 100, 90, 95),
      bar("C", 100, 90, 99),
      bar("D", 100, 90, 91),
      bar("E", 100, 90, 96),
    ];
    const r = rankIbsCrossSectional(bars, { minRangeFraction: 0.01 });
    expect(r.ranked.find((x) => x.symbol === "THIN")).toBeUndefined();
  });

  test("custom top/bottom fractions adjust basket sizes", () => {
    const bars: IbsBar[] = [];
    for (let i = 0; i < 20; i++) {
      bars.push(bar(`S${i}`, 100, 90, 90 + i * 0.5));
    }
    const r = rankIbsCrossSectional(bars, { topFraction: 0.25, bottomFraction: 0.25 });
    expect(r.longBasket.length).toBe(5);
    expect(r.shortBasket.length).toBe(5);
  });
});

describe("formatIbsCrossSectional", () => {
  test("renders IBS table when ranked", () => {
    const bars: IbsBar[] = [];
    for (let i = 0; i < 10; i++) {
      bars.push(bar(`S${i}`, 100, 90, 90 + i));
    }
    const r = rankIbsCrossSectional(bars);
    const text = formatIbsCrossSectional(r);
    expect(text).toContain("IBS Cross-Sectional");
    expect(text).toContain("Long basket");
    expect(text).toContain("Short basket");
  });
});
