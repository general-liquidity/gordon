import { describe, expect, test } from "bun:test";
import { computePortfolioCombine } from "./portfolioCombine.ts";

/** Equity curve from a per-bar return series. */
function curveFromReturns(returns: number[], start = 1): number[] {
  const out = [start];
  for (const r of returns) out.push(out[out.length - 1]! * (1 + r));
  return out;
}

describe("computePortfolioCombine — basic mechanics", () => {
  test("two flat strategies produce a flat combined", () => {
    const flat = [1, 1, 1, 1, 1];
    const r = computePortfolioCombine({
      equityCurves: [flat, flat],
    });
    expect(r.finalEquity).toBeCloseTo(1, 5);
    expect(r.rebalancingPremium).toBeCloseTo(0, 5);
  });

  test("two identical curves combine to the same curve", () => {
    const up = curveFromReturns([0.01, 0.01, 0.01, 0.01]);
    const r = computePortfolioCombine({
      equityCurves: [up, up],
    });
    expect(r.finalEquity).toBeCloseTo(up[up.length - 1]!, 5);
  });

  test("equal-weight is the default", () => {
    const a = curveFromReturns([0.02, -0.01, 0.02, -0.01]);
    const b = curveFromReturns([-0.01, 0.02, -0.01, 0.02]);
    const r = computePortfolioCombine({ equityCurves: [a, b] });
    // No rebalance: combined should be the weighted avg of finals.
    const expectedNaive = 0.5 * a[a.length - 1]! + 0.5 * b[b.length - 1]!;
    expect(r.finalEquity).toBeCloseTo(expectedNaive, 4);
  });
});

describe("computePortfolioCombine — Parrondo / rebalancing premium", () => {
  test("anti-correlated strategies with rebalancing produce a positive premium", () => {
    // Two strategies that alternate winning/losing in opposite phases.
    // Each on its own is roughly flat; rebalanced combination should
    // harvest the spread.
    const a = curveFromReturns([0.1, -0.08, 0.1, -0.08, 0.1, -0.08, 0.1, -0.08]);
    const b = curveFromReturns([-0.08, 0.1, -0.08, 0.1, -0.08, 0.1, -0.08, 0.1]);
    const r = computePortfolioCombine({
      equityCurves: [a, b],
      rebalanceCadence: "daily",
    });
    expect(r.rebalanceEvents).toBeGreaterThan(0);
    expect(r.hasParrondo).toBe(true);
    expect(r.rebalancingPremium).toBeGreaterThan(0);
  });

  test("transaction costs can erase the rebalancing premium", () => {
    const a = curveFromReturns([0.05, -0.04, 0.05, -0.04, 0.05, -0.04]);
    const b = curveFromReturns([-0.04, 0.05, -0.04, 0.05, -0.04, 0.05]);
    const free = computePortfolioCombine({
      equityCurves: [a, b],
      rebalanceCadence: "daily",
      txCostBps: 0,
    });
    const expensive = computePortfolioCombine({
      equityCurves: [a, b],
      rebalanceCadence: "daily",
      txCostBps: 500, // 5% — punitively high to make the effect visible.
    });
    expect(expensive.finalEquity).toBeLessThan(free.finalEquity);
    expect(expensive.totalTxCost).toBeGreaterThan(0);
  });
});

describe("computePortfolioCombine — rebalance cadences", () => {
  test("'never' cadence performs zero rebalances", () => {
    const a = curveFromReturns([0.01, 0.01, 0.01]);
    const b = curveFromReturns([-0.01, -0.01, -0.01]);
    const r = computePortfolioCombine({
      equityCurves: [a, b],
      rebalanceCadence: "never",
    });
    expect(r.rebalanceEvents).toBe(0);
  });

  test("'weekly' rebalances every 5 bars", () => {
    const series = curveFromReturns(Array(20).fill(0.01));
    const r = computePortfolioCombine({
      equityCurves: [series, series],
      rebalanceCadence: "weekly",
    });
    // 20 bars / 5 = 4 rebalance events (at bars 5, 10, 15, 20).
    expect(r.rebalanceEvents).toBe(4);
  });
});

describe("computePortfolioCombine — error handling", () => {
  test("throws on empty equityCurves", () => {
    expect(() => computePortfolioCombine({ equityCurves: [] })).toThrow(/non-empty/);
  });

  test("throws on mismatched curve lengths", () => {
    expect(() =>
      computePortfolioCombine({
        equityCurves: [
          [1, 1, 1],
          [1, 1],
        ],
      }),
    ).toThrow(/length/);
  });

  test("throws on too-short curves", () => {
    expect(() => computePortfolioCombine({ equityCurves: [[1], [1]] })).toThrow(/2 bars/);
  });

  test("throws on weights not summing to 1", () => {
    expect(() =>
      computePortfolioCombine({
        equityCurves: [
          [1, 1],
          [1, 1],
        ],
        weights: [0.3, 0.3],
      }),
    ).toThrow(/sum to 1/);
  });

  test("throws on weights length mismatch", () => {
    expect(() =>
      computePortfolioCombine({
        equityCurves: [
          [1, 1],
          [1, 1],
        ],
        weights: [0.5, 0.3, 0.2],
      }),
    ).toThrow(/length/);
  });
});

describe("computePortfolioCombine — diagnostics", () => {
  test("reports volatility, arithmetic, and geometric means", () => {
    const a = curveFromReturns([0.05, -0.03, 0.05, -0.03, 0.05, -0.03]);
    const r = computePortfolioCombine({
      equityCurves: [a, a],
    });
    expect(r.volatility).toBeGreaterThan(0);
    expect(r.arithmeticMeanReturn).toBeGreaterThan(r.geometricMeanReturn);
  });
});
