import { describe, it, expect } from "bun:test";

import {
  isKalmanVolatilityEnabled,
  kalmanVolatility,
  kalmanVolatilityToPayload,
  KALMAN_VOLATILITY_FLAG_ENV,
} from "./kalmanVolatility.ts";

function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function gaussianRng(rng: () => number): () => number {
  return () => {
    const u1 = Math.max(rng(), 1e-12);
    const u2 = rng();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function simulateReturns(n: number, sigma: number, seed = 1): number[] {
  const rng = gaussianRng(makeRng(seed));
  const out: number[] = [];
  for (let t = 0; t < n; t++) out.push(rng() * sigma);
  return out;
}

describe("isKalmanVolatilityEnabled", () => {
  it("respects the flag", () => {
    expect(isKalmanVolatilityEnabled({})).toBe(false);
    expect(isKalmanVolatilityEnabled({ [KALMAN_VOLATILITY_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("kalmanVolatility — constant-vol recovery", () => {
  it("converges to ~10% annualized for σ_daily = 10%/sqrt(252)", () => {
    const dailySigma = 0.10 / Math.sqrt(252);
    const returns = simulateReturns(2000, dailySigma, 42);
    const r = kalmanVolatility({ returns, q: 0.01, r: 1.0 });
    expect(r.currentAnnualVol).toBeGreaterThan(0.05);
    expect(r.currentAnnualVol).toBeLessThan(0.18);
  });

  it("converges materially above the 10% scenario for σ_daily = 30%/sqrt(252)", () => {
    const dailySigma = 0.30 / Math.sqrt(252);
    const returns = simulateReturns(2000, dailySigma, 7);
    const r = kalmanVolatility({ returns, q: 0.01, r: 1.0 });
    // Finite-sample chi-squared variance estimation has natural downward pull;
    // verify the filter separates the regime from the 10% scenario meaningfully.
    expect(r.currentAnnualVol).toBeGreaterThan(0.15);
    expect(r.currentAnnualVol).toBeLessThan(0.45);
  });
});

describe("kalmanVolatility — regime shift", () => {
  it("tracks a step change from low to high vol", () => {
    const lowSigma = 0.10 / Math.sqrt(252);
    const highSigma = 0.40 / Math.sqrt(252);
    const lowReturns = simulateReturns(400, lowSigma, 11);
    const highReturns = simulateReturns(400, highSigma, 12);
    const returns = [...lowReturns, ...highReturns];
    const r = kalmanVolatility({ returns, q: 0.2, r: 1.0 });
    // Average of last 100 should be markedly higher than average of bars 200-300
    const lowPeriodAvg = r.annualVol.slice(200, 300).reduce((s, v) => s + v, 0) / 100;
    const highPeriodAvg = r.annualVol.slice(700, 800).reduce((s, v) => s + v, 0) / 100;
    expect(highPeriodAvg).toBeGreaterThan(lowPeriodAvg);
    expect(highPeriodAvg / lowPeriodAvg).toBeGreaterThan(1.5);
  });
});

describe("kalmanVolatility — q controls responsiveness", () => {
  it("higher q produces wider min-to-max range than lower q on same series", () => {
    const dailySigma = 0.20 / Math.sqrt(252);
    const returns = simulateReturns(1000, dailySigma, 99);
    const slow = kalmanVolatility({ returns, q: 0.001, r: 1.0 });
    const fast = kalmanVolatility({ returns, q: 0.5, r: 1.0 });
    const slowRange = slow.maxAnnualVol - slow.minAnnualVol;
    const fastRange = fast.maxAnnualVol - fast.minAnnualVol;
    expect(fastRange).toBeGreaterThan(slowRange);
  });
});

describe("kalmanVolatility — boundary cases", () => {
  it("empty input returns zeros", () => {
    const r = kalmanVolatility({ returns: [] });
    expect(r.sampleSize).toBe(0);
    expect(r.currentAnnualVol).toBe(0);
  });

  it("respects custom periodsPerYear (hourly = 252*24)", () => {
    const returns = simulateReturns(1000, 0.001, 5);
    const dailyAnn = kalmanVolatility({ returns, periodsPerYear: 252 });
    const hourlyAnn = kalmanVolatility({ returns, periodsPerYear: 252 * 24 });
    // Annualizing at higher frequency should give larger annual vol
    expect(hourlyAnn.currentAnnualVol).toBeGreaterThan(dailyAnn.currentAnnualVol);
  });

  it("respects explicit logVar0", () => {
    const returns = simulateReturns(50, 0.01, 1);
    const a = kalmanVolatility({ returns, logVar0: Math.log(1e-6), q: 0.01 });
    const b = kalmanVolatility({ returns, logVar0: Math.log(1e-2), q: 0.01 });
    // Starting from very different initial estimates → early values differ
    expect(a.annualVol[0]).not.toBe(b.annualVol[0]);
  });

  it("zero returns produce non-NaN bounded estimates", () => {
    const r = kalmanVolatility({ returns: new Array(100).fill(0) });
    for (const v of r.annualVol) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});

describe("kalmanVolatility — range reporting", () => {
  it("min ≤ mean ≤ max", () => {
    const dailySigma = 0.15 / Math.sqrt(252);
    const returns = simulateReturns(500, dailySigma, 3);
    const r = kalmanVolatility({ returns, q: 0.1 });
    expect(r.minAnnualVol).toBeLessThanOrEqual(r.meanAnnualVol);
    expect(r.meanAnnualVol).toBeLessThanOrEqual(r.maxAnnualVol);
  });
});

describe("kalmanVolatilityToPayload", () => {
  it("emits stable shape", () => {
    const returns = simulateReturns(100, 0.01, 5);
    const r = kalmanVolatility({ returns });
    const p = kalmanVolatilityToPayload(r) as { kind: string; currentAnnualVol: number };
    expect(p.kind).toBe("kalman_volatility.computed");
    expect(typeof p.currentAnnualVol).toBe("number");
  });
});
