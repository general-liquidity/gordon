import { describe, expect, test } from "bun:test";
import {
  analyzeInstitutionalFootprint,
  formatInstitutionalFootprint,
  type InstitutionalFootprintBar,
} from "./institutional-footprint.ts";

function bar(
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
): InstitutionalFootprintBar {
  return { open, high, low, close, volume };
}

function buildIdealFootprint(): InstitutionalFootprintBar[] {
  // 20 baseline bars (low volume, sideways near 100)
  const bars: InstitutionalFootprintBar[] = [];
  for (let i = 0; i < 20; i++) {
    const p = 100 + (i % 2 === 0 ? 0.2 : -0.2);
    bars.push(bar(p - 0.1, p + 0.3, p - 0.3, p, 1_000_000));
  }
  // 7-bar run: ~30% move, all elevated volume, one ~12% body
  // Run bars: 100 → 130
  // Bar 1: 100 → 105 (5% body), vol 2.5M
  bars.push(bar(100, 106, 99.5, 105, 2_500_000));
  // Bar 2: 105 → 110 (~5% body), vol 2.6M
  bars.push(bar(105, 111, 104.5, 110, 2_600_000));
  // Bar 3: 110 → 116 (~5% body), vol 2.7M
  bars.push(bar(110, 117, 109.5, 116, 2_700_000));
  // Bar 4: 116 → 130 (~12% body — SIGNAL CANDLE), vol 4.5M
  bars.push(bar(116, 131, 115.5, 130, 4_500_000));
  // Bar 5: 130 → 132 (small follow), vol 2.4M
  bars.push(bar(130, 133, 129.5, 132, 2_400_000));
  // Bar 6: 132 → 130 (small pullback), vol 2.3M
  bars.push(bar(132, 132.5, 129, 130, 2_300_000));
  // Bar 7: 130 → 131 (consolidation but still elevated), vol 2.2M (peak high here = 131)
  // Actually let's bake the peak earlier and have base 8 bars at 125-128
  // Base: 8 bars between 124.5 (low) and 129.5 (high), holding 21-SMA, tight
  for (let i = 0; i < 8; i++) {
    const p = 127 + Math.sin(i) * 0.8;
    bars.push(bar(p - 0.2, p + 1.0, p - 1.0, p, 1_200_000));
  }
  return bars;
}

describe("analyzeInstitutionalFootprint", () => {
  test("insufficient bars → insufficient_data", () => {
    const bars: InstitutionalFootprintBar[] = [];
    for (let i = 0; i < 10; i++) bars.push(bar(100, 101, 99, 100, 1_000_000));
    const r = analyzeInstitutionalFootprint(bars);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("ideal footprint → accumulation_visible with all 5 axes", () => {
    const bars = buildIdealFootprint();
    const r = analyzeInstitutionalFootprint(bars);
    expect(r.verdict).toBe("accumulation_visible");
    expect(r.axesPassed).toBe(5);
    expect(r.runMoveFraction).toBeGreaterThanOrEqual(0.2);
    expect(r.runMoveFraction).toBeLessThanOrEqual(0.4);
    expect(r.longestConsecutiveVolumeBars).toBeGreaterThanOrEqual(4);
    expect(r.maxSignalBarBody).toBeGreaterThanOrEqual(0.1);
  });

  test("parabolic blowoff: 60% move + heavy volume but exceeds band", () => {
    const bars: InstitutionalFootprintBar[] = [];
    for (let i = 0; i < 22; i++) bars.push(bar(100, 100.3, 99.7, 100, 1_000_000));
    // Run 100 → 162 (62% move)
    bars.push(bar(100, 112, 99.5, 110, 3_000_000));
    bars.push(bar(110, 125, 109, 122, 3_500_000));
    bars.push(bar(122, 142, 121, 138, 4_500_000));
    bars.push(bar(138, 165, 137, 162, 6_000_000));
    // Base
    for (let i = 0; i < 6; i++) {
      bars.push(bar(159 + i * 0.1, 162, 156, 158, 2_000_000));
    }
    const r = analyzeInstitutionalFootprint(bars);
    expect(r.verdict).toBe("parabolic_blowoff");
  });

  test("chop with no accumulation: random walk", () => {
    const bars: InstitutionalFootprintBar[] = [];
    let p = 100;
    for (let i = 0; i < 50; i++) {
      const drift = Math.sin(i * 0.7) * 0.5;
      const o = p;
      p = p + drift;
      bars.push(
        bar(o, Math.max(o, p) + 0.3, Math.min(o, p) - 0.3, p, 1_000_000 + (i % 3) * 50_000),
      );
    }
    const r = analyzeInstitutionalFootprint(bars);
    expect(["chop_no_accumulation", "partial_signature"]).toContain(r.verdict);
    expect(r.axesPassed).toBeLessThan(5);
  });

  test("partial signature: run + volume + signal bar but wide base", () => {
    const bars: InstitutionalFootprintBar[] = [];
    for (let i = 0; i < 22; i++) bars.push(bar(100, 100.3, 99.7, 100, 1_000_000));
    bars.push(bar(100, 107, 99.5, 105, 2_500_000));
    bars.push(bar(105, 113, 104.5, 110, 2_700_000));
    bars.push(bar(110, 118, 109.5, 115, 2_800_000));
    bars.push(bar(115, 130, 114.5, 128, 4_500_000)); // signal candle ~11%
    bars.push(bar(128, 131, 127, 128, 2_200_000)); // peak high here
    // Wide messy base — large drawdowns ruin tightness
    bars.push(bar(128, 129, 110, 112, 1_800_000));
    bars.push(bar(112, 122, 110, 120, 1_500_000));
    bars.push(bar(120, 125, 108, 110, 1_700_000));
    bars.push(bar(110, 118, 108, 115, 1_400_000));
    bars.push(bar(115, 119, 107, 109, 1_300_000));
    const r = analyzeInstitutionalFootprint(bars);
    expect(r.verdict).toBe("partial_signature");
    expect(r.axes.find((a) => a.axis === "base_tightness")!.passed).toBe(false);
  });

  test("close below 21-SMA fails holds_ma even when other axes pass", () => {
    const bars: InstitutionalFootprintBar[] = [];
    for (let i = 0; i < 22; i++) bars.push(bar(100, 100.3, 99.7, 100, 1_000_000));
    bars.push(bar(100, 107, 99.5, 105, 2_500_000));
    bars.push(bar(105, 113, 104.5, 110, 2_700_000));
    bars.push(bar(110, 118, 109.5, 115, 2_800_000));
    bars.push(bar(115, 132, 114.5, 130, 4_500_000)); // peak high here
    // Sharp pullback that breaks the MA
    bars.push(bar(130, 131, 90, 92, 3_000_000));
    bars.push(bar(92, 95, 88, 90, 1_400_000));
    bars.push(bar(90, 93, 87, 89, 1_300_000));
    bars.push(bar(89, 91, 86, 87, 1_200_000));
    bars.push(bar(87, 90, 85, 86, 1_100_000));
    const r = analyzeInstitutionalFootprint(bars);
    expect(r.verdict).not.toBe("insufficient_data");
    expect(r.axes.find((a) => a.axis === "holds_ma")!.passed).toBe(false);
  });

  test("axes report observed + threshold for each check", () => {
    const bars = buildIdealFootprint();
    const r = analyzeInstitutionalFootprint(bars);
    expect(r.axes.length).toBe(5);
    for (const a of r.axes) {
      expect(typeof a.passed).toBe("boolean");
      expect(typeof a.observed).toBe("number");
      expect(typeof a.threshold).toBe("number");
      expect(a.description).toBeTruthy();
    }
  });

  test("signatureScore = axesPassed / 5", () => {
    const bars = buildIdealFootprint();
    const r = analyzeInstitutionalFootprint(bars);
    expect(r.signatureScore).toBeCloseTo(r.axesPassed / 5, 4);
  });

  test("custom thresholds tighten or relax the verdict", () => {
    const bars = buildIdealFootprint();
    const strict = analyzeInstitutionalFootprint(bars, {
      minConsecutiveVolumeBars: 10,
    });
    expect(strict.axes.find((a) => a.axis === "consecutive_volume")!.passed).toBe(false);
    expect(strict.verdict).not.toBe("accumulation_visible");
  });
});

describe("formatInstitutionalFootprint", () => {
  test("renders verdict + axes table", () => {
    const bars = buildIdealFootprint();
    const r = analyzeInstitutionalFootprint(bars);
    const text = formatInstitutionalFootprint(r);
    expect(text).toContain("Institutional Footprint");
    expect(text).toContain("Axes passed");
    expect(text).toContain("consecutive_volume");
    expect(text).toContain("holds_ma");
  });
});
