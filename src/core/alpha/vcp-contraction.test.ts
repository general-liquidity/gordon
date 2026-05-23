import { describe, expect, test } from "bun:test";
import {
  analyzeVcpContraction,
  formatVcpContraction,
  type VcpCandle,
} from "./vcp-contraction.ts";

function makeCandle(open: number, high: number, low: number, close: number, volume: number): VcpCandle {
  return { open, high, low, close, volume };
}

describe("analyzeVcpContraction", () => {
  test("insufficient_data with too few candles", () => {
    const bars = Array(3).fill(0).map(() => makeCandle(100, 102, 99, 101, 1000));
    const r = analyzeVcpContraction(bars);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("steady-volume flat-range bars → expanding (no contraction)", () => {
    const bars = Array(20).fill(0).map(() => makeCandle(100, 102, 99, 101, 1000));
    const r = analyzeVcpContraction(bars);
    expect(r.verdict).toBe("expanding");
    expect(r.contractingAxes).toBe(0);
  });

  test("classic VCP: body+range+volume all shrinking → spring_ready", () => {
    const baseline = Array(20).fill(0).map(() => makeCandle(100, 105, 95, 100, 10000));
    const contraction: VcpCandle[] = [];
    // 5-day tight coil sitting around price 100, all three axes contracting
    const widths = [2.0, 1.5, 1.0, 0.6, 0.3];
    const volumes = [7000, 5000, 4000, 3000, 2500];
    for (let i = 0; i < 5; i++) {
      const w = widths[i]!;
      const open = 100;
      const close = 100 + w * 0.3;
      const high = 100 + w;
      const low = 100 - w * 0.5;
      contraction.push(makeCandle(open, high, low, close, volumes[i]!));
    }
    const r = analyzeVcpContraction([...baseline, ...contraction]);
    expect(r.contractingAxes).toBe(3);
    expect(r.verdict).toBe("spring_ready");
    expect(r.contractionScore).toBeGreaterThan(0.9);
  });

  test("only volume contracting → mixed", () => {
    const baseline = Array(20).fill(0).map(() => makeCandle(100, 102, 99, 101, 10000));
    // Bodies + ranges constant but volume sharply declining
    const tail: VcpCandle[] = [];
    const vols = [9000, 7000, 5000, 3000, 2000];
    for (const v of vols) tail.push(makeCandle(100, 102, 99, 101, v));
    const r = analyzeVcpContraction([...baseline, ...tail]);
    expect(r.contractingAxes).toBe(1);
    expect(r.verdict).toBe("mixed");
  });

  test("body+range contracting but volume rising → contracting (not spring_ready)", () => {
    const baseline = Array(20).fill(0).map(() => makeCandle(100, 105, 95, 100, 1000));
    const tail: VcpCandle[] = [];
    const widths = [2.0, 1.5, 1.0, 0.6, 0.3];
    const vols = [2000, 3000, 4500, 6000, 8000];
    for (let i = 0; i < 5; i++) {
      const w = widths[i]!;
      tail.push(makeCandle(100, 100 + w, 100 - w * 0.5, 100 + w * 0.3, vols[i]!));
    }
    const r = analyzeVcpContraction([...baseline, ...tail]);
    expect(r.contractingAxes).toBe(2);
    expect(r.verdict).toBe("contracting");
  });

  test("tight range required for spring_ready", () => {
    // All 3 axes contracting but tail range is too wide
    const baseline = Array(20).fill(0).map(() => makeCandle(100, 105, 95, 100, 10000));
    const tail: VcpCandle[] = [
      makeCandle(100, 130, 70, 100, 7000),
      makeCandle(100, 125, 75, 100, 5000),
      makeCandle(100, 120, 80, 100, 4000),
      makeCandle(100, 115, 85, 100, 3000),
      makeCandle(100, 113, 87, 100, 2500),
    ];
    const r = analyzeVcpContraction([...baseline, ...tail]);
    expect(r.contractingAxes).toBe(2);
    // Range/low here is (130 - 70)/70 ≈ 86% — way above 10% default
    expect(r.windowRangeOverLow).toBeGreaterThan(0.10);
    expect(r.verdict).not.toBe("spring_ready");
  });

  test("respects custom thresholds", () => {
    const baseline = Array(20).fill(0).map(() => makeCandle(100, 102, 99, 100, 10000));
    const tail: VcpCandle[] = [];
    const widths = [1.5, 1.3, 1.1, 0.9, 0.7];
    const vols = [9000, 8500, 8000, 7500, 7000];
    for (let i = 0; i < 5; i++) {
      const w = widths[i]!;
      tail.push(makeCandle(100, 100 + w, 100 - w * 0.5, 100 + w * 0.2, vols[i]!));
    }
    const strict = analyzeVcpContraction([...baseline, ...tail], {
      bodyShrinkThresholdPct: -5,
      rangeShrinkThresholdPct: -5,
      volumeShrinkThresholdPct: -5,
    });
    const lax = analyzeVcpContraction([...baseline, ...tail], {
      bodyShrinkThresholdPct: -0.1,
      rangeShrinkThresholdPct: -0.1,
      volumeShrinkThresholdPct: -0.1,
    });
    expect(lax.contractingAxes).toBeGreaterThanOrEqual(strict.contractingAxes);
  });

  test("zero-mean volume window handles gracefully", () => {
    const bars = Array(20).fill(0).map(() => makeCandle(100, 102, 99, 101, 0));
    const r = analyzeVcpContraction(bars);
    expect(r).toBeDefined();
    expect(Number.isFinite(r.relativeVolume)).toBe(true);
  });
});

describe("formatVcpContraction", () => {
  test("renders verdict and spring banner when spring_ready", () => {
    const baseline = Array(20).fill(0).map(() => makeCandle(100, 105, 95, 100, 10000));
    const widths = [2.0, 1.5, 1.0, 0.6, 0.3];
    const volumes = [7000, 5000, 4000, 3000, 2500];
    const contraction = widths.map((w, i) =>
      makeCandle(100, 100 + w, 100 - w * 0.5, 100 + w * 0.3, volumes[i]!),
    );
    const r = analyzeVcpContraction([...baseline, ...contraction]);
    const text = formatVcpContraction(r);
    expect(text).toContain("VCP Contraction");
    if (r.verdict === "spring_ready") expect(text).toContain("Spring ready");
  });
});
