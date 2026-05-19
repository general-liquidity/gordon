import { describe, it, expect } from "bun:test";
import {
  computeOptimalPairsTrading,
  optimalPairsTradingToPayload,
  isOptimalPairsTradingEnabled,
  OPTIMAL_PAIRS_TRADING_FLAG_ENV,
} from "./optimalPairsTrading.ts";

describe("isOptimalPairsTradingEnabled", () => {
  it("respects the flag", () => {
    expect(isOptimalPairsTradingEnabled({})).toBe(false);
    expect(
      isOptimalPairsTradingEnabled({ [OPTIMAL_PAIRS_TRADING_FLAG_ENV]: "1" }),
    ).toBe(true);
  });
});

describe("computeOptimalPairsTrading — validation", () => {
  const base = {
    currentSpread: 1,
    equilibriumSpread: 0,
    meanReversionRate: 0.5,
    spreadVolatility: 0.2,
    currentInventory: 0,
    impactCoef: 0.01,
  };

  it("rejects non-positive mean reversion rate", () => {
    expect(() => computeOptimalPairsTrading({ ...base, meanReversionRate: 0 })).toThrow();
  });

  it("rejects non-positive volatility", () => {
    expect(() => computeOptimalPairsTrading({ ...base, spreadVolatility: 0 })).toThrow();
  });

  it("rejects non-positive impact coef", () => {
    expect(() => computeOptimalPairsTrading({ ...base, impactCoef: 0 })).toThrow();
  });

  it("rejects negative risk aversion", () => {
    expect(() => computeOptimalPairsTrading({ ...base, riskAversion: -1 })).toThrow();
  });
});

describe("computeOptimalPairsTrading — equilibrium + zero inventory", () => {
  it("X=μ, q=0 → ν*=0", () => {
    const r = computeOptimalPairsTrading({
      currentSpread: 5,
      equilibriumSpread: 5,
      meanReversionRate: 0.5,
      spreadVolatility: 0.2,
      currentInventory: 0,
      impactCoef: 0.01,
    });
    expect(r.tradingSpeed).toBeCloseTo(0, 6);
    expect(r.inventoryContribution).toBeCloseTo(0, 6);
    expect(r.spreadContribution).toBeCloseTo(0, 6);
  });
});

describe("computeOptimalPairsTrading — spread response", () => {
  const base = {
    equilibriumSpread: 0,
    meanReversionRate: 0.5,
    spreadVolatility: 0.2,
    currentInventory: 0,
    impactCoef: 0.01,
  };

  it("X > μ, q=0 → SELL spread (ν*<0)", () => {
    const r = computeOptimalPairsTrading({ ...base, currentSpread: 2 });
    expect(r.tradingSpeed).toBeLessThan(0);
    expect(r.spreadContribution).toBeLessThan(0);
  });

  it("X < μ, q=0 → BUY spread (ν*>0)", () => {
    const r = computeOptimalPairsTrading({ ...base, currentSpread: -2 });
    expect(r.tradingSpeed).toBeGreaterThan(0);
    expect(r.spreadContribution).toBeGreaterThan(0);
  });

  it("larger deviation → larger response (linear in deviation)", () => {
    const small = computeOptimalPairsTrading({ ...base, currentSpread: 1 });
    const large = computeOptimalPairsTrading({ ...base, currentSpread: 3 });
    expect(Math.abs(large.spreadContribution)).toBeGreaterThan(Math.abs(small.spreadContribution));
    expect(large.spreadContribution / small.spreadContribution).toBeCloseTo(3, 4);
  });
});

describe("computeOptimalPairsTrading — inventory reversion", () => {
  const base = {
    currentSpread: 0,
    equilibriumSpread: 0,
    meanReversionRate: 0.5,
    spreadVolatility: 0.2,
    impactCoef: 0.01,
  };

  it("q > 0 at equilibrium → unwinds (ν*<0)", () => {
    const r = computeOptimalPairsTrading({ ...base, currentInventory: 100 });
    expect(r.tradingSpeed).toBeLessThan(0);
    expect(r.inventoryContribution).toBeLessThan(0);
  });

  it("q < 0 at equilibrium → unwinds short (ν*>0)", () => {
    const r = computeOptimalPairsTrading({ ...base, currentInventory: -100 });
    expect(r.tradingSpeed).toBeGreaterThan(0);
    expect(r.inventoryContribution).toBeGreaterThan(0);
  });

  it("inventory half-life is positive and finite", () => {
    const r = computeOptimalPairsTrading({ ...base, currentInventory: 100 });
    expect(Number.isFinite(r.inventoryHalfLife)).toBe(true);
    expect(r.inventoryHalfLife).toBeGreaterThan(0);
  });
});

describe("computeOptimalPairsTrading — parameter sensitivity", () => {
  const base = {
    currentSpread: 1,
    equilibriumSpread: 0,
    spreadVolatility: 0.2,
    currentInventory: 0,
    impactCoef: 0.01,
  };

  it("higher mean-reversion θ → larger response coefficient B", () => {
    const slow = computeOptimalPairsTrading({ ...base, meanReversionRate: 0.1 });
    const fast = computeOptimalPairsTrading({ ...base, meanReversionRate: 2 });
    expect(fast.spreadCoef).toBeGreaterThan(slow.spreadCoef);
  });

  // NOTE: parameter sensitivity in k is non-monotonic in the naive direction.
  // The closed-form A·k = (-θk + √(θ²k² + 4γσ²k)) / 2 makes both A and B
  // depend on k through coupled limits (k→0: A→0, B→0; k→∞: A→γσ²/θ, B→1).
  // The clean directional tests are on θ and γ (below), not on k.

  it("higher risk aversion γ → faster inventory reversion (larger A)", () => {
    const base2 = {
      currentSpread: 0,
      equilibriumSpread: 0,
      meanReversionRate: 0.5,
      spreadVolatility: 0.2,
      currentInventory: 100,
      impactCoef: 0.01,
    };
    const low = computeOptimalPairsTrading({ ...base2, riskAversion: 0.001 });
    const high = computeOptimalPairsTrading({ ...base2, riskAversion: 1 });
    expect(high.inventoryCoef).toBeGreaterThan(low.inventoryCoef);
  });
});

describe("optimalPairsTradingToPayload", () => {
  it("emits stable shape", () => {
    const r = computeOptimalPairsTrading({
      currentSpread: 1,
      equilibriumSpread: 0,
      meanReversionRate: 0.5,
      spreadVolatility: 0.2,
      currentInventory: 50,
      impactCoef: 0.01,
    });
    const p = optimalPairsTradingToPayload(r) as {
      kind: string;
      tradingSpeed: number;
      inventoryHalfLife: number;
    };
    expect(p.kind).toBe("optimal_pairs_trading.computed");
    expect(Number.isFinite(p.tradingSpeed)).toBe(true);
  });
});
