import { describe, it, expect } from "bun:test";
import {
  computePairsEligibilityFilter,
  pairsEligibilityFilterToPayload,
  DEFAULT_THRESHOLDS,
} from "./pairsEligibilityFilter.ts";

describe("computePairsEligibilityFilter — eligible path", () => {
  it("all four conditions pass → eligible", () => {
    const r = computePairsEligibilityFilter({
      cointegrationPValue: 0.005,
      hurstExponent: 0.3,
      halfLifePeriods: 30,
      meanCrossingsPerYear: 24,
    });
    expect(r.eligible).toBe(true);
    expect(r.failureReasons).toEqual([]);
  });

  it("verdict structure includes all four conditions", () => {
    const r = computePairsEligibilityFilter({
      cointegrationPValue: 0.005,
      hurstExponent: 0.3,
      halfLifePeriods: 30,
      meanCrossingsPerYear: 24,
    });
    expect(r.conditions.cointegration.passed).toBe(true);
    expect(r.conditions.hurst.passed).toBe(true);
    expect(r.conditions.halfLife.passed).toBe(true);
    expect(r.conditions.meanCrossings.passed).toBe(true);
  });
});

describe("computePairsEligibilityFilter — single-condition failures", () => {
  const baseline = {
    cointegrationPValue: 0.005,
    hurstExponent: 0.3,
    halfLifePeriods: 30,
    meanCrossingsPerYear: 24,
  };

  it("p-value at threshold (not strict) → fails", () => {
    const r = computePairsEligibilityFilter({
      ...baseline,
      cointegrationPValue: 0.01,
    });
    expect(r.eligible).toBe(false);
    expect(r.conditions.cointegration.passed).toBe(false);
  });

  it("Hurst exponent ≥ 0.5 → fails (no mean-reversion)", () => {
    const r = computePairsEligibilityFilter({
      ...baseline,
      hurstExponent: 0.55,
    });
    expect(r.eligible).toBe(false);
    expect(r.conditions.hurst.passed).toBe(false);
  });

  it("half-life too short (< 1) → fails", () => {
    const r = computePairsEligibilityFilter({
      ...baseline,
      halfLifePeriods: 0.5,
    });
    expect(r.eligible).toBe(false);
    expect(r.conditions.halfLife.passed).toBe(false);
  });

  it("half-life too long (> 252) → fails", () => {
    const r = computePairsEligibilityFilter({
      ...baseline,
      halfLifePeriods: 400,
    });
    expect(r.eligible).toBe(false);
    expect(r.conditions.halfLife.passed).toBe(false);
  });

  it("mean-crossings < 12/year → fails", () => {
    const r = computePairsEligibilityFilter({
      ...baseline,
      meanCrossingsPerYear: 6,
    });
    expect(r.eligible).toBe(false);
    expect(r.conditions.meanCrossings.passed).toBe(false);
  });
});

describe("computePairsEligibilityFilter — multi-condition failures", () => {
  it("multiple failures listed in failureReasons", () => {
    const r = computePairsEligibilityFilter({
      cointegrationPValue: 0.5,
      hurstExponent: 0.8,
      halfLifePeriods: 500,
      meanCrossingsPerYear: 2,
    });
    expect(r.eligible).toBe(false);
    expect(r.failureReasons.length).toBe(4);
  });
});

describe("computePairsEligibilityFilter — threshold overrides", () => {
  it("lenient thresholds make a marginal pair eligible", () => {
    const marginal = {
      cointegrationPValue: 0.05,
      hurstExponent: 0.55,
      halfLifePeriods: 350,
      meanCrossingsPerYear: 8,
    };
    const strict = computePairsEligibilityFilter(marginal);
    const lenient = computePairsEligibilityFilter({
      ...marginal,
      thresholds: {
        maxPValue: 0.1,
        maxHurst: 0.6,
        maxHalfLife: 365,
        minMeanCrossingsPerYear: 4,
      },
    });
    expect(strict.eligible).toBe(false);
    expect(lenient.eligible).toBe(true);
  });

  it("DEFAULT_THRESHOLDS match Sarmento Ch 3.5", () => {
    expect(DEFAULT_THRESHOLDS.maxPValue).toBe(0.01);
    expect(DEFAULT_THRESHOLDS.maxHurst).toBe(0.5);
    expect(DEFAULT_THRESHOLDS.minHalfLife).toBe(1);
    expect(DEFAULT_THRESHOLDS.maxHalfLife).toBe(252);
    expect(DEFAULT_THRESHOLDS.minMeanCrossingsPerYear).toBe(12);
  });
});

describe("pairsEligibilityFilterToPayload", () => {
  it("emits stable shape", () => {
    const r = computePairsEligibilityFilter({
      cointegrationPValue: 0.005,
      hurstExponent: 0.3,
      halfLifePeriods: 30,
      meanCrossingsPerYear: 24,
    });
    const p = pairsEligibilityFilterToPayload(r) as { kind: string };
    expect(p.kind).toBe("pairs_eligibility_filter.computed");
  });
});
