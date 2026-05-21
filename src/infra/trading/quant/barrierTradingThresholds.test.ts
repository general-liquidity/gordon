import { describe, it, expect } from "bun:test";
import {
  isBarrierTradingThresholdsEnabled,
  computeBarrierTradingThresholds,
  barrierTradingThresholdsToPayload,
  BARRIER_TRADING_THRESHOLDS_FLAG_ENV,
} from "./barrierTradingThresholds.ts";

describe("isBarrierTradingThresholdsEnabled", () => {
  it("respects the flag", () => {
    expect(isBarrierTradingThresholdsEnabled({})).toBe(false);
    expect(
      isBarrierTradingThresholdsEnabled({ [BARRIER_TRADING_THRESHOLDS_FLAG_ENV]: "1" }),
    ).toBe(true);
  });
});

describe("computeBarrierTradingThresholds — formulae", () => {
  it("zero cost: entry = exit = ζ × σ", () => {
    const r = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0,
    });
    expect(r.entryBarrier).toBeCloseTo(0.6, 9);
    expect(r.exitBarrier).toBeCloseTo(0.6, 9);
  });

  it("barriers are 2κ apart", () => {
    const r = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0.1,
    });
    expect(r.entryBarrier - r.exitBarrier).toBeCloseTo(0.2, 9);
  });

  it("large cost: exit barrier goes negative (hysteresis)", () => {
    const r = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0.8,
    });
    expect(r.exitBarrier).toBeLessThan(0);
    expect(r.hysteresisDominant).toBe(true);
  });

  it("custom zeta is applied", () => {
    const r = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0,
      zeta: 1.0,
    });
    expect(r.entryBarrier).toBeCloseTo(1.0, 9);
  });

  it("standardised barriers use σ_α as unit", () => {
    const r = computeBarrierTradingThresholds({
      alphaStdDev: 2,
      transactionCost: 0.4,
    });
    expect(r.entryBarrierStandardised).toBeCloseTo(0.6 + 0.4 / 2, 9);
    expect(r.transactionCostStandardised).toBeCloseTo(0.2, 9);
  });
});

describe("computeBarrierTradingThresholds — breadth", () => {
  it("higher cost (hence higher barrier) → lower breadth", () => {
    const small = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0,
    });
    const large = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 1.0,
    });
    expect(large.expectedBreadthPerYear).toBeLessThan(small.expectedBreadthPerYear);
  });

  it("normal vs laplace produce distinct breadth at same barrier", () => {
    const normal = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0,
      alphaDistribution: "normal",
    });
    const laplace = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0,
      alphaDistribution: "laplace",
    });
    expect(
      Math.abs(normal.expectedBreadthPerYear - laplace.expectedBreadthPerYear),
    ).toBeGreaterThan(1);
  });

  it("breadth scales linearly with periodsPerYear", () => {
    const daily = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0,
      periodsPerYear: 252,
    });
    const hourly = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0,
      periodsPerYear: 252 * 24,
    });
    expect(hourly.expectedBreadthPerYear / daily.expectedBreadthPerYear).toBeCloseTo(
      24,
      6,
    );
  });
});

describe("computeBarrierTradingThresholds — validation", () => {
  it("throws on non-positive sigma", () => {
    expect(() =>
      computeBarrierTradingThresholds({ alphaStdDev: 0, transactionCost: 0.1 }),
    ).toThrow();
  });

  it("throws on negative cost", () => {
    expect(() =>
      computeBarrierTradingThresholds({ alphaStdDev: 1, transactionCost: -0.01 }),
    ).toThrow();
  });
});

describe("barrierTradingThresholdsToPayload", () => {
  it("emits stable shape", () => {
    const r = computeBarrierTradingThresholds({
      alphaStdDev: 1,
      transactionCost: 0.1,
    });
    const p = barrierTradingThresholdsToPayload(r) as { kind: string };
    expect(p.kind).toBe("barrier_trading_thresholds.computed");
  });
});
