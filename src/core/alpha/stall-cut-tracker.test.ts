import { describe, expect, test } from "bun:test";
import {
  analyzeStallCut,
  formatStallCut,
  type StallBar,
} from "./stall-cut-tracker.ts";

function bar(close: number, volume: number, open?: number): StallBar {
  const o = open ?? close;
  return {
    open: o,
    high: Math.max(o, close) + 0.2,
    low: Math.min(o, close) - 0.2,
    close,
    volume,
  };
}

describe("analyzeStallCut", () => {
  test("fewer than grace bars → still_too_early", () => {
    const r = analyzeStallCut({
      side: "LONG",
      entryPrice: 100,
      postEntryBars: [bar(100.5, 1_000_000)],
      expectedMove: 0.05,
      expectedMoveByBars: 10,
    });
    expect(r.verdict).toBe("still_too_early");
  });

  test("LONG moving as expected: progress on track + volume", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 6; i++) bars.push(bar(100 + i * 0.7, 1_500_000));
    const r = analyzeStallCut({
      side: "LONG",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
      baselineVolume: 1_000_000,
    });
    expect(r.verdict).toBe("moving_as_expected");
    expect(r.progressOnTrack).toBe(true);
    expect(r.volumeConfirming).toBe(true);
  });

  test("LONG stalling: 5 bars in, no progress, volume present", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 5; i++) bars.push(bar(100.05, 1_100_000));
    const r = analyzeStallCut({
      side: "LONG",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
      baselineVolume: 1_000_000,
    });
    expect(r.verdict).toBe("stalling_cut_recommended");
  });

  test("LONG dead money: 20 bars in, near-zero progress, no volume", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 20; i++) bars.push(bar(100.02, 400_000));
    const r = analyzeStallCut({
      side: "LONG",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
      baselineVolume: 1_000_000,
    });
    expect(r.verdict).toBe("dead_money");
  });

  test("SHORT side: progress inverted", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 6; i++) bars.push(bar(100 - i * 0.7, 1_500_000));
    const r = analyzeStallCut({
      side: "SHORT",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
      baselineVolume: 1_000_000,
    });
    expect(r.verdict).toBe("moving_as_expected");
    expect(r.progressFraction).toBeGreaterThan(0); // signed in favor of SHORT
  });

  test("SHORT against the position: progress negative", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 5; i++) bars.push(bar(100 + i * 0.5, 1_500_000));
    const r = analyzeStallCut({
      side: "SHORT",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
      baselineVolume: 1_000_000,
    });
    expect(r.progressFraction).toBeLessThan(0);
    expect(r.verdict).toBe("stalling_cut_recommended");
  });

  test("no baseline volume → volume axis is null", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 5; i++) bars.push(bar(100 + i * 0.7, 1_000_000));
    const r = analyzeStallCut({
      side: "LONG",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
    });
    expect(r.volumeMultiple).toBeNull();
    expect(r.volumeConfirming).toBeNull();
  });

  test("custom grace period delays cut decision", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 4; i++) bars.push(bar(100.05, 1_100_000));
    const def = analyzeStallCut({
      side: "LONG",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
      baselineVolume: 1_000_000,
    });
    const patient = analyzeStallCut(
      {
        side: "LONG",
        entryPrice: 100,
        postEntryBars: bars,
        expectedMove: 0.05,
        expectedMoveByBars: 10,
        baselineVolume: 1_000_000,
      },
      { gracePeriodBars: 10 },
    );
    expect(def.verdict).not.toBe("still_too_early");
    expect(patient.verdict).toBe("still_too_early");
  });

  test("progressVsExpected = progressFraction / expectedMove", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 5; i++) bars.push(bar(100 + i * 0.4, 1_200_000));
    const r = analyzeStallCut({
      side: "LONG",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
      baselineVolume: 1_000_000,
    });
    expect(r.progressVsExpected).toBeCloseTo(r.progressFraction / 0.05, 4);
  });
});

describe("formatStallCut", () => {
  test("renders verdict + diagnostic rows", () => {
    const bars: StallBar[] = [];
    for (let i = 1; i <= 6; i++) bars.push(bar(100 + i * 0.7, 1_500_000));
    const r = analyzeStallCut({
      side: "LONG",
      entryPrice: 100,
      postEntryBars: bars,
      expectedMove: 0.05,
      expectedMoveByBars: 10,
      baselineVolume: 1_000_000,
    });
    const text = formatStallCut(r);
    expect(text).toContain("Stall-Cut Tracker");
    expect(text).toContain("Progress");
    expect(text).toContain("Volume");
  });
});
