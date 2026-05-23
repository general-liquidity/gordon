import { describe, expect, test } from "bun:test";
import {
  analyzeVolumeTrend,
  formatVolumeTrend,
  type VolumeTrendCandle,
} from "./volume-trend.ts";

function makeCandles(volumes: number[], price = 100): VolumeTrendCandle[] {
  return volumes.map((v) => ({ close: price, volume: v }));
}

describe("analyzeVolumeTrend", () => {
  test("insufficient_data with too few candles", () => {
    const r = analyzeVolumeTrend(makeCandles([100, 200, 300]));
    expect(r.verdict).toBe("insufficient_data");
  });

  test("flat volume produces neutral verdict", () => {
    const r = analyzeVolumeTrend(makeCandles(Array(20).fill(1000)));
    expect(r.verdict).toBe("neutral");
    expect(r.direction).toBe("flat");
  });

  test("strongly increasing volume → strongly_breakout_friendly", () => {
    // Volumes grow ~15%/candle — well above default 10% threshold.
    const vols: number[] = [];
    let v = 100;
    for (let i = 0; i < 20; i++) {
      vols.push(v);
      v *= 1.15;
    }
    const r = analyzeVolumeTrend(makeCandles(vols));
    expect(r.direction).toBe("increasing");
    expect(r.intensity).toBe("intense");
    expect(r.verdict).toBe("strongly_breakout_friendly");
    expect(r.slopePctPerCandle).toBeGreaterThan(0);
  });

  test("moderately increasing volume → moderately_breakout_friendly", () => {
    const vols: number[] = [];
    let v = 1000;
    for (let i = 0; i < 20; i++) {
      vols.push(v);
      v += 70; // ~5% of mean per candle
    }
    const r = analyzeVolumeTrend(makeCandles(vols));
    expect(r.direction).toBe("increasing");
    expect(r.intensity).toBe("moderate");
    expect(r.verdict).toBe("moderately_breakout_friendly");
  });

  test("strongly decreasing volume → strongly_reversal_friendly", () => {
    const vols: number[] = [];
    let v = 10000;
    for (let i = 0; i < 20; i++) {
      vols.push(v);
      v *= 0.80;
    }
    const r = analyzeVolumeTrend(makeCandles(vols));
    expect(r.direction).toBe("decreasing");
    expect(r.intensity).toBe("intense");
    expect(r.verdict).toBe("strongly_reversal_friendly");
    expect(r.slopePctPerCandle).toBeLessThan(0);
  });

  test("weak slope falls into weak band", () => {
    const vols: number[] = [];
    let v = 1000;
    for (let i = 0; i < 20; i++) {
      vols.push(v);
      v += 10; // ~1% of mean per candle — weak
    }
    const r = analyzeVolumeTrend(makeCandles(vols));
    expect(r.direction).toBe("increasing");
    expect(r.intensity).toBe("weak");
    expect(r.verdict).toBe("weakly_breakout_friendly");
  });

  test("zero-volume window collapses to neutral", () => {
    const r = analyzeVolumeTrend(makeCandles(Array(20).fill(0)));
    expect(r.verdict).toBe("neutral");
    expect(r.meanVolUSD).toBe(0);
  });

  test("respects custom thresholds", () => {
    const vols: number[] = [];
    let v = 1000;
    for (let i = 0; i < 20; i++) {
      vols.push(v);
      v += 50;
    }
    // With default thresholds → moderate
    const def = analyzeVolumeTrend(makeCandles(vols));
    expect(def.intensity).toBe("moderate");
    // Stricter thresholds re-classify it as intense
    const strict = analyzeVolumeTrend(makeCandles(vols), {
      intenseThresholdPct: 2,
      moderateThresholdPct: 1,
    });
    expect(strict.intensity).toBe("intense");
  });

  test("uses USD volume (close × contracts)", () => {
    // Same contract volumes, different prices → different USD volume.
    const cheapCandles: VolumeTrendCandle[] = [];
    const expensiveCandles: VolumeTrendCandle[] = [];
    let v = 1000;
    for (let i = 0; i < 20; i++) {
      cheapCandles.push({ close: 1, volume: v });
      expensiveCandles.push({ close: 100, volume: v });
      v *= 1.05;
    }
    const cheap = analyzeVolumeTrend(cheapCandles);
    const exp = analyzeVolumeTrend(expensiveCandles);
    expect(exp.meanVolUSD).toBeGreaterThan(cheap.meanVolUSD * 50);
    // Same shape → same verdict
    expect(cheap.verdict).toBe(exp.verdict);
  });
});

describe("formatVolumeTrend", () => {
  test("renders header and verdict", () => {
    const r = analyzeVolumeTrend(makeCandles(Array(20).fill(1000)));
    const text = formatVolumeTrend(r);
    expect(text).toContain("Volume Trend");
    expect(text).toContain("NEUTRAL");
  });
});
