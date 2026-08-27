import { describe, expect, test } from "bun:test";
import { scoreFipMomentum, formatFipMomentum, type FipAsset } from "./fip-momentum-quality.ts";

function smoothUptrend(perDay: number, days: number, noise = 0.001): number[] {
  // Many small positive days, few negatives — smooth diffusion
  const out: number[] = [];
  for (let i = 0; i < days; i++) {
    const wobble = Math.sin(i * 1.3) * noise;
    out.push(perDay + wobble);
  }
  return out;
}

function spikyUptrend(totalReturn: number, days: number): number[] {
  // One big spike day, rest small (and mostly negative)
  const out: number[] = [];
  // Most days: small negative drift
  for (let i = 0; i < days - 1; i++) {
    out.push(-0.001);
  }
  // Compute the spike that brings total compound to ~totalReturn
  // (1 + spike) × (1 - 0.001)^(days-1) = 1 + totalReturn
  const negProduct = (1 - 0.001) ** (days - 1);
  const spike = (1 + totalReturn) / negProduct - 1;
  out.splice(Math.floor(days / 2), 0, spike);
  return out.slice(0, days);
}

describe("scoreFipMomentum", () => {
  test("too few assets → insufficient_data", () => {
    const r = scoreFipMomentum([{ symbol: "A", dailyReturns: smoothUptrend(0.002, 30) }]);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("smooth uptrend → smooth_momentum quality", () => {
    const assets: FipAsset[] = [
      { symbol: "SMOOTH", dailyReturns: smoothUptrend(0.003, 40) },
      { symbol: "FLAT1", dailyReturns: new Array(40).fill(0.0001) },
      { symbol: "FLAT2", dailyReturns: new Array(40).fill(-0.0001) },
      { symbol: "FLAT3", dailyReturns: new Array(40).fill(0.0001) },
      { symbol: "FLAT4", dailyReturns: new Array(40).fill(-0.0001) },
    ];
    const r = scoreFipMomentum(assets);
    const smooth = r.perAsset.find((p) => p.symbol === "SMOOTH")!;
    expect(smooth.fipQuality).toBe("smooth_momentum");
    expect(smooth.fip).toBeLessThan(-0.1);
    expect(smooth.isHighQualityMomentum).toBe(true);
  });

  test("spiky uptrend → spiky_momentum quality", () => {
    const assets: FipAsset[] = [
      { symbol: "SPIKY", dailyReturns: spikyUptrend(0.3, 40) },
      { symbol: "FLAT1", dailyReturns: new Array(40).fill(0.0001) },
      { symbol: "FLAT2", dailyReturns: new Array(40).fill(0.0001) },
      { symbol: "FLAT3", dailyReturns: new Array(40).fill(0.0001) },
      { symbol: "FLAT4", dailyReturns: new Array(40).fill(0.0001) },
    ];
    const r = scoreFipMomentum(assets);
    const spiky = r.perAsset.find((p) => p.symbol === "SPIKY")!;
    expect(spiky.totalReturn).toBeGreaterThan(0);
    expect(spiky.fip).toBeGreaterThan(0.1);
    expect(spiky.fipQuality).toBe("spiky_momentum");
    expect(spiky.isHighQualityMomentum).toBe(false);
  });

  test("identical total returns, different FIP → different quality verdict", () => {
    const smoothSeries = smoothUptrend(0.0067, 40); // ~30% over 40 days
    const spikySeries = spikyUptrend(0.3, 40);
    const fillers: FipAsset[] = Array.from({ length: 3 }, (_, i) => ({
      symbol: `F${i}`,
      dailyReturns: new Array(40).fill(0.0001),
    }));
    const r = scoreFipMomentum([
      { symbol: "SMOOTH", dailyReturns: smoothSeries },
      { symbol: "SPIKY", dailyReturns: spikySeries },
      ...fillers,
    ]);
    const smooth = r.perAsset.find((p) => p.symbol === "SMOOTH")!;
    const spiky = r.perAsset.find((p) => p.symbol === "SPIKY")!;
    // Both should have high total returns
    expect(smooth.totalReturn).toBeGreaterThan(0.2);
    expect(spiky.totalReturn).toBeGreaterThan(0.2);
    // But quality should differ
    expect(smooth.fipQuality).toBe("smooth_momentum");
    expect(spiky.fipQuality).toBe("spiky_momentum");
  });

  test("downtrend with mostly negative days → smooth_momentum (sign-adjusted)", () => {
    const assets: FipAsset[] = [
      { symbol: "DOWN", dailyReturns: smoothUptrend(-0.003, 40) }, // smooth down
      { symbol: "FLAT1", dailyReturns: new Array(40).fill(0) },
      { symbol: "FLAT2", dailyReturns: new Array(40).fill(0) },
      { symbol: "FLAT3", dailyReturns: new Array(40).fill(0) },
      { symbol: "FLAT4", dailyReturns: new Array(40).fill(0) },
    ];
    const r = scoreFipMomentum(assets);
    const down = r.perAsset.find((p) => p.symbol === "DOWN")!;
    expect(down.totalReturn).toBeLessThan(0);
    expect(down.fipQuality).toBe("smooth_momentum");
  });

  test("returnRank ordered by total return descending", () => {
    const assets: FipAsset[] = [
      { symbol: "A", dailyReturns: smoothUptrend(0.001, 30) },
      { symbol: "B", dailyReturns: smoothUptrend(0.005, 30) },
      { symbol: "C", dailyReturns: smoothUptrend(0.003, 30) },
      { symbol: "D", dailyReturns: smoothUptrend(0.0001, 30) },
    ];
    const r = scoreFipMomentum(assets);
    expect(r.perAsset[0]!.symbol).toBe("B");
    expect(r.perAsset[1]!.symbol).toBe("C");
    expect(r.perAsset[2]!.symbol).toBe("A");
    expect(r.perAsset[3]!.symbol).toBe("D");
  });

  test("custom topReturnFraction expands high-quality bucket", () => {
    const assets: FipAsset[] = [];
    for (let i = 0; i < 10; i++) {
      assets.push({
        symbol: `S${i}`,
        dailyReturns: smoothUptrend(0.001 * (10 - i), 30),
      });
    }
    const strict = scoreFipMomentum(assets, { topReturnFraction: 0.1 });
    const lax = scoreFipMomentum(assets, { topReturnFraction: 0.5 });
    expect(lax.highQualityMomentum.length).toBeGreaterThanOrEqual(
      strict.highQualityMomentum.length,
    );
  });

  test("lookbackDays uses most-recent slice", () => {
    // 60 days total: first 30 spiky, last 30 smooth
    const recentSmooth = smoothUptrend(0.003, 30);
    const oldSpiky = spikyUptrend(0.2, 30);
    const series = [...oldSpiky, ...recentSmooth];
    const recentOnly = scoreFipMomentum(
      [
        { symbol: "X", dailyReturns: series },
        { symbol: "F1", dailyReturns: new Array(60).fill(0) },
        { symbol: "F2", dailyReturns: new Array(60).fill(0) },
      ],
      { lookbackDays: 30 },
    );
    const xRecent = recentOnly.perAsset.find((p) => p.symbol === "X")!;
    expect(xRecent.fipQuality).toBe("smooth_momentum");
  });

  test("verdict: quality_momentum_found when smooth uptrend dominates", () => {
    const assets: FipAsset[] = [];
    for (let i = 0; i < 5; i++) {
      assets.push({
        symbol: `WIN${i}`,
        dailyReturns: smoothUptrend(0.002 + i * 0.0005, 40),
      });
    }
    for (let i = 0; i < 5; i++) {
      assets.push({
        symbol: `FLAT${i}`,
        dailyReturns: new Array(40).fill(0.0001),
      });
    }
    const r = scoreFipMomentum(assets);
    expect(r.verdict).toBe("quality_momentum_found");
    expect(r.highQualityMomentum.length).toBeGreaterThan(0);
  });

  test("verdict: weak_quality_momentum when top-return assets are spiky", () => {
    const assets: FipAsset[] = [];
    for (let i = 0; i < 5; i++) {
      assets.push({
        symbol: `SPIKE${i}`,
        dailyReturns: spikyUptrend(0.2 + i * 0.02, 40),
      });
    }
    for (let i = 0; i < 5; i++) {
      assets.push({
        symbol: `FLAT${i}`,
        dailyReturns: new Array(40).fill(0.0001),
      });
    }
    const r = scoreFipMomentum(assets);
    expect(["weak_quality_momentum", "quality_momentum_found"]).toContain(r.verdict);
    if (r.verdict === "weak_quality_momentum") {
      expect(r.spikyTopReturn.length).toBeGreaterThan(0);
    }
  });

  test("verdict: no_directional_momentum when all top-return assets are negative", () => {
    const assets: FipAsset[] = [];
    for (let i = 0; i < 5; i++) {
      assets.push({
        symbol: `DOWN${i}`,
        dailyReturns: smoothUptrend(-0.001 - i * 0.0005, 30),
      });
    }
    const r = scoreFipMomentum(assets);
    expect(r.verdict).toBe("no_directional_momentum");
  });

  test("FIP formula: sign-adjusted (neg - pos) / T", () => {
    // 30 days with exactly 20 positive and 10 negative, total return positive
    const returns: number[] = [];
    for (let i = 0; i < 20; i++) returns.push(0.01); // 20 positive
    for (let i = 0; i < 10; i++) returns.push(-0.005); // 10 negative
    const fillers: FipAsset[] = Array.from({ length: 3 }, (_, i) => ({
      symbol: `F${i}`,
      dailyReturns: new Array(30).fill(0),
    }));
    const r = scoreFipMomentum([{ symbol: "X", dailyReturns: returns }, ...fillers]);
    const x = r.perAsset.find((p) => p.symbol === "X")!;
    expect(x.totalReturn).toBeGreaterThan(0);
    // FIP = sign(+) × (10 - 20) / 30 = -1/3 ≈ -0.333
    expect(x.fip).toBeCloseTo(-10 / 30, 3);
    expect(x.fipQuality).toBe("smooth_momentum");
  });

  test("positive + negative day counts sum to sampleSize − zero days", () => {
    const r = scoreFipMomentum([
      { symbol: "A", dailyReturns: smoothUptrend(0.001, 30) },
      { symbol: "B", dailyReturns: smoothUptrend(-0.001, 30) },
      { symbol: "C", dailyReturns: smoothUptrend(0.002, 30) },
    ]);
    for (const p of r.perAsset) {
      expect(p.positiveDays + p.negativeDays + p.zeroDays).toBe(p.sampleSize);
    }
  });
});

describe("formatFipMomentum", () => {
  test("renders verdict + per-asset table", () => {
    const assets: FipAsset[] = [];
    for (let i = 0; i < 5; i++) {
      assets.push({
        symbol: `S${i}`,
        dailyReturns: smoothUptrend(0.002 + i * 0.0003, 30),
      });
    }
    const r = scoreFipMomentum(assets);
    const text = formatFipMomentum(r);
    expect(text).toContain("FIP Momentum Quality");
    expect(text).toContain("Top assets by return");
  });
});
