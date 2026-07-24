import { describe, it, expect } from "bun:test";

import {
  evaluateCalibration,
  clampTierToCalibration,
  calibrationToPayload,
  type CalibrationTrade,
} from "./convictionCalibrationGate.ts";

function makeTrades(n: number, correlated: boolean, noiseScale = 0.3): CalibrationTrade[] {
  const out: CalibrationTrade[] = [];
  for (let i = 0; i < n; i++) {
    const conviction = 1 + (i % 5);
    const base = correlated ? conviction * 0.4 : 1.0;
    const noise = (Math.sin(i * 13.37) - 0.5) * noiseScale;
    out.push({ convictionRating: conviction, rMultiple: base + noise });
  }
  return out;
}

describe("evaluateCalibration — sample size gate", () => {
  it("insufficient_data when below minTrades", () => {
    const r = evaluateCalibration({ trades: makeTrades(50, true) });
    expect(r.status).toBe("insufficient_data");
    expect(r.allowsConvictionSizing).toBe(false);
    expect(r.tradesSeen).toBe(50);
    expect(r.reason).toContain("50/100");
  });

  it("respects custom minTrades", () => {
    const r = evaluateCalibration({ trades: makeTrades(40, true), minTrades: 30 });
    expect(r.status).not.toBe("insufficient_data");
  });

  it("default min is 100 per Wright Ch 9", () => {
    expect(evaluateCalibration({ trades: makeTrades(99, true) }).status).toBe(
      "insufficient_data",
    );
    expect(evaluateCalibration({ trades: makeTrades(100, true) }).status).not.toBe(
      "insufficient_data",
    );
  });
});

describe("evaluateCalibration — correlation gate", () => {
  it("calibrated when conviction strongly predicts realized R", () => {
    const r = evaluateCalibration({ trades: makeTrades(120, true, 0.1) });
    expect(r.status).toBe("calibrated");
    expect(r.allowsConvictionSizing).toBe(true);
    expect(r.pearsonR).toBeGreaterThan(0.3);
  });

  it("uncorrelated when conviction is noise", () => {
    const trades: CalibrationTrade[] = [];
    for (let i = 0; i < 120; i++) {
      trades.push({
        convictionRating: 1 + (i % 5),
        rMultiple: i % 2 === 0 ? 1.1 : -1.0,
      });
    }
    const r = evaluateCalibration({ trades });
    expect(r.allowsConvictionSizing).toBe(false);
    expect(r.status).toBe("uncorrelated");
  });

  it("negatively_correlated when high-conviction trades underperform", () => {
    const trades: CalibrationTrade[] = [];
    for (let i = 0; i < 120; i++) {
      const conviction = 1 + (i % 5);
      trades.push({ convictionRating: conviction, rMultiple: -conviction * 0.3 });
    }
    const r = evaluateCalibration({ trades });
    expect(r.status).toBe("negatively_correlated");
    expect(r.allowsConvictionSizing).toBe(false);
    expect(r.pearsonR).toBeLessThan(0);
    expect(r.reason).toContain("UNDERPERFORM");
  });

  it("respects custom minCorrelation threshold", () => {
    const trades = makeTrades(120, true, 1.5);
    const lax = evaluateCalibration({ trades, minCorrelation: 0.1 });
    const strict = evaluateCalibration({ trades, minCorrelation: 0.9 });
    expect(lax.status).toBe("calibrated");
    expect(strict.status).toBe("uncorrelated");
  });

  it("zero-variance input → uncorrelated, never calibrated", () => {
    const trades: CalibrationTrade[] = [];
    for (let i = 0; i < 120; i++) {
      trades.push({ convictionRating: 3, rMultiple: 1.0 });
    }
    const r = evaluateCalibration({ trades });
    expect(r.status).toBe("uncorrelated");
    expect(r.pearsonR).toBeNull();
  });
});

describe("clampTierToCalibration", () => {
  it("permits requested tier when calibrated", () => {
    const r = evaluateCalibration({ trades: makeTrades(120, true, 0.1) });
    expect(clampTierToCalibration("II", r)).toBe("II");
    expect(clampTierToCalibration("III", r)).toBe("III");
  });

  it("clamps to 'I' when not calibrated", () => {
    const r = evaluateCalibration({ trades: makeTrades(50, true) });
    expect(clampTierToCalibration("II", r)).toBe("I");
    expect(clampTierToCalibration("III", r)).toBe("I");
  });

  it("Type I always passes through unchanged", () => {
    const r = evaluateCalibration({ trades: makeTrades(50, true) });
    expect(clampTierToCalibration("I", r)).toBe("I");
  });
});

describe("calibrationToPayload", () => {
  it("emits stable shape", () => {
    const r = evaluateCalibration({ trades: makeTrades(120, true, 0.1) });
    const p = calibrationToPayload(r) as { kind: string; status: string };
    expect(p.kind).toBe("conviction_calibration.evaluated");
    expect(p.status).toBe("calibrated");
  });

  it("emits null pearsonR when correlation unavailable", () => {
    const r = evaluateCalibration({ trades: makeTrades(50, true) });
    const p = calibrationToPayload(r) as { pearsonR: number | null };
    expect(p.pearsonR).toBeNull();
  });
});

describe("Wright Ch 9 'Tier 1 operator' scenario", () => {
  it("new operator with 30 trades is forbidden from conviction sizing", () => {
    const r = evaluateCalibration({ trades: makeTrades(30, true) });
    expect(r.allowsConvictionSizing).toBe(false);
    expect(clampTierToCalibration("III", r)).toBe("I");
  });

  it("100+ trades with proven correlation graduates to conviction sizing", () => {
    const r = evaluateCalibration({ trades: makeTrades(150, true, 0.1) });
    expect(r.allowsConvictionSizing).toBe(true);
  });
});
