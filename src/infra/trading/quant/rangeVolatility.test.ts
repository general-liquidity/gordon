import { describe, it, expect } from "bun:test";

import {
  isRangeVolatilityEnabled,
  computeRangeVolatility,
  rangeVolatilityToPayload,
  RANGE_VOLATILITY_FLAG_ENV,
  type OhlcBar,
} from "./rangeVolatility.ts";

describe("isRangeVolatilityEnabled", () => {
  it("respects the flag", () => {
    expect(isRangeVolatilityEnabled({})).toBe(false);
    expect(isRangeVolatilityEnabled({ [RANGE_VOLATILITY_FLAG_ENV]: "1" })).toBe(true);
  });
});

function makeBar(open: number, high: number, low: number, close: number): OhlcBar {
  return { open, high, low, close };
}

function gbmBars(
  n: number,
  sigmaAnn: number,
  ppy: number,
  seed = 1,
): OhlcBar[] {
  // Deterministic LCG so the test is reproducible.
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0xffffffff;
  };
  const stdNormal = () => {
    const u1 = Math.max(rand(), 1e-12);
    const u2 = rand();
    return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
  const sigmaPer = sigmaAnn / Math.sqrt(ppy);
  const bars: OhlcBar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    const open = price;
    const subSteps = 20;
    const stepSigma = sigmaPer / Math.sqrt(subSteps);
    let curr = open;
    let high = open;
    let low = open;
    for (let k = 0; k < subSteps; k++) {
      curr *= Math.exp(stdNormal() * stepSigma);
      if (curr > high) high = curr;
      if (curr < low) low = curr;
    }
    const close = curr;
    bars.push({ open, high, low, close });
    price = close;
  }
  return bars;
}

describe("computeRangeVolatility — empty + degenerate", () => {
  it("empty bar list → zero estimates", () => {
    const r = computeRangeVolatility({ bars: [] });
    expect(r.sampleSize).toBe(0);
    expect(r.parkinsonAnnualized).toBe(0);
    expect(r.garmanKlassAnnualized).toBe(0);
  });

  it("skips bars with non-positive prices or inverted H/L", () => {
    const bars = [
      makeBar(100, 101, 99, 100),
      makeBar(100, 0, -1, 100), // invalid
      makeBar(100, 99, 101, 100), // invalid (H < L)
      makeBar(100, 102, 99.5, 101),
    ];
    const r = computeRangeVolatility({ bars });
    expect(r.sampleSize).toBe(2);
  });
});

describe("computeRangeVolatility — recovers known vol", () => {
  it("simulated 30% annual GBM ~ recovered within 30%", () => {
    const trueSigma = 0.3;
    const ppy = 365;
    const bars = gbmBars(500, trueSigma, ppy, 42);
    const r = computeRangeVolatility({ bars, periodsPerYear: ppy });
    expect(r.parkinsonAnnualized).toBeGreaterThan(trueSigma * 0.7);
    expect(r.parkinsonAnnualized).toBeLessThan(trueSigma * 1.3);
    expect(r.garmanKlassAnnualized).toBeGreaterThan(trueSigma * 0.7);
    expect(r.garmanKlassAnnualized).toBeLessThan(trueSigma * 1.3);
  });

  it("higher vol → higher estimates", () => {
    const ppy = 365;
    const lowVolBars = gbmBars(500, 0.15, ppy, 7);
    const highVolBars = gbmBars(500, 0.60, ppy, 7);
    const lowR = computeRangeVolatility({ bars: lowVolBars, periodsPerYear: ppy });
    const highR = computeRangeVolatility({ bars: highVolBars, periodsPerYear: ppy });
    expect(highR.parkinsonAnnualized).toBeGreaterThan(lowR.parkinsonAnnualized * 2);
    expect(highR.garmanKlassAnnualized).toBeGreaterThan(lowR.garmanKlassAnnualized * 2);
  });
});

describe("computeRangeVolatility — efficiency gain", () => {
  it("GK reports an efficiency gain > 1 vs close-to-close on noisy bars", () => {
    const ppy = 252;
    const bars = gbmBars(200, 0.4, ppy, 3);
    const r = computeRangeVolatility({ bars, periodsPerYear: ppy });
    expect(r.efficiencyGain).toBeGreaterThan(1);
  });
});

describe("computeRangeVolatility — annualization scales correctly", () => {
  it("doubling periodsPerYear multiplies annualized vol by sqrt(2)", () => {
    const bars = gbmBars(200, 0.3, 365, 9);
    const r1 = computeRangeVolatility({ bars, periodsPerYear: 365 });
    const r2 = computeRangeVolatility({ bars, periodsPerYear: 730 });
    const ratio = r2.parkinsonAnnualized / r1.parkinsonAnnualized;
    expect(ratio).toBeCloseTo(Math.sqrt(2), 2);
  });
});

describe("computeRangeVolatility — small sample reasoning", () => {
  it("flags small samples", () => {
    const bars = [makeBar(100, 101, 99, 100), makeBar(100, 102, 99.5, 101)];
    const r = computeRangeVolatility({ bars });
    expect(r.reasoning).toContain("small sample");
  });
});

describe("rangeVolatilityToPayload", () => {
  it("emits stable shape", () => {
    const bars = gbmBars(60, 0.3, 365, 11);
    const r = computeRangeVolatility({ bars });
    const p = rangeVolatilityToPayload(r) as { kind: string; parkinson: number };
    expect(p.kind).toBe("range_volatility.computed");
    expect(typeof p.parkinson).toBe("number");
  });

  it("emits null for closeToClose / efficiency on empty input", () => {
    const r = computeRangeVolatility({ bars: [] });
    const p = rangeVolatilityToPayload(r) as {
      closeToClose: number | null;
      efficiencyGain: number | null;
    };
    expect(p.closeToClose).toBeNull();
    expect(p.efficiencyGain).toBeNull();
  });
});
