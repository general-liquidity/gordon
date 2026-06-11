import { describe, expect, test } from "bun:test";
import {
  probabilisticSharpeRatio,
  deflatedSharpeRatio,
  minimumTrackRecordLength,
  combinatorialPurgedCV,
  assessBacktestCredibility,
} from "./backtestCredibility.ts";

/** Strong, consistent positive returns: per-period Sharpe ~3.5. */
function strongReturns(n: number = 200): number[] {
  return Array.from({ length: n }, (_, i) => 0.005 + 0.002 * Math.sin(i));
}

/**
 * Two-point alternating returns: mean 0.0015, std ~0.01 → per-period SR ~0.15.
 * PSR-significant vs benchmark 0, but fails DSR once many strategies were tried.
 */
function marginalReturns(n: number = 200): number[] {
  return Array.from({ length: n }, (_, i) => (i % 2 === 0 ? 0.0115 : -0.0085));
}

function negativeReturns(n: number = 200): number[] {
  return Array.from({ length: n }, (_, i) => -0.005 + 0.002 * Math.sin(i));
}

describe("probabilisticSharpeRatio", () => {
  test("returns neutral defaults below 10 observations", () => {
    const r = probabilisticSharpeRatio([0.01, 0.02, -0.01, 0.005, 0.01, 0.02, -0.01, 0.005, 0.01]);
    expect(r.psr).toBe(0.5);
    expect(r.observedSharpe).toBe(0);
    expect(r.significant).toBe(false);
  });

  test("returns neutral defaults for exactly-zero-variance returns", () => {
    const r = probabilisticSharpeRatio(new Array(50).fill(1));
    expect(r.psr).toBe(0.5);
    expect(r.observedSharpe).toBe(0);
    expect(r.significant).toBe(false);
  });

  test("float noise from constant 0.01 returns is caught by the zero-variance guard", () => {
    // sum(50 × 0.01)/50 !== 0.01 exactly, so stddev is ~1e-18 instead of 0.
    // The relative-epsilon guard must treat that as zero variance, not as an
    // astronomical Sharpe.
    const r = probabilisticSharpeRatio(new Array(50).fill(0.01));
    expect(r.psr).toBe(0.5);
    expect(r.observedSharpe).toBe(0);
    expect(r.significant).toBe(false);
  });

  test("strong consistent positive returns are significant", () => {
    const r = probabilisticSharpeRatio(strongReturns(), 0, 365);
    expect(r.observedSharpe).toBeGreaterThan(0);
    expect(r.psr).toBeGreaterThan(0.95);
    expect(r.significant).toBe(true);
  });

  test("negative-mean returns have PSR below 0.5 and are not significant", () => {
    const r = probabilisticSharpeRatio(negativeReturns(), 0, 365);
    expect(r.observedSharpe).toBeLessThan(0);
    expect(r.psr).toBeLessThan(0.5);
    expect(r.significant).toBe(false);
  });

  test("PSR is monotonically decreasing in the benchmark Sharpe", () => {
    const returns = marginalReturns();
    const vsZero = probabilisticSharpeRatio(returns, 0, 365);
    const vsOne = probabilisticSharpeRatio(returns, 1, 365);
    const vsTwo = probabilisticSharpeRatio(returns, 2, 365);
    expect(vsZero.psr).toBeGreaterThan(vsOne.psr);
    expect(vsOne.psr).toBeGreaterThan(vsTwo.psr);
  });

  test("annualization scales the observed Sharpe by sqrt(periodsPerYear)", () => {
    const returns = marginalReturns();
    const daily = probabilisticSharpeRatio(returns, 0, 365);
    const weekly = probabilisticSharpeRatio(returns, 0, 52);
    expect(daily.observedSharpe / weekly.observedSharpe).toBeCloseTo(Math.sqrt(365 / 52), 6);
  });
});

describe("deflatedSharpeRatio", () => {
  test("returns neutral defaults below 10 observations", () => {
    const r = deflatedSharpeRatio([0.01, 0.02], 10);
    expect(r.dsr).toBe(0.5);
    expect(r.significant).toBe(false);
    expect(r.expectedMaxSharpeUnderNull).toBe(0);
  });

  test("constant returns (float-noise variance) yield neutral, non-significant DSR", () => {
    const r = deflatedSharpeRatio(new Array(50).fill(0.01), 10);
    expect(r.dsr).toBe(0.5);
    expect(r.observedSharpe).toBe(0);
    expect(r.significant).toBe(false);
  });

  test("with a single trial the null benchmark is zero and DSR equals PSR", () => {
    const returns = marginalReturns();
    const dsr = deflatedSharpeRatio(returns, 1, 365);
    const psr = probabilisticSharpeRatio(returns, 0, 365);
    expect(dsr.expectedMaxSharpeUnderNull).toBe(0);
    expect(dsr.dsr).toBeCloseTo(psr.psr, 10);
  });

  test("DSR decreases as the number of strategies tested grows", () => {
    const returns = marginalReturns();
    const one = deflatedSharpeRatio(returns, 1, 365);
    const ten = deflatedSharpeRatio(returns, 10, 365);
    const thousand = deflatedSharpeRatio(returns, 1000, 365);
    expect(one.dsr).toBeGreaterThan(ten.dsr);
    expect(ten.dsr).toBeGreaterThan(thousand.dsr);
  });

  test("expected max Sharpe under null grows with trial count", () => {
    const returns = marginalReturns();
    const ten = deflatedSharpeRatio(returns, 10, 365);
    const thousand = deflatedSharpeRatio(returns, 1000, 365);
    expect(ten.expectedMaxSharpeUnderNull).toBeGreaterThan(0);
    expect(thousand.expectedMaxSharpeUnderNull).toBeGreaterThan(ten.expectedMaxSharpeUnderNull);
  });

  test("a marginal edge passes PSR but fails DSR after 1000 trials", () => {
    const returns = marginalReturns();
    const psr = probabilisticSharpeRatio(returns, 0, 365);
    const dsr = deflatedSharpeRatio(returns, 1000, 365);
    expect(psr.significant).toBe(true);
    expect(dsr.significant).toBe(false);
  });
});

describe("minimumTrackRecordLength", () => {
  test("below 5 observations: minTRL is Infinity and insufficient", () => {
    const r = minimumTrackRecordLength([0.01, 0.02, 0.03, 0.04]);
    expect(r.minTRL).toBe(Infinity);
    expect(r.sufficient).toBe(false);
    expect(r.actualLength).toBe(4);
  });

  test("non-positive mean returns: Infinity (no Sharpe to defend)", () => {
    const r = minimumTrackRecordLength(negativeReturns(50));
    expect(r.minTRL).toBe(Infinity);
    expect(r.sufficient).toBe(false);
  });

  test("zero-variance returns: Infinity", () => {
    const r = minimumTrackRecordLength(new Array(50).fill(0.01));
    expect(r.minTRL).toBe(Infinity);
    expect(r.sufficient).toBe(false);
  });

  test("high per-period Sharpe needs only a short track record", () => {
    const r = minimumTrackRecordLength(strongReturns(100), 0.95, 365);
    expect(r.minTRL).toBeGreaterThanOrEqual(1);
    expect(r.minTRL).toBeLessThan(20);
    expect(r.sufficient).toBe(true);
  });

  test("marginal Sharpe (~0.15/period) needs ~(z/SR)^2 periods", () => {
    const r = minimumTrackRecordLength(marginalReturns(200), 0.95, 365);
    // SR ≈ 0.15 per period, z(0.95) ≈ 1.645 → 1 + (1.645/0.15)^2 ≈ 121
    expect(r.minTRL).toBeGreaterThan(100);
    expect(r.minTRL).toBeLessThan(140);
    expect(r.sufficient).toBe(true);
    expect(r.actualLength).toBe(200);
  });

  test("same marginal Sharpe with a short track record is insufficient", () => {
    const r = minimumTrackRecordLength(marginalReturns(60), 0.95, 365);
    expect(r.minTRL).toBeGreaterThan(60);
    expect(r.sufficient).toBe(false);
  });

  test("higher confidence level demands a longer track record", () => {
    const returns = marginalReturns(200);
    const at90 = minimumTrackRecordLength(returns, 0.9, 365);
    const at99 = minimumTrackRecordLength(returns, 0.99, 365);
    expect(at99.minTRL).toBeGreaterThan(at90.minTRL);
  });
});

describe("combinatorialPurgedCV", () => {
  test("insufficient data (<120 periods at 6 folds) reports overfit with zero folds", () => {
    const r = combinatorialPurgedCV(strongReturns(100));
    expect(r.folds).toBe(0);
    expect(r.pbo).toBe(1);
    expect(r.likelyOverfit).toBe(true);
    expect(r.summary).toContain("Insufficient data");
  });

  test("consistent positive returns survive every OOS fold", () => {
    const r = combinatorialPurgedCV(strongReturns(240));
    expect(r.folds).toBe(6);
    expect(r.oosSharpesPerFold).toHaveLength(6);
    expect(r.oosSharpesPerFold.every((s) => s > 0)).toBe(true);
    expect(r.pbo).toBe(0);
    expect(r.likelyOverfit).toBe(false);
    expect(r.meanOOSSharpe).toBeGreaterThan(0);
    expect(r.summary).toContain("CREDIBLE");
  });

  test("constant returns (float-noise variance) do not produce inflated fold Sharpes", () => {
    const r = combinatorialPurgedCV(new Array(240).fill(0.01));
    expect(r.oosSharpesPerFold.every((s) => s === 0)).toBe(true);
    expect(r.likelyOverfit).toBe(true);
  });

  test("pure noise (balanced alternating returns) is flagged as overfit", () => {
    const noise = Array.from({ length: 240 }, (_, i) => (i % 2 === 0 ? 0.01 : -0.01));
    const r = combinatorialPurgedCV(noise);
    expect(r.pbo).toBeGreaterThan(0.5);
    expect(r.likelyOverfit).toBe(true);
    expect(r.summary).toContain("LIKELY OVERFIT");
  });
});

describe("assessBacktestCredibility", () => {
  test("strong strategy with one trial is credible", () => {
    const r = assessBacktestCredibility(strongReturns(), 1, 365);
    expect(r.psrSignificant).toBe(true);
    expect(r.dsrSignificant).toBe(true);
    expect(r.sufficientTrackRecord).toBe(true);
    expect(r.credible).toBe(true);
    expect(r.summary).toContain("Statistically credible");
  });

  test("marginal edge mined from 1000 strategies is NOT credible (DSR gate)", () => {
    const r = assessBacktestCredibility(marginalReturns(), 1000, 365);
    expect(r.psrSignificant).toBe(true);
    expect(r.dsrSignificant).toBe(false);
    expect(r.credible).toBe(false);
    expect(r.summary).toContain("NOT credible");
  });

  test("negative strategy is not credible", () => {
    const r = assessBacktestCredibility(negativeReturns(), 1, 365);
    expect(r.credible).toBe(false);
    expect(r.observedSharpe).toBeLessThan(0);
  });

  test("result carries through the component metrics", () => {
    const returns = strongReturns();
    const r = assessBacktestCredibility(returns, 5, 365);
    const psr = probabilisticSharpeRatio(returns, 0, 365);
    const mtrl = minimumTrackRecordLength(returns, 0.95, 365);
    expect(r.psr).toBeCloseTo(psr.psr, 12);
    expect(r.observedSharpe).toBeCloseTo(psr.observedSharpe, 12);
    expect(r.minTrackRecordLength).toBe(mtrl.minTRL);
    expect(r.actualLength).toBe(returns.length);
  });
});
