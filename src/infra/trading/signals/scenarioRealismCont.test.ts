import { describe, expect, it } from "bun:test";
import { validateContStylizedFacts } from "./scenarioRealismCont.ts";

// Deterministic PRNG (mulberry32) + Box-Muller so the distributional facts are
// reproducible without a hardcoded fixture.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(rng(), 1e-12);
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** iid scale-mixture => leptokurtic but independent (no clustering). */
function scaleMixtureReturns(n: number, seed: number): number[] {
  const rng = mulberry32(seed);
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const jump = rng() < 0.05;
    out.push(gaussian(rng) * (jump ? 0.05 : 0.01));
  }
  return out;
}

describe("validateContStylizedFacts", () => {
  it("returns valid:false on too-short or non-finite input", () => {
    expect(validateContStylizedFacts([0.01, -0.02, 0.03]).valid).toBe(false);
    const withNaN = new Array(40).fill(0.01);
    withNaN[10] = Number.NaN;
    expect(validateContStylizedFacts(withNaN).valid).toBe(false);
  });

  it("flags intermittency when volatility arrives in bursts", () => {
    const returns = new Array(200).fill(0.001);
    for (let i = 50; i < 60; i++) returns[i] = 0.05; // one bursty window
    const facts = validateContStylizedFacts(returns, { fanoWindow: 10 });
    expect(facts.valid).toBe(true);
    expect(facts.fanoFactor).toBeGreaterThan(1);
    expect(facts.intermittency).toBe(true);
  });

  it("flags gain/loss asymmetry for a negatively skewed series", () => {
    const returns: number[] = [];
    for (let i = 0; i < 190; i++) returns.push(0.01);
    for (let i = 0; i < 10; i++) returns.push(-0.1); // few sharp losses
    const facts = validateContStylizedFacts(returns);
    expect(facts.skewness).toBeLessThan(0);
    expect(facts.gainLossAsymmetry).toBe(true);
  });

  it("reports volume/volatility coupling only when volume is supplied", () => {
    const returns = scaleMixtureReturns(500, 7);
    const volume = returns.map((r) => 1000 + Math.abs(r) * 50000); // couples to |r|
    const withVol = validateContStylizedFacts(returns, {}, volume);
    expect(withVol.volumeVolatilityCorrelation).not.toBeNull();
    expect(withVol.volumeVolatilityCorrelation!).toBeGreaterThan(0);
    expect(withVol.volumeVolatilityCoupling).toBe(true);

    const noVol = validateContStylizedFacts(returns);
    expect(noVol.volumeVolatilityCorrelation).toBeNull();
    expect(noVol.volumeVolatilityCoupling).toBe(false);
  });

  it("shows aggregational Gaussianity + conditional heavy tails for an iid leptokurtic series", () => {
    const returns = scaleMixtureReturns(2000, 42);
    const facts = validateContStylizedFacts(returns);
    // Base-scale returns are fat-tailed...
    expect(facts.scale1ExcessKurtosis).toBeGreaterThan(0);
    // ...and aggregating (CLT) pulls kurtosis toward Gaussian.
    expect(facts.aggregatedExcessKurtosis).toBeLessThan(facts.scale1ExcessKurtosis);
    expect(facts.aggregationalGaussianity).toBe(true);
    // Tails survive volatility standardization (no clustering to remove).
    expect(facts.conditionalExcessKurtosis).toBeGreaterThan(0);
    expect(facts.conditionalHeavyTails).toBe(true);
  });

  it("keeps the Zumbach measure finite and consistent with its flag", () => {
    const returns = scaleMixtureReturns(600, 11);
    const facts = validateContStylizedFacts(returns);
    expect(Number.isFinite(facts.zumbachAsymmetry)).toBe(true);
    expect(facts.timescaleAsymmetry).toBe(facts.zumbachAsymmetry > 0);
  });
});
