import { describe, expect, test } from "bun:test";

import { BacktestEngine, protectiveOrderPrices } from "./engine.ts";
import type { BacktestEngineParams } from "./engine.ts";
import type { OHLC, Position, Signal } from "./types.ts";

const COMMISSION_RATE = 0.001;

function bars(prices: number[]): OHLC[] {
  return prices.map((p, i) => ({
    timestamp: 1_700_000_000_000 + i * 60_000,
    open: p,
    high: p,
    low: p,
    close: p,
    volume: 1_000,
  }));
}

function params(overrides: Partial<BacktestEngineParams> = {}): BacktestEngineParams {
  return {
    initialCapital: 100_000,
    timeframe: "1h",
    positionSizing: "FIXED_AMOUNT",
    fixedAmount: 10_000,
    commissionRate: COMMISSION_RATE,
    slippageRate: 0,
    spreadRate: 0,
    marketImpactRate: 0,
    allowShorts: false,
    ...overrides,
  };
}

/** Buys on bar 1, sells on bar 4. Indicator-free and deterministic. */
const entryExitStrategy = {
  id: "cost-test",
  name: "cost-test",
  generateSignal(
    bar: OHLC,
    _indicators: unknown,
    position: Position | null,
  ): Signal | null {
    if (!position && bar.close === 100) {
      return { type: "BUY", price: bar.close, timestamp: bar.timestamp, reason: "entry" };
    }
    if (position && bar.close === 110) {
      return { type: "SELL", price: bar.close, timestamp: bar.timestamp, reason: "exit" };
    }
    return null;
  },
};

describe("commission accounting", () => {
  // Entry at 100 with a $10,000 notional: 100 units, entry commission $10.
  // Exit at 110: notional $11,000, exit commission $11. gross = $1,000.
  // Netting only the exit leg reported $989, overstating by exactly the $10
  // entry commission that `capital` had already paid at open.
  const data = bars([100, 100, 110, 110]);

  test("netPnL nets BOTH legs", () => {
    const result = new BacktestEngine(params()).run(entryExitStrategy, data);
    const trade = result.trades[0]!;
    expect(trade.grossPnL).toBeCloseTo(1000, 6);
    expect(trade.commission).toBeCloseTo(21, 6);
    expect(trade.netPnL).toBeCloseTo(979, 6);
    expect(trade.netPnL).toBeCloseTo(trade.grossPnL - trade.commission, 9);
  });

  test("returnPct is measured on the same net figure", () => {
    const result = new BacktestEngine(params()).run(entryExitStrategy, data);
    const trade = result.trades[0]!;
    expect(trade.returnPct).toBeCloseTo((979 / 10_000) * 100, 6);
  });
});

describe("protectiveOrderPrices", () => {
  const s = 0.01;

  test("a long stop triggers above its limit and fills below it", () => {
    const { triggerPrice, fillPrice } = protectiveOrderPrices("LONG", 100, s);
    expect(triggerPrice).toBeCloseTo(101, 9); // low <= 101 fires early
    expect(fillPrice).toBeCloseTo(99, 9);
  });

  test("a long take-profit triggers above its limit and fills below it", () => {
    // Old inline expression: trigger 99 (fires BELOW the limit) and fill 101
    // (BETTER than the limit). Free money on both legs.
    const { triggerPrice, fillPrice } = protectiveOrderPrices("LONG", 100, s);
    expect(triggerPrice).toBeCloseTo(101, 9); // high >= 101 fires late
    expect(fillPrice).toBeCloseTo(99, 9);
    expect(fillPrice).toBeLessThan(100);
  });

  test("a short take-profit triggers below its limit and fills above it", () => {
    const { triggerPrice, fillPrice } = protectiveOrderPrices("SHORT", 100, s);
    expect(triggerPrice).toBeCloseTo(99, 9); // low <= 99 fires late
    expect(fillPrice).toBeCloseTo(101, 9);
    expect(fillPrice).toBeGreaterThan(100);
  });

  test("the fill is always on the losing side of the limit, for both sides", () => {
    expect(protectiveOrderPrices("LONG", 100, s).fillPrice).toBeLessThan(100);
    expect(protectiveOrderPrices("SHORT", 100, s).fillPrice).toBeGreaterThan(100);
  });

  test("zero slippage collapses trigger and fill onto the limit", () => {
    for (const side of ["LONG", "SHORT"] as const) {
      const r = protectiveOrderPrices(side, 100, 0);
      expect(r.triggerPrice).toBe(100);
      expect(r.fillPrice).toBe(100);
    }
  });
});
