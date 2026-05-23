import { describe, expect, test } from "bun:test";
import {
  detectHighestVolume,
  formatHighestVolume,
  type HveCandle,
} from "./highest-volume-ever.ts";

function makeCandle(
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): HveCandle {
  return { open, high, low, close, volume };
}

function makeSeries(volumes: number[], closing: "top" | "bottom" | "middle" = "top"): HveCandle[] {
  return volumes.map((v, i) => {
    const open = 100;
    const close = closing === "top" ? 105 : closing === "bottom" ? 96 : 100;
    return makeCandle(open, 106, 95, close, v);
  });
}

describe("detectHighestVolume", () => {
  test("insufficient_data with < 2 bars", () => {
    const r = detectHighestVolume(makeSeries([1000]));
    expect(r.verdict).toBe("insufficient_data");
  });

  test("highest volume across the whole series → hve", () => {
    const bars = makeSeries([1000, 1100, 900, 1200, 5000]);
    const r = detectHighestVolume(bars, { minGapFraction: 0 });
    expect(r.isHve).toBe(true);
    expect(r.verdict).toBe("hve");
    expect(r.ranks.overall).toBe(1);
  });

  test("latest volume not highest → not_hv", () => {
    const bars = makeSeries([5000, 4000, 3000, 2000, 1000]);
    const r = detectHighestVolume(bars, { minGapFraction: 0 });
    expect(r.verdict).toBe("not_hv");
    expect(r.conviction).toBe("fail");
  });

  test("HV1 when latest exceeds 252-window only", () => {
    // 300 bars long. Inject the all-time high near the start (outside HV1
    // window) and the second-highest at the end.
    const vols: number[] = [];
    vols.push(100000); // overall high
    for (let i = 1; i < 299; i++) vols.push(1000 + (i % 10));
    vols.push(50000); // latest — highest in last 252
    const bars = makeSeries(vols);
    const r = detectHighestVolume(bars, { minGapFraction: 0 });
    expect(r.isHve).toBe(false);
    expect(r.isHv1).toBe(true);
    expect(r.verdict).toBe("hv1");
  });

  test("hv_short when latest is highest only in short window", () => {
    // Make sure the latest's volume is exceeded in HV1 window but
    // beats everything in the short (60-bar) window.
    const vols: number[] = [];
    for (let i = 0; i < 100; i++) vols.push(10000); // older
    for (let i = 0; i < 59; i++) vols.push(1000); // last 60: 59 small bars
    vols.push(5000); // latest
    const bars = makeSeries(vols);
    const r = detectHighestVolume(bars, { minGapFraction: 0 });
    expect(r.isHve).toBe(false);
    expect(r.isHv1).toBe(false);
    expect(r.isHvShort).toBe(true);
    expect(r.verdict).toBe("hv_short");
  });

  test("gap-up flag triggers when open > prior close + threshold", () => {
    const bars: HveCandle[] = [
      makeCandle(100, 102, 99, 100, 1000),
      makeCandle(105, 110, 104, 109, 5000), // gap up 5%
    ];
    const r = detectHighestVolume(bars);
    expect(r.isGapUp).toBe(true);
  });

  test("no gap-up when open ≈ prior close", () => {
    const bars: HveCandle[] = [
      makeCandle(100, 102, 99, 100, 1000),
      makeCandle(100.5, 110, 99, 109, 5000),
    ];
    const r = detectHighestVolume(bars);
    expect(r.isGapUp).toBe(false);
  });

  test("closing range pass: close in top quarter", () => {
    const bars: HveCandle[] = [
      makeCandle(100, 102, 99, 100, 1000),
      makeCandle(100, 110, 100, 109, 5000), // close near high
    ];
    const r = detectHighestVolume(bars);
    expect(r.closingRange).toBeGreaterThan(0.85);
    expect(r.closingRangePassed).toBe(true);
  });

  test("closing range fail: close near low", () => {
    const bars: HveCandle[] = [
      makeCandle(100, 102, 99, 100, 1000),
      makeCandle(100, 110, 100, 101, 5000), // close near low
    ];
    const r = detectHighestVolume(bars);
    expect(r.closingRangePassed).toBe(false);
  });

  test("float gate passed when below max", () => {
    const bars = makeSeries([1000, 5000]);
    const r = detectHighestVolume(bars, { floatShares: 50_000_000, minGapFraction: 0 });
    expect(r.floatGate).toBe("passed");
  });

  test("float gate failed when above max", () => {
    const bars = makeSeries([1000, 5000]);
    const r = detectHighestVolume(bars, { floatShares: 500_000_000, minGapFraction: 0 });
    expect(r.floatGate).toBe("failed");
  });

  test("hve + gap-up + good closing range + small float → high conviction", () => {
    const bars: HveCandle[] = [
      makeCandle(100, 102, 99, 100, 1000),
      makeCandle(110, 120, 109, 119, 50000), // gap up, close near high, top vol
    ];
    const r = detectHighestVolume(bars, { floatShares: 50_000_000 });
    expect(r.verdict).toBe("hve");
    expect(r.isGapUp).toBe(true);
    expect(r.closingRangePassed).toBe(true);
    expect(r.conviction).toBe("high");
  });

  test("hve but no gap-up + bad close → low conviction", () => {
    const bars: HveCandle[] = [
      makeCandle(100, 102, 99, 100, 1000),
      makeCandle(100, 110, 99, 100, 50000), // top vol but no gap + close low
    ];
    const r = detectHighestVolume(bars);
    expect(r.verdict).toBe("hve");
    expect(r.conviction).not.toBe("high");
  });

  test("custom hv1 window respected", () => {
    const vols: number[] = [];
    for (let i = 0; i < 100; i++) vols.push(1000);
    vols.push(50000); // latest big
    const bars = makeSeries(vols);
    // Window of 5 — latest beats only the last 5
    const r = detectHighestVolume(bars, { hv1WindowBars: 5, minGapFraction: 0 });
    expect(r.isHv1).toBe(true);
  });
});

describe("formatHighestVolume", () => {
  test("renders header and emits banner on high-conviction HVE", () => {
    const bars: HveCandle[] = [
      makeCandle(100, 102, 99, 100, 1000),
      makeCandle(110, 120, 109, 119, 50000),
    ];
    const r = detectHighestVolume(bars, { floatShares: 50_000_000 });
    const text = formatHighestVolume(r);
    expect(text).toContain("HVE Detector");
    if (r.verdict === "hve" && r.conviction === "high") {
      expect(text).toContain("institutional money just arrived");
    }
  });
});
