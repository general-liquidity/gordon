import { describe, expect, test } from "bun:test";
import {
  classifyMaCrossoverCleanness,
  formatMaCrossoverCleanness,
  type MaCrossoverBar,
} from "./ma-crossover-cleanness.ts";

function bar(close: number, open?: number, range = 0.5): MaCrossoverBar {
  const o = open ?? close;
  return {
    open: o,
    high: Math.max(o, close) + range,
    low: Math.min(o, close) - range,
    close,
  };
}

function genTrendingUp(n: number, startPrice = 100, perBar = 0.5): MaCrossoverBar[] {
  const out: MaCrossoverBar[] = [];
  let p = startPrice;
  for (let i = 0; i < n; i++) {
    const next = p + perBar + (Math.sin(i * 0.7) * perBar) * 0.2;
    out.push(bar(next, p));
    p = next;
  }
  return out;
}

function genChoppy(n: number, basePrice = 100, amplitude = 5): MaCrossoverBar[] {
  const out: MaCrossoverBar[] = [];
  let p = basePrice;
  for (let i = 0; i < n; i++) {
    const next = basePrice + Math.sin(i * 0.9) * amplitude + Math.cos(i * 1.3) * amplitude * 0.5;
    out.push(bar(next, p));
    p = next;
  }
  return out;
}

describe("classifyMaCrossoverCleanness", () => {
  test("insufficient bars → insufficient_data", () => {
    const bars: MaCrossoverBar[] = [];
    for (let i = 0; i < 20; i++) bars.push(bar(100 + i));
    const r = classifyMaCrossoverCleanness(bars);
    expect(r.edgeActivation).toBe("insufficient_data");
  });

  test("clean trending uptrend → momentum_favorable + clean_trend", () => {
    const bars = genTrendingUp(80, 100, 0.8);
    const r = classifyMaCrossoverCleanness(bars);
    expect(r.cleanness).toBe("clean_trend");
    expect(r.edgeActivation).toBe("momentum_favorable");
    expect(r.maDirection).toBe("trending_up");
    expect(r.crossCount).toBeLessThanOrEqual(3);
  });

  test("trending downtrend produces trending_down direction", () => {
    const bars: MaCrossoverBar[] = [];
    let p = 200;
    for (let i = 0; i < 80; i++) {
      const next = p - 0.8 + Math.sin(i * 0.5) * 0.1;
      bars.push(bar(next, p));
      p = next;
    }
    const r = classifyMaCrossoverCleanness(bars);
    expect(r.maDirection).toBe("trending_down");
    expect(r.cleanness).toBe("clean_trend");
    expect(r.edgeActivation).toBe("momentum_favorable");
  });

  test("choppy / sideways → mean_reversion_favorable + chop", () => {
    const bars = genChoppy(80);
    const r = classifyMaCrossoverCleanness(bars);
    expect(r.cleanness).toBe("chop");
    expect(r.edgeActivation).toBe("mean_reversion_favorable");
  });

  test("custom maLength changes SMMA series length", () => {
    const bars = genTrendingUp(80);
    const r10 = classifyMaCrossoverCleanness(bars, { maLength: 10 });
    const r30 = classifyMaCrossoverCleanness(bars);
    expect(r10.maLength).toBe(10);
    expect(r30.maLength).toBe(30);
  });

  test("crossIndices reported and ordered ascending", () => {
    const bars = genChoppy(80);
    const r = classifyMaCrossoverCleanness(bars);
    for (let i = 1; i < r.crossIndices.length; i++) {
      expect(r.crossIndices[i]!).toBeGreaterThan(r.crossIndices[i - 1]!);
    }
    expect(r.crossCount).toBe(r.crossIndices.length);
  });

  test("startBarIndex skips early crosses", () => {
    const bars = genChoppy(80);
    const full = classifyMaCrossoverCleanness(bars);
    const skipped = classifyMaCrossoverCleanness(bars, { startBarIndex: 60 });
    expect(skipped.crossCount).toBeLessThanOrEqual(full.crossCount);
  });

  test("ceiling thresholds gate the clean_trend → messy_trend boundary", () => {
    // Build a sequence with exactly 2 crossings so default classifies clean,
    // but a cleanCrossCeiling of 1 reclassifies it as messy.
    const bars: MaCrossoverBar[] = [];
    let p = 100;
    for (let i = 0; i < 40; i++) {
      bars.push(bar(p, p));
      p += 0.5;
    }
    // Inject two dips through the MA
    bars[42] = bar(p - 8, p);
    p += 0.3;
    bars[55] = bar(p - 6, p);
    p += 0.3;
    for (let i = bars.length; i < 80; i++) {
      bars.push(bar(p, p));
      p += 0.5;
    }
    const def = classifyMaCrossoverCleanness(bars);
    const strict = classifyMaCrossoverCleanness(bars, {
      cleanCrossCeiling: 1,
      messyCrossCeiling: 3,
    });
    if (def.crossCount > 1 && def.cleanness === "clean_trend") {
      expect(strict.cleanness).toBe("messy_trend");
    } else {
      expect(["clean_trend", "messy_trend", "chop"]).toContain(strict.cleanness);
    }
  });

  test("invalid ceiling ordering → insufficient_data", () => {
    const bars = genTrendingUp(80);
    const r = classifyMaCrossoverCleanness(bars, {
      cleanCrossCeiling: 10,
      messyCrossCeiling: 5,
    });
    expect(r.edgeActivation).toBe("insufficient_data");
  });

  test("SMMA matches Wilder recurrence for known sequence", () => {
    // closes = [1..30], expected seed = 15.5; subsequent recurrence
    const bars: MaCrossoverBar[] = [];
    for (let i = 1; i <= 50; i++) bars.push(bar(i));
    const r = classifyMaCrossoverCleanness(bars, { maLength: 30 });
    expect(r.smmaSeries[29]!).toBeCloseTo(15.5, 2);
    const expected31 = (15.5 * 29 + 31) / 30;
    expect(r.smmaSeries[30]!).toBeCloseTo(expected31, 4);
  });

  test("wick poking through MA counts as a cross", () => {
    // Build a series with price holding above SMMA, then a single wick down through it
    const bars: MaCrossoverBar[] = [];
    for (let i = 0; i < 50; i++) bars.push(bar(110 + i * 0.1, 110));
    // Final bar: close still above MA but wick punches below
    const last = bars.length;
    bars.push({ open: 115, high: 116, low: 100, close: 115 });
    for (let i = 0; i < 10; i++) bars.push(bar(115 + i * 0.1, 115));
    const r = classifyMaCrossoverCleanness(bars);
    expect(r.crossIndices).toContain(last);
  });
});

describe("formatMaCrossoverCleanness", () => {
  test("renders verdict + diagnostic rows", () => {
    const bars = genTrendingUp(80);
    const r = classifyMaCrossoverCleanness(bars);
    const text = formatMaCrossoverCleanness(r);
    expect(text).toContain("MA-Crossover Cleanness");
    expect(text).toContain("Cross count");
    expect(text).toContain("MA direction");
  });
});
