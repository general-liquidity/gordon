import { describe, it, expect } from "bun:test";
import {
  isLoSharpeCorrectionEnabled,
  computeLoSharpeCorrection,
  loSharpeCorrectionToPayload,
  LO_SHARPE_CORRECTION_FLAG_ENV,
} from "./loSharpeCorrection.ts";

describe("isLoSharpeCorrectionEnabled", () => {
  it("respects the flag", () => {
    expect(isLoSharpeCorrectionEnabled({})).toBe(false);
    expect(isLoSharpeCorrectionEnabled({ [LO_SHARPE_CORRECTION_FLAG_ENV]: "1" })).toBe(
      true,
    );
  });
});

// Deterministic RNG for synthetic returns.
function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}
function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

describe("computeLoSharpeCorrection — IID baseline", () => {
  it("for IID returns, η ≈ √q (correction ratio ≈ 1)", () => {
    const rng = makeRng(7);
    // Larger sample + fewer lags → tighter convergence on the IID baseline
    const returns = Array.from({ length: 3000 }, () => 0.001 + 0.01 * gaussian(rng));
    const r = computeLoSharpeCorrection({
      returns,
      periodsPerYear: 252,
      maxLag: 5,
    });
    // For IID returns the correction factor should be close to √252
    expect(r.correctionFactor).toBeGreaterThan(Math.sqrt(252) * 0.7);
    expect(r.correctionFactor).toBeLessThan(Math.sqrt(252) * 1.3);
    expect(Math.abs(r.correctionRatio - 1)).toBeLessThan(0.3);
  });
});

describe("computeLoSharpeCorrection — positive serial correlation shrinks Sharpe", () => {
  it("AR(1) with ρ > 0 reduces corrected Sharpe vs naive", () => {
    // Construct AR(1) returns: r_t = phi·r_{t-1} + ε_t
    const rng = makeRng(11);
    const phi = 0.5;
    const sigma = 0.01;
    const N = 600;
    const returns = new Array<number>(N);
    returns[0] = 0.001 + sigma * gaussian(rng);
    for (let i = 1; i < N; i++) {
      returns[i] = 0.0005 + phi * returns[i - 1]! + sigma * gaussian(rng);
    }
    const r = computeLoSharpeCorrection({
      returns,
      periodsPerYear: 252,
      maxLag: 10,
    });
    // Positive serial correlation → corrected Sharpe smaller in magnitude than naive
    expect(Math.abs(r.correctedAnnualisedSharpe)).toBeLessThan(
      Math.abs(r.naiveAnnualisedSharpe),
    );
    expect(r.correctionRatio).toBeLessThan(1);
    // First-lag autocorrelation should reflect the AR(1) coefficient
    expect(r.autocorrelations[0]!).toBeGreaterThan(0.2);
  });
});

describe("computeLoSharpeCorrection — negative serial correlation expands Sharpe", () => {
  it("anti-persistent series increases corrected Sharpe vs naive", () => {
    const rng = makeRng(31);
    const phi = -0.4;
    const sigma = 0.01;
    const N = 600;
    const returns = new Array<number>(N);
    returns[0] = 0.001 + sigma * gaussian(rng);
    for (let i = 1; i < N; i++) {
      returns[i] = 0.001 + phi * returns[i - 1]! + sigma * gaussian(rng);
    }
    const r = computeLoSharpeCorrection({
      returns,
      periodsPerYear: 252,
      maxLag: 10,
    });
    // Negative serial correlation → corrected Sharpe LARGER than naive
    expect(Math.abs(r.correctedAnnualisedSharpe)).toBeGreaterThan(
      Math.abs(r.naiveAnnualisedSharpe),
    );
    expect(r.correctionRatio).toBeGreaterThan(1);
  });
});

describe("computeLoSharpeCorrection — autocorrelation accuracy", () => {
  it("AR(1) with phi=0.7: ρ_1 ≈ 0.7", () => {
    const rng = makeRng(101);
    const phi = 0.7;
    const sigma = 0.01;
    const N = 2000;
    const returns = new Array<number>(N);
    returns[0] = sigma * gaussian(rng);
    for (let i = 1; i < N; i++) {
      returns[i] = phi * returns[i - 1]! + sigma * gaussian(rng);
    }
    const r = computeLoSharpeCorrection({
      returns,
      periodsPerYear: 252,
      maxLag: 5,
    });
    expect(r.autocorrelations[0]!).toBeGreaterThan(0.5);
    expect(r.autocorrelations[0]!).toBeLessThan(0.85);
  });
});

describe("computeLoSharpeCorrection — validation", () => {
  it("throws on N < 2", () => {
    expect(() =>
      computeLoSharpeCorrection({ returns: [0.01], periodsPerYear: 252 }),
    ).toThrow();
  });
  it("throws on non-positive periodsPerYear", () => {
    expect(() =>
      computeLoSharpeCorrection({ returns: [0.01, 0.02], periodsPerYear: 0 }),
    ).toThrow();
  });
});

describe("computeLoSharpeCorrection — boundary", () => {
  it("zero-variance returns yield zero Sharpe", () => {
    const r = computeLoSharpeCorrection({
      returns: new Array<number>(100).fill(0.001),
      periodsPerYear: 252,
    });
    expect(r.perPeriodSharpe).toBe(0);
    expect(r.naiveAnnualisedSharpe).toBe(0);
    expect(r.correctedAnnualisedSharpe).toBe(0);
  });

  it("risk-free rate is subtracted from each return", () => {
    const ret = [0.01, 0.02, 0.01, 0.02, 0.01, 0.02];
    const withoutRf = computeLoSharpeCorrection({ returns: ret, periodsPerYear: 252 });
    const withRf = computeLoSharpeCorrection({
      returns: ret,
      periodsPerYear: 252,
      riskFreePerPeriod: 0.01,
    });
    // Subtracting Rf=0.01 from [0.01, 0.02, ...] → [0, 0.01, 0, 0.01, 0, 0.01]
    // Mean shifts, Sharpe drops
    expect(withRf.perPeriodSharpe).toBeLessThan(withoutRf.perPeriodSharpe);
  });
});

describe("loSharpeCorrectionToPayload", () => {
  it("emits stable shape", () => {
    const r = computeLoSharpeCorrection({
      returns: [0.01, -0.01, 0.02, -0.005, 0.015],
      periodsPerYear: 252,
    });
    const p = loSharpeCorrectionToPayload(r) as { kind: string };
    expect(p.kind).toBe("lo_sharpe_correction.computed");
  });
});
