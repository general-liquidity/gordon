import { describe, expect, test } from "bun:test";
import { computePriceImpliedExpectations } from "./priceImpliedExpectations.ts";
import { computeDcf } from "./dcf.ts";

/** Build a forward DCF, take its EV, then run PIE backwards. We
 *  should recover the input parameters within tolerance. */
function dcfEvForRoundtrip(
  baseFcf: number,
  growthRate: number,
  horizonYears: number,
  wacc: number,
  terminalGrowthPct: number,
): number {
  // Use compute_dcf as the canonical forward calculation. We use a
  // shares=1 / netCash=0 convention so EV == equityValue == priceShare.
  const fcfProjections: number[] = [];
  for (let t = 1; t <= horizonYears; t++) {
    fcfProjections.push(baseFcf * Math.pow(1 + growthRate, t));
  }
  const r = computeDcf({
    fcfProjections,
    netCash: 0,
    sharesOutstanding: 1,
    base: { wacc, terminalGrowthPct },
  });
  return r.base.enterpriseValue;
}

describe("PIE — solve for growth rate", () => {
  test("roundtrips against forward DCF (5y horizon, 10% growth)", () => {
    const baseFcf = 100;
    const wacc = 0.1;
    const terminalGrowthPct = 0.025;
    const horizonYears = 5;
    const growthRate = 0.1;
    const ev = dcfEvForRoundtrip(baseFcf, growthRate, horizonYears, wacc, terminalGrowthPct);

    const pie = computePriceImpliedExpectations({
      enterpriseValue: ev,
      baseFcf,
      wacc,
      terminalGrowthPct,
      horizonYears,
      solveFor: "growth_rate",
    });
    expect(pie.converged).toBe(true);
    expect(pie.solvedValue).toBeCloseTo(growthRate, 3);
  });

  test("higher EV implies higher growth", () => {
    const baseFcf = 100;
    const wacc = 0.09;
    const terminalGrowthPct = 0.025;
    const horizonYears = 7;

    const low = computePriceImpliedExpectations({
      enterpriseValue: 2000,
      baseFcf, wacc, terminalGrowthPct, horizonYears,
      solveFor: "growth_rate",
    });
    const high = computePriceImpliedExpectations({
      enterpriseValue: 3500,
      baseFcf, wacc, terminalGrowthPct, horizonYears,
      solveFor: "growth_rate",
    });
    expect(high.solvedValue).toBeGreaterThan(low.solvedValue);
  });

  test("reports non-converged when EV is outside [-50%, +50%] growth band", () => {
    const r = computePriceImpliedExpectations({
      enterpriseValue: 1e12,
      baseFcf: 100,
      wacc: 0.1,
      terminalGrowthPct: 0.025,
      horizonYears: 5,
      solveFor: "growth_rate",
    });
    expect(r.converged).toBe(false);
    expect(r.interpretation).toContain("outside");
  });

  test("reports decelerating-fundamentals interpretation when implied growth < terminal", () => {
    const baseFcf = 100;
    const wacc = 0.1;
    const terminalGrowthPct = 0.04;
    const horizonYears = 5;
    // EV that corresponds to zero growth, well below the 4% terminal.
    const ev = dcfEvForRoundtrip(baseFcf, 0, horizonYears, wacc, terminalGrowthPct);
    const r = computePriceImpliedExpectations({
      enterpriseValue: ev,
      baseFcf, wacc, terminalGrowthPct, horizonYears,
      solveFor: "growth_rate",
    });
    expect(r.converged).toBe(true);
    expect(r.solvedValue).toBeLessThan(terminalGrowthPct);
    expect(r.interpretation).toContain("decelerating");
  });
});

describe("PIE — solve for competitive advantage period (CAP)", () => {
  test("longer CAP → higher EV", () => {
    const baseFcf = 100;
    const wacc = 0.1;
    const terminalGrowthPct = 0.025;
    const growthRate = 0.15;

    const ev5 = dcfEvForRoundtrip(baseFcf, growthRate, 5, wacc, terminalGrowthPct);
    const ev15 = dcfEvForRoundtrip(baseFcf, growthRate, 15, wacc, terminalGrowthPct);
    expect(ev15).toBeGreaterThan(ev5);

    const pie5 = computePriceImpliedExpectations({
      enterpriseValue: ev5, baseFcf, wacc, terminalGrowthPct,
      growthRate, solveFor: "competitive_advantage",
    });
    const pie15 = computePriceImpliedExpectations({
      enterpriseValue: ev15, baseFcf, wacc, terminalGrowthPct,
      growthRate, solveFor: "competitive_advantage",
    });
    expect(pie5.converged).toBe(true);
    expect(pie15.converged).toBe(true);
    expect(pie15.solvedValue).toBeGreaterThan(pie5.solvedValue);
  });

  test("refuses to solve when growth <= terminal (no supranormal period)", () => {
    const r = computePriceImpliedExpectations({
      enterpriseValue: 1500,
      baseFcf: 100,
      wacc: 0.1,
      terminalGrowthPct: 0.03,
      growthRate: 0.03,
      solveFor: "competitive_advantage",
    });
    expect(r.converged).toBe(false);
    expect(r.interpretation).toContain("supranormal");
  });
});

describe("PIE — solve for WACC", () => {
  test("higher implied EV → lower implied WACC", () => {
    const baseFcf = 100;
    const terminalGrowthPct = 0.025;
    const horizonYears = 7;
    const growthRate = 0.1;

    const evLowWacc = dcfEvForRoundtrip(baseFcf, growthRate, horizonYears, 0.08, terminalGrowthPct);
    const evHighWacc = dcfEvForRoundtrip(baseFcf, growthRate, horizonYears, 0.12, terminalGrowthPct);

    const pieLowEv = computePriceImpliedExpectations({
      enterpriseValue: evHighWacc, // lower EV
      baseFcf, terminalGrowthPct, horizonYears, growthRate,
      solveFor: "wacc",
    });
    const pieHighEv = computePriceImpliedExpectations({
      enterpriseValue: evLowWacc, // higher EV
      baseFcf, terminalGrowthPct, horizonYears, growthRate,
      solveFor: "wacc",
    });
    expect(pieLowEv.converged).toBe(true);
    expect(pieHighEv.converged).toBe(true);
    expect(pieHighEv.solvedValue).toBeLessThan(pieLowEv.solvedValue);
  });

  test("roundtrips against a forward DCF", () => {
    const baseFcf = 100;
    const wacc = 0.085;
    const terminalGrowthPct = 0.025;
    const horizonYears = 5;
    const growthRate = 0.1;
    const ev = dcfEvForRoundtrip(baseFcf, growthRate, horizonYears, wacc, terminalGrowthPct);

    const r = computePriceImpliedExpectations({
      enterpriseValue: ev,
      baseFcf, terminalGrowthPct, horizonYears, growthRate,
      solveFor: "wacc",
    });
    expect(r.converged).toBe(true);
    expect(r.solvedValue).toBeCloseTo(wacc, 3);
  });
});

describe("PIE — error handling", () => {
  test("throws on non-positive EV", () => {
    expect(() =>
      computePriceImpliedExpectations({
        enterpriseValue: 0,
        baseFcf: 100,
        wacc: 0.1,
        terminalGrowthPct: 0.025,
        horizonYears: 5,
        solveFor: "growth_rate",
      }),
    ).toThrow(/enterpriseValue/);
  });

  test("throws on non-positive baseFcf", () => {
    expect(() =>
      computePriceImpliedExpectations({
        enterpriseValue: 1000,
        baseFcf: -50,
        wacc: 0.1,
        terminalGrowthPct: 0.025,
        horizonYears: 5,
        solveFor: "growth_rate",
      }),
    ).toThrow(/baseFcf/);
  });

  test("growth_rate mode throws without wacc", () => {
    expect(() =>
      computePriceImpliedExpectations({
        enterpriseValue: 1000,
        baseFcf: 100,
        terminalGrowthPct: 0.025,
        horizonYears: 5,
        solveFor: "growth_rate",
      }),
    ).toThrow(/wacc/);
  });

  test("growth_rate mode throws when wacc <= terminal", () => {
    expect(() =>
      computePriceImpliedExpectations({
        enterpriseValue: 1000,
        baseFcf: 100,
        wacc: 0.025,
        terminalGrowthPct: 0.025,
        horizonYears: 5,
        solveFor: "growth_rate",
      }),
    ).toThrow(/terminal/);
  });

  test("CAP mode throws without growthRate", () => {
    expect(() =>
      computePriceImpliedExpectations({
        enterpriseValue: 1000,
        baseFcf: 100,
        wacc: 0.1,
        terminalGrowthPct: 0.025,
        solveFor: "competitive_advantage",
      }),
    ).toThrow(/growthRate/);
  });
});

describe("PIE — residual error reporting", () => {
  test("converged result has residualError below tolerance", () => {
    const baseFcf = 100;
    const wacc = 0.1;
    const terminalGrowthPct = 0.025;
    const horizonYears = 5;
    const growthRate = 0.1;
    const ev = dcfEvForRoundtrip(baseFcf, growthRate, horizonYears, wacc, terminalGrowthPct);
    const r = computePriceImpliedExpectations({
      enterpriseValue: ev,
      baseFcf, wacc, terminalGrowthPct, horizonYears,
      solveFor: "growth_rate",
    });
    expect(r.residualError).toBeLessThan(1);
  });
});
