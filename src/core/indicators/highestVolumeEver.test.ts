import { describe, expect, test } from "bun:test";
import { calculateHighestVolumeEver } from "./highestVolumeEver.ts";
import type { Candle } from "./types.ts";

function bar(close: number, volume: number): Candle {
  return { open: close, high: close * 1.01, low: close * 0.99, close, volume };
}

/** Build a candle series with one bar's volume explicitly set to a
 *  spike value, and the rest in a baseline band. */
function seriesWithSpike(
  n: number,
  spikeIdx: number,
  baselineVol = 1_000_000,
  spikeVol = 10_000_000,
): Candle[] {
  const out: Candle[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    out.push(bar(price, i === spikeIdx ? spikeVol : baselineVol));
    price *= 1 + (i % 2 === 0 ? 0.005 : -0.003);
  }
  return out;
}

describe("highestVolumeEver — basic detection", () => {
  test("detects HVE on the spike bar (true HVE / unbounded lookback)", () => {
    const candles = seriesWithSpike(60, 30);
    const r = calculateHighestVolumeEver(candles);
    expect(r.isHve[30]).toBe(true);
    expect(r.latestHveBarIndex).toBe(30);
    expect(r.barsSinceLatestHve).toBe(29);
  });

  test("does not fire before the minBars warm-up", () => {
    // First 10 bars have huge volume, then drop to nothing.
    const candles: Candle[] = [];
    for (let i = 0; i < 30; i++) candles.push(bar(100, i < 10 ? 100_000_000 : 1_000_000));
    const r = calculateHighestVolumeEver(candles, { minBarsBeforeDetection: 20 });
    // Bars 0-9 would trivially be HVE under naive logic, but warm-up
    // suppresses them.
    for (let i = 0; i < 20; i++) expect(r.isHve[i]).toBe(false);
  });

  test("returns null fields when no HVE detected", () => {
    // Every bar tied at the same volume.
    const candles: Candle[] = Array.from({ length: 30 }, () => bar(100, 1_000));
    const r = calculateHighestVolumeEver(candles);
    expect(r.latestHveBarIndex).toBeNull();
    expect(r.barsSinceLatestHve).toBeNull();
    expect(r.volumeMultipleOfMedian).toBeNull();
    expect(r.interpretation).toContain("No HVE");
  });
});

describe("highestVolumeEver — lookback windows", () => {
  test("bounded lookback marks each new in-window high as HVE", () => {
    // Volumes: 100 baseline, then spike to 500 at bar 30, then drop
    // back to 100, then spike to 400 at bar 60 (still highest in the
    // last 20 bars).
    const candles: Candle[] = [];
    for (let i = 0; i < 80; i++) {
      let vol = 100;
      if (i === 30) vol = 500;
      if (i === 60) vol = 400;
      candles.push(bar(100, vol));
    }
    const r = calculateHighestVolumeEver(candles, { lookbackBars: 20 });
    expect(r.isHve[30]).toBe(true);
    // Bar 60: window covers bars 40..59 (all baseline 100), so 400 is
    // the highest in window → fires.
    expect(r.isHve[60]).toBe(true);
    expect(r.hveBarIndices.length).toBeGreaterThanOrEqual(2);
  });

  test("unbounded lookback marks only true historical records", () => {
    const candles: Candle[] = [];
    for (let i = 0; i < 80; i++) {
      let vol = 100;
      if (i === 30) vol = 500;
      if (i === 60) vol = 400; // lower than the prior 500 → not a true HVE
      candles.push(bar(100, vol));
    }
    const r = calculateHighestVolumeEver(candles);
    expect(r.isHve[30]).toBe(true);
    expect(r.isHve[60]).toBe(false); // 400 < 500
    expect(r.latestHveBarIndex).toBe(30);
  });
});

describe("highestVolumeEver — volume multiple of median", () => {
  test("computes the spike's multiple of window median", () => {
    const candles = seriesWithSpike(60, 30, 1_000_000, 10_000_000);
    const r = calculateHighestVolumeEver(candles);
    // Median of prior ~30 bars is ~1M; spike is 10M → ~10×.
    expect(r.volumeMultipleOfMedian).toBeCloseTo(10, 0);
  });

  test("null multiple when prior window has no positive volumes", () => {
    // Warm-up bars have zero volume, then a single bar prints.
    const candles: Candle[] = [];
    for (let i = 0; i < 25; i++) candles.push(bar(100, 0));
    candles.push(bar(100, 1_000_000));
    const r = calculateHighestVolumeEver(candles, { minBarsBeforeDetection: 5 });
    expect(r.volumeMultipleOfMedian).toBeNull();
  });
});

describe("highestVolumeEver — error handling", () => {
  test("throws on invalid lookback", () => {
    expect(() => calculateHighestVolumeEver([bar(100, 1)], { lookbackBars: 0 })).toThrow(
      /lookbackBars/,
    );
    expect(() => calculateHighestVolumeEver([bar(100, 1)], { lookbackBars: -1 })).toThrow(
      /lookbackBars/,
    );
  });

  test("throws on invalid minBars", () => {
    expect(() => calculateHighestVolumeEver([bar(100, 1)], { minBarsBeforeDetection: 0 })).toThrow(
      /minBars/,
    );
    expect(() =>
      calculateHighestVolumeEver([bar(100, 1)], { minBarsBeforeDetection: 1.5 }),
    ).toThrow(/minBars/);
  });

  test("empty input returns empty result", () => {
    const r = calculateHighestVolumeEver([]);
    expect(r.isHve).toEqual([]);
    expect(r.hveBarIndices).toEqual([]);
    expect(r.latestHveBarIndex).toBeNull();
  });
});

describe("highestVolumeEver — series with multiple HVE prints (unbounded)", () => {
  test("each successive record fires; non-records do not", () => {
    const volumes = [
      ...Array(25).fill(100), // warm-up
      200, // bar 25 — new high → HVE
      150, // bar 26 — below 200, not HVE
      300, // bar 27 — new high → HVE
      250, // bar 28 — below 300
      400, // bar 29 — new high → HVE
    ];
    const candles: Candle[] = volumes.map((v) => bar(100, v));
    const r = calculateHighestVolumeEver(candles, { minBarsBeforeDetection: 20 });
    expect(r.isHve[25]).toBe(true);
    expect(r.isHve[26]).toBe(false);
    expect(r.isHve[27]).toBe(true);
    expect(r.isHve[28]).toBe(false);
    expect(r.isHve[29]).toBe(true);
    expect(r.hveBarIndices).toEqual([25, 27, 29]);
    expect(r.latestHveBarIndex).toBe(29);
  });
});
