import { describe, it, expect } from "bun:test";

import { kalmanBeta, kalmanBetaToPayload } from "./kalmanBeta.ts";

function makeRng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function gaussianRng(rng: () => number): () => number {
  // Box-Muller
  return () => {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function simulateBeta(
  n: number,
  betaSeries: number[],
  seed = 1,
): {
  market: number[];
  asset: number[];
} {
  const rng = gaussianRng(makeRng(seed));
  const market: number[] = [];
  const asset: number[] = [];
  for (let t = 0; t < n; t++) {
    const rm = rng() * 0.01; // 1% daily-ish market noise
    const b = betaSeries[t] ?? betaSeries[betaSeries.length - 1]!;
    const noise = rng() * 0.002; // small idiosyncratic noise
    market.push(rm);
    asset.push(b * rm + noise);
  }
  return { market, asset };
}

describe("kalmanBeta — constant-beta recovery", () => {
  it("recovers beta = 1.2 from synthetic series", () => {
    const trueBeta = 1.2;
    const { market, asset } = simulateBeta(500, new Array(500).fill(trueBeta), 42);
    const r = kalmanBeta({
      assetReturns: asset,
      marketReturns: market,
      q: 1e-6,
      r: 1e-4,
    });
    expect(r.currentBeta).toBeCloseTo(trueBeta, 1);
    expect(r.sampleSize).toBe(500);
  });

  it("recovers beta = 0.5", () => {
    const trueBeta = 0.5;
    const { market, asset } = simulateBeta(500, new Array(500).fill(trueBeta), 7);
    const r = kalmanBeta({
      assetReturns: asset,
      marketReturns: market,
      q: 1e-6,
      r: 1e-4,
    });
    expect(r.currentBeta).toBeCloseTo(trueBeta, 1);
  });
});

describe("kalmanBeta — time-varying beta tracking", () => {
  it("tracks a step change in beta", () => {
    const n = 800;
    const betaSeries: number[] = [];
    for (let i = 0; i < n; i++) betaSeries.push(i < 400 ? 0.8 : 1.5);
    const { market, asset } = simulateBeta(n, betaSeries, 99);
    const r = kalmanBeta({
      assetReturns: asset,
      marketReturns: market,
      q: 1e-3,
      r: 1e-3,
    });
    // Early-half average should be near 0.8
    const earlyAvg = r.betas.slice(50, 350).reduce((s, b) => s + b, 0) / 300;
    expect(earlyAvg).toBeCloseTo(0.8, 0);
    // Latter-half average should be near 1.5
    const lateAvg = r.betas.slice(500, 780).reduce((s, b) => s + b, 0) / 280;
    expect(lateAvg).toBeCloseTo(1.5, 0);
  });
});

describe("kalmanBeta — uncertainty band", () => {
  it("currentStdDev shrinks over time as data accumulates", () => {
    const { market, asset } = simulateBeta(500, new Array(500).fill(1.0), 11);
    const r = kalmanBeta({ assetReturns: asset, marketReturns: market });
    expect(r.currentStdDev).toBeLessThan(0.5);
    expect(r.currentStdDev).toBeGreaterThan(0);
  });
});

describe("kalmanBeta — boundary cases", () => {
  it("empty input returns initial estimate with zero sample size", () => {
    const r = kalmanBeta({ assetReturns: [], marketReturns: [], beta0: 0.7 });
    expect(r.sampleSize).toBe(0);
    expect(r.currentBeta).toBe(0.7);
  });

  it("mismatched lengths use min length", () => {
    const r = kalmanBeta({
      assetReturns: [0.01, 0.02, 0.03, 0.04],
      marketReturns: [0.01, 0.02],
    });
    expect(r.sampleSize).toBe(2);
  });

  it("respects custom beta0 and p0", () => {
    const r = kalmanBeta({
      assetReturns: [],
      marketReturns: [],
      beta0: 2.5,
      p0: 4.0,
    });
    expect(r.currentBeta).toBe(2.5);
    expect(r.currentStdDev).toBe(Math.sqrt(4.0));
  });
});

describe("kalmanBeta — range reporting", () => {
  it("min/max/mean reflect the beta trajectory", () => {
    const n = 300;
    const betaSeries: number[] = [];
    for (let i = 0; i < n; i++) betaSeries.push(0.5 + 1.0 * (i / n));
    const { market, asset } = simulateBeta(n, betaSeries, 3);
    const r = kalmanBeta({
      assetReturns: asset,
      marketReturns: market,
      q: 1e-3,
      r: 1e-3,
    });
    expect(r.minBeta).toBeLessThan(r.maxBeta);
    expect(r.meanBeta).toBeGreaterThan(r.minBeta);
    expect(r.meanBeta).toBeLessThan(r.maxBeta);
  });
});

describe("kalmanBetaToPayload", () => {
  it("emits stable shape", () => {
    const { market, asset } = simulateBeta(100, new Array(100).fill(1.1), 5);
    const r = kalmanBeta({ assetReturns: asset, marketReturns: market });
    const p = kalmanBetaToPayload(r) as { kind: string; currentBeta: number };
    expect(p.kind).toBe("kalman_beta.computed");
    expect(typeof p.currentBeta).toBe("number");
  });
});
