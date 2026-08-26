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

/** Buys once and never sells, so the run ends holding an open position. */
const buyAndHoldStrategy = {
  id: "hold-test",
  name: "hold-test",
  generateSignal(
    bar: OHLC,
    _indicators: unknown,
    position: Position | null,
  ): Signal | null {
    if (!position && bar.close === 100) {
      return { type: "BUY", price: bar.close, timestamp: bar.timestamp, reason: "entry" };
    }
    return null;
  },
};

/**
 * Grid entry at 100, grid exit at 110, so the run ends flat. The
 * single-position strategies cannot do this: the engine only asks for a signal
 * while flat or in grid mode, so their only exit is a stop, a target, or the
 * forced end-of-backtest close.
 */
const gridRoundTripStrategy = {
  id: "grid-round-trip-test",
  name: "grid-round-trip-test",
  generateSignal(bar: OHLC, _indicators: unknown, _position: Position | null): Signal | null {
    if (bar.close === 100) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: "grid entry",
        gridLevel: 0,
        maxPositions: 2,
      };
    }
    if (bar.close === 110) {
      return {
        type: "SELL",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: "grid exit",
        gridLevel: 0,
        maxPositions: 2,
      };
    }
    return null;
  },
};

/** Buys a grid level and holds it, so the multi-position path ends open. */
const gridHoldStrategy = {
  id: "grid-hold-test",
  name: "grid-hold-test",
  generateSignal(bar: OHLC, _indicators: unknown, _position: Position | null): Signal | null {
    if (bar.close === 100) {
      return {
        type: "BUY",
        price: bar.close,
        timestamp: bar.timestamp,
        reason: "grid entry",
        gridLevel: 0,
        maxPositions: 2,
      };
    }
    return null;
  },
};

const shortHoldStrategy = {
  id: "short-hold-test",
  name: "short-hold-test",
  generateSignal(
    bar: OHLC,
    _indicators: unknown,
    position: Position | null,
  ): Signal | null {
    if (!position && bar.close === 100) {
      return { type: "SELL", price: bar.close, timestamp: bar.timestamp, reason: "short entry" };
    }
    return null;
  },
};

/**
 * The identity that catches every commission-accounting defect at once: money
 * only leaves the account through a trade, so the change in capital over a
 * completed backtest must equal the sum of what those trades netted.
 *
 * It broke because the END_OF_BACKTEST close ran AFTER the last
 * `updateEquityCurve`, so the exit commission it charged never reached the
 * final equity point that `finalCapital` is read from. Only a run that ends
 * holding an open position takes that path, which is why most cases below end
 * with one.
 */
describe("capital change equals the sum of trade netPnL", () => {
  function assertInvariant(result: { finalCapital: number; trades: { netPnL: number }[] }) {
    const summed = result.trades.reduce((sum, t) => sum + t.netPnL, 0);
    expect(result.finalCapital - 100_000).toBeCloseTo(summed, 6);
  }

  test("run ending with an open long position", () => {
    const result = new BacktestEngine(params()).run(buyAndHoldStrategy, bars([100, 100, 110, 110]));
    expect(result.finalPositionClosed).toBe(true);
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]!.exitReason).toBe("END_OF_BACKTEST");
    // 10,000 notional in at 100, out at 110: gross 1,000 less 10 entry and 11
    // exit commission. Before the ordering fix the capital change read 990.
    expect(result.finalCapital - 100_000).toBeCloseTo(979, 6);
    assertInvariant(result);
  });

  test("run ending with an open short position", () => {
    const result = new BacktestEngine(params({ allowShorts: true })).run(
      shortHoldStrategy,
      bars([100, 100, 90, 90]),
    );
    expect(result.finalPositionClosed).toBe(true);
    assertInvariant(result);
  });

  test("run ending with open grid positions", () => {
    const result = new BacktestEngine(params()).run(gridHoldStrategy, bars([100, 100, 110, 110]));
    expect(result.finalPositionClosed).toBe(true);
    expect(result.trades.length).toBeGreaterThan(0);
    assertInvariant(result);
  });

  test("run ending flat still balances", () => {
    const result = new BacktestEngine(params()).run(
      gridRoundTripStrategy,
      bars([100, 100, 110, 110]),
    );
    expect(result.finalPositionClosed).toBe(false);
    assertInvariant(result);
  });

  test("the final equity point carries the forced close, and so does max drawdown", () => {
    const result = new BacktestEngine(params()).run(buyAndHoldStrategy, bars([100, 100, 110, 110]));
    const last = result.equityCurve[result.equityCurve.length - 1]!;
    expect(last.equity).toBeCloseTo(result.finalCapital, 9);
    expect(result.metrics.finalValue).toBeCloseTo(result.finalCapital, 9);
    expect(result.metrics.netProfit).toBeCloseTo(979, 6);
    // The 11 the exit commission gives back off the 100,990 peak. Reported as
    // a flat 0 while the curve stopped one movement short.
    expect(last.drawdown).toBeCloseTo(11, 6);
    expect(result.metrics.maxDrawdown).toBeGreaterThan(0);
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
