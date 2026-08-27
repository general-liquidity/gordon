import { describe, expect, it } from "bun:test";

import { runMonteCarloSimulation } from "./monte-carlo.ts";
import type { Trade } from "../types.ts";

function trade(netPnL: number, i: number): Trade {
  return {
    id: `t${i}`,
    side: "LONG",
    entryPrice: 100,
    entryTime: i * 60_000,
    exitPrice: 100 + netPnL / 10,
    exitTime: (i + 1) * 60_000,
    quantity: 10,
    grossPnL: netPnL,
    commission: 0,
    netPnL,
    returnPct: netPnL / 10,
    holdingPeriod: 1,
    exitReason: "SIGNAL",
  };
}

const TRADES = [100, -50, 200, -30, 80, -120, 60].map(trade);

describe("Monte Carlo resampling", () => {
  it("permutation cannot vary terminal return, and is no longer scored as if it could", async () => {
    // Reordering the same trades leaves terminal equity fixed: a sum does not
    // care about order. stdDev came out ~1e-14, so the coefficient of
    // variation cleared the `< 0.3` arm on every run and "Low return
    // variability (consistent performance)" was awarded unconditionally.
    const r = await runMonteCarloSimulation(TRADES, {
      iterations: 200,
      initialCapital: 10_000,
      seed: 42,
    });
    expect(r.returnDistribution.stdDev).toBeLessThan(1e-9);
    expect(r.robustness.observations.some((o) => o.includes("return variability"))).toBe(false);
  });

  it("permutation still varies the drawdown, which is what it can measure", async () => {
    const r = await runMonteCarloSimulation(TRADES, {
      iterations: 200,
      initialCapital: 10_000,
      seed: 42,
    });
    expect(r.drawdownDistribution.stdDev).toBeGreaterThan(0);
  });

  it("bootstrap produces a genuine return distribution", async () => {
    // Resampling with replacement changes the trade population per iteration,
    // and the per-trade RETURN FRACTION is what gets compounded: a $100 win
    // earned on $10,000 is a 1% result and must not be replayed verbatim at a
    // different equity level.
    const r = await runMonteCarloSimulation(TRADES, {
      iterations: 500,
      initialCapital: 10_000,
      seed: 7,
      resampleMode: "bootstrap",
    });
    expect(r.returnDistribution.stdDev).toBeGreaterThan(0.5);
    expect(r.robustness.observations.some((o) => o.includes("return variability"))).toBe(true);
  });

  it("is reproducible under a seed", async () => {
    const a = await runMonteCarloSimulation(TRADES, {
      iterations: 100,
      initialCapital: 10_000,
      seed: 11,
      resampleMode: "bootstrap",
    });
    const b = await runMonteCarloSimulation(TRADES, {
      iterations: 100,
      initialCapital: 10_000,
      seed: 11,
      resampleMode: "bootstrap",
    });
    expect(b.returnDistribution.mean).toBeCloseTo(a.returnDistribution.mean, 12);
  });
});
