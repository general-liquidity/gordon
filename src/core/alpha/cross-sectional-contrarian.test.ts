import { describe, expect, test } from "bun:test";
import {
  sizeCrossSectionalContrarian,
  formatCrossSectionalContrarian,
  type ContrarianAsset,
} from "./cross-sectional-contrarian.ts";

function genPrices(start: number, totalReturn: number, steps: number, noise = 0.005): number[] {
  // Smooth geometric trajectory with mild noise so σ is non-degenerate.
  const out: number[] = [start];
  const r = (1 + totalReturn) ** (1 / steps);
  let p = start;
  for (let i = 1; i <= steps; i++) {
    const wobble = 1 + (Math.sin(i * 1.7) - 0.3) * noise;
    p = p * r * wobble;
    out.push(p);
  }
  return out;
}

describe("sizeCrossSectionalContrarian", () => {
  test("insufficient symbols → insufficient_data", () => {
    const r = sizeCrossSectionalContrarian([
      { symbol: "A", prices: [100, 102] },
      { symbol: "B", prices: [100, 101] },
    ]);
    expect(r.verdict).toBe("insufficient_data");
  });

  test("identical returns → no_dispersion", () => {
    const ps = genPrices(100, 0.05, 20);
    const r = sizeCrossSectionalContrarian([
      { symbol: "A", prices: ps },
      { symbol: "B", prices: ps },
      { symbol: "C", prices: ps },
    ]);
    expect(r.verdict).toBe("no_dispersion");
  });

  test("winners get short weight, losers get long weight", () => {
    const assets: ContrarianAsset[] = [
      { symbol: "WINNER", prices: genPrices(100, 0.2, 30) },
      { symbol: "FLAT_A", prices: genPrices(100, 0.0, 30) },
      { symbol: "FLAT_B", prices: genPrices(100, 0.0, 30) },
      { symbol: "FLAT_C", prices: genPrices(100, 0.0, 30) },
      { symbol: "LOSER", prices: genPrices(100, -0.15, 30) },
    ];
    const r = sizeCrossSectionalContrarian(assets);
    expect(r.verdict).toBe("weighted");
    const w = (sym: string) => r.weights.find((x) => x.symbol === sym)!;
    expect(w("WINNER").side).toBe("short");
    expect(w("LOSER").side).toBe("long");
  });

  test("dollar-neutrality: net exposure ≈ 0", () => {
    const assets: ContrarianAsset[] = [
      { symbol: "A", prices: genPrices(100, 0.1, 30) },
      { symbol: "B", prices: genPrices(100, 0.05, 30) },
      { symbol: "C", prices: genPrices(100, 0.0, 30) },
      { symbol: "D", prices: genPrices(100, -0.05, 30) },
      { symbol: "E", prices: genPrices(100, -0.1, 30) },
    ];
    const r = sizeCrossSectionalContrarian(assets);
    expect(Math.abs(r.netExposure)).toBeLessThan(1e-4);
  });

  test("gross exposure normalizes to 1.0", () => {
    const assets: ContrarianAsset[] = [
      { symbol: "A", prices: genPrices(100, 0.1, 30) },
      { symbol: "B", prices: genPrices(100, 0.05, 30) },
      { symbol: "C", prices: genPrices(100, 0.0, 30) },
      { symbol: "D", prices: genPrices(100, -0.05, 30) },
      { symbol: "E", prices: genPrices(100, -0.1, 30) },
    ];
    const r = sizeCrossSectionalContrarian(assets);
    expect(r.grossExposure).toBeCloseTo(1.0, 2);
  });

  test("inverse-sigma weighting reduces volatile names vs none", () => {
    const calmReturns = genPrices(100, 0.05, 30, 0.001);
    const wildReturns = genPrices(100, 0.05, 30, 0.05);
    const fillerLoser = genPrices(100, -0.1, 30, 0.01);
    const fillerFlat = genPrices(100, 0.0, 30, 0.01);
    const assets: ContrarianAsset[] = [
      { symbol: "CALM", prices: calmReturns },
      { symbol: "WILD", prices: wildReturns },
      { symbol: "L", prices: fillerLoser },
      { symbol: "F1", prices: fillerFlat },
      { symbol: "F2", prices: fillerFlat },
    ];
    const noScale = sizeCrossSectionalContrarian(assets, { volatilityWeighting: "none" });
    const invSigma = sizeCrossSectionalContrarian(assets, {
      volatilityWeighting: "inverse_sigma",
    });
    const wWildNo = noScale.weights.find((x) => x.symbol === "WILD")!.weight;
    const wWildInv = invSigma.weights.find((x) => x.symbol === "WILD")!.weight;
    // Inverse-sigma should produce smaller-magnitude weight for WILD
    expect(Math.abs(wWildInv)).toBeLessThan(Math.abs(wWildNo));
  });

  test("maxAbsoluteWeight caps single-name concentration", () => {
    const assets: ContrarianAsset[] = [
      { symbol: "EXTREME", prices: genPrices(100, 1.5, 30) },
      { symbol: "MILD_A", prices: genPrices(100, 0.01, 30) },
      { symbol: "MILD_B", prices: genPrices(100, 0.01, 30) },
      { symbol: "MILD_C", prices: genPrices(100, 0.01, 30) },
      { symbol: "MILD_D", prices: genPrices(100, 0.01, 30) },
      { symbol: "MILD_E", prices: genPrices(100, 0.01, 30) },
    ];
    const capped = sizeCrossSectionalContrarian(assets, { maxAbsoluteWeight: 0.25 });
    for (const w of capped.weights) {
      expect(Math.abs(w.weight)).toBeLessThanOrEqual(0.2501);
    }
  });

  test("demeaned returns sum to ≈ 0", () => {
    const assets: ContrarianAsset[] = [
      { symbol: "A", prices: genPrices(100, 0.1, 30) },
      { symbol: "B", prices: genPrices(100, 0.05, 30) },
      { symbol: "C", prices: genPrices(100, 0.0, 30) },
      { symbol: "D", prices: genPrices(100, -0.05, 30) },
      { symbol: "E", prices: genPrices(100, -0.1, 30) },
    ];
    const r = sizeCrossSectionalContrarian(assets);
    const sumDemeaned = r.weights.reduce((s, w) => s + w.demeanedReturn, 0);
    expect(Math.abs(sumDemeaned)).toBeLessThan(1e-9);
  });

  test("contrarian sign: largest winner has most-negative weight", () => {
    const assets: ContrarianAsset[] = [
      { symbol: "BIG_WIN", prices: genPrices(100, 0.3, 30) },
      { symbol: "SMALL_WIN", prices: genPrices(100, 0.05, 30) },
      { symbol: "FLAT", prices: genPrices(100, 0.0, 30) },
      { symbol: "SMALL_LOSS", prices: genPrices(100, -0.05, 30) },
      { symbol: "BIG_LOSS", prices: genPrices(100, -0.2, 30) },
    ];
    const r = sizeCrossSectionalContrarian(assets, { volatilityWeighting: "none" });
    const sorted = [...r.weights].sort((a, b) => a.weight - b.weight);
    expect(sorted[0]!.symbol).toBe("BIG_WIN");
    expect(sorted[sorted.length - 1]!.symbol).toBe("BIG_LOSS");
  });

  test("inverse_sigma_squared weighting is valid", () => {
    const assets: ContrarianAsset[] = [
      { symbol: "A", prices: genPrices(100, 0.1, 30) },
      { symbol: "B", prices: genPrices(100, 0.05, 30) },
      { symbol: "C", prices: genPrices(100, 0.0, 30) },
      { symbol: "D", prices: genPrices(100, -0.05, 30) },
      { symbol: "E", prices: genPrices(100, -0.1, 30) },
    ];
    const r = sizeCrossSectionalContrarian(assets, {
      volatilityWeighting: "inverse_sigma_squared",
    });
    expect(r.verdict).toBe("weighted");
    expect(r.grossExposure).toBeCloseTo(1.0, 2);
  });
});

describe("formatCrossSectionalContrarian", () => {
  test("renders weighted result with LONG/SHORT lists", () => {
    const assets: ContrarianAsset[] = [
      { symbol: "A", prices: genPrices(100, 0.1, 30) },
      { symbol: "B", prices: genPrices(100, 0.05, 30) },
      { symbol: "C", prices: genPrices(100, 0.0, 30) },
      { symbol: "D", prices: genPrices(100, -0.05, 30) },
      { symbol: "E", prices: genPrices(100, -0.1, 30) },
    ];
    const r = sizeCrossSectionalContrarian(assets);
    const text = formatCrossSectionalContrarian(r);
    expect(text).toContain("Cross-Sectional Contrarian");
    expect(text).toContain("Largest LONGs");
    expect(text).toContain("Largest SHORTs");
  });
});
