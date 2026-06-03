import { describe, it, expect } from "bun:test";
import { computeVolResidualCorrelation } from "./vol-residual-correlation.ts";

// directional signal d (orthogonal to vol over each 4-block) + opposite vol loadings.
const N = 12;
const d = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 1 : -1));
const vol = Array.from({ length: N }, (_, i) => (Math.floor(i / 2) % 2 === 0 ? 1 : 2));
const yA = d.map((v, i) => v + 3 * vol[i]!);
const yB = d.map((v, i) => v - 3 * vol[i]!);

describe("computeVolResidualCorrelation", () => {
  it("returns neutral with fewer than 2 series", () => {
    const r = computeVolResidualCorrelation({ returnsBySymbol: { A: yA } });
    expect(r.pairs.length).toBe(0);
    expect(r.worstPair).toBeNull();
  });

  it("surfaces correlation that raw returns hid behind opposite vol-timing", () => {
    const r = computeVolResidualCorrelation({
      returnsBySymbol: { A: yA, B: yB },
      volFactor: vol,
    });
    expect(r.volFactorSource).toBe("provided");
    expect(r.pairs.length).toBe(1);
    const p = r.pairs[0]!;
    // Raw returns look uncorrelated/negative (dominated by opposite 3·vol);
    // residuals (≈ the shared d signal) are strongly positively correlated.
    expect(p.residualCorr).toBeGreaterThan(0.9);
    expect(p.residualCorr).toBeGreaterThan(p.rawCorr);
    expect(p.delta).toBeGreaterThan(0.15);
    expect(p.hidden).toBe(true);
    expect(r.hiddenPairCount).toBe(1);
    expect(r.worstPair?.hidden).toBe(true);
  });

  it("falls back to a vol proxy when no factor is provided", () => {
    const r = computeVolResidualCorrelation({ returnsBySymbol: { A: yA, B: yB } });
    expect(r.volFactorSource).toBe("proxy");
    expect(r.pairs.length).toBe(1);
    expect(r.sampleSize).toBe(N);
  });

  it("does not flag genuinely independent residuals as hidden", () => {
    const x1 = Array.from({ length: N }, (_, i) => (i % 2 === 0 ? 1 : -1));
    const x2 = Array.from({ length: N }, (_, i) => (i % 3 === 0 ? 1 : -1));
    const r = computeVolResidualCorrelation({ returnsBySymbol: { A: x1, B: x2 }, volFactor: vol });
    expect(r.pairs[0]!.hidden).toBe(false);
  });
});
