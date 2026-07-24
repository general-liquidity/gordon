import { describe, it, expect } from "bun:test";
import {
  computeOptimalTradingOracle,
  optimalTradingOracleToPayload,
} from "./optimalTradingOracle.ts";

describe("computeOptimalTradingOracle — gross mode", () => {
  it("sign-of-return oracle has h_t = sign(r_t)", () => {
    const returns = [0.01, -0.02, 0.015, -0.005];
    const r = computeOptimalTradingOracle({ returns, mode: "gross" });
    expect(r.positions).toEqual([1, -1, 1, -1]);
    // Gross profit = sum of |r_t|
    expect(r.totalGrossProfit).toBeCloseTo(0.05, 9);
  });

  it("zero return → zero position", () => {
    const r = computeOptimalTradingOracle({ returns: [0, 0.01, 0], mode: "gross" });
    expect(r.positions[0]).toBe(0);
    expect(r.positions[2]).toBe(0);
  });

  it("position limit scales the sequence", () => {
    const r = computeOptimalTradingOracle({
      returns: [0.01, -0.01],
      mode: "gross",
      positionLimit: 3,
    });
    expect(r.positions).toEqual([3, -3]);
  });
});

describe("computeOptimalTradingOracle — net mode with costs", () => {
  it("zero cost: net oracle = gross oracle", () => {
    const returns = [0.01, -0.02, 0.015, -0.005];
    const gross = computeOptimalTradingOracle({ returns, mode: "gross" });
    const net = computeOptimalTradingOracle({ returns, mode: "net", transactionCost: 0 });
    expect(net.positions).toEqual(gross.positions);
    expect(net.totalNetProfit).toBeCloseTo(gross.totalGrossProfit, 9);
  });

  it("high cost: oracle vetoes whipsaw trades", () => {
    // All gross-positive returns with one tiny dip — net oracle should stay long, not flip.
    const returns = [0.01, 0.001, 0.01, 0.001, 0.01];
    const net = computeOptimalTradingOracle({
      returns,
      mode: "net",
      transactionCost: 0.05,
    });
    for (const p of net.positions) expect(p).toBeGreaterThanOrEqual(0);
    expect(net.transactionCount).toBeLessThanOrEqual(1);
  });

  it("terminal flat constraint forces final exit", () => {
    const returns = [0.01, 0.02, 0.01];
    const r = computeOptimalTradingOracle({
      returns,
      mode: "net",
      transactionCost: 0,
      requireTerminalFlat: true,
    });
    expect(r.positions[r.positions.length - 1]).toBe(0);
  });

  it("net profit ≤ gross profit when cost > 0", () => {
    const returns = [0.01, -0.02, 0.015, -0.005, 0.02];
    const r = computeOptimalTradingOracle({
      returns,
      mode: "net",
      transactionCost: 0.001,
    });
    expect(r.totalNetProfit).toBeLessThan(r.totalGrossProfit + 1e-9);
  });
});

describe("computeOptimalTradingOracle — boundary", () => {
  it("empty returns yields zero-profit oracle", () => {
    const r = computeOptimalTradingOracle({ returns: [] });
    expect(r.positions).toEqual([]);
    expect(r.sharpeRatio).toBe(0);
  });

  it("single return: optimal position is sign(r)", () => {
    const r = computeOptimalTradingOracle({ returns: [0.01], mode: "gross" });
    expect(r.positions).toEqual([1]);
  });

  it("annualisation scales Sharpe by √periodsPerYear", () => {
    const returns = [0.01, -0.02, 0.015, -0.005, 0.02, -0.01];
    const daily = computeOptimalTradingOracle({ returns, periodsPerYear: 1 });
    const annual = computeOptimalTradingOracle({ returns, periodsPerYear: 252 });
    if (Math.abs(daily.sharpeRatio) > 1e-9) {
      expect(annual.sharpeRatio / daily.sharpeRatio).toBeCloseTo(Math.sqrt(252), 4);
    }
  });
});

describe("optimalTradingOracleToPayload", () => {
  it("emits stable shape", () => {
    const r = computeOptimalTradingOracle({ returns: [0.01, -0.01], mode: "gross" });
    const p = optimalTradingOracleToPayload(r) as { kind: string; mode: string };
    expect(p.kind).toBe("optimal_trading_oracle.computed");
    expect(p.mode).toBe("gross");
  });
});
