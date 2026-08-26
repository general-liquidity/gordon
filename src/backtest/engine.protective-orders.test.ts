import { describe, expect, test } from "bun:test";

import { BacktestEngine, type BacktestEngineParams } from "./engine.ts";
import type { OHLC, Position, Signal } from "./types.ts";

function params(overrides: Partial<BacktestEngineParams> = {}): BacktestEngineParams {
  return {
    initialCapital: 100_000,
    timeframe: "1h",
    positionSizing: "FIXED_AMOUNT",
    fixedAmount: 10_000,
    commissionRate: 0,
    slippageRate: 0.01,
    spreadRate: 0,
    marketImpactRate: 0,
    allowShorts: false,
    ...overrides,
  };
}

function bar(
  index: number,
  prices: { open: number; high: number; low: number; close: number },
): OHLC {
  return {
    timestamp: 1_700_000_000_000 + index * 60_000,
    volume: 1_000,
    ...prices,
  };
}

describe("signal-defined protective orders", () => {
  test("a classic position reaches its take profit through a real run and pays slippage once", () => {
    const strategy = {
      id: "classic-protection",
      name: "classic-protection",
      generateSignal(
        current: OHLC,
        _indicators: unknown,
        position: Position | null,
      ): Signal | null {
        if (position || current.timestamp !== 1_700_000_000_000) return null;
        return {
          type: "BUY",
          price: current.close,
          timestamp: current.timestamp,
          reason: "entry with target",
          stopLoss: 95,
          takeProfit: 110,
        };
      },
    };

    const result = new BacktestEngine(params()).run(strategy, [
      bar(0, { open: 100, high: 100, low: 100, close: 100 }),
      bar(1, { open: 110, high: 112, low: 109, close: 111 }),
    ]);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.exitReason).toBe("TAKE_PROFIT");
    expect(result.trades[0]?.exitPrice).toBeCloseTo(108.9, 10);
  });

  test("a grid position reaches its stop loss through a real run", () => {
    const strategy = {
      id: "grid-protection",
      name: "grid-protection",
      generateSignal(current: OHLC): Signal | null {
        if (current.timestamp !== 1_700_000_000_000) return null;
        return {
          type: "BUY",
          price: current.close,
          timestamp: current.timestamp,
          reason: "grid entry with stop",
          gridLevel: 0,
          maxPositions: 2,
          stopLoss: 95,
          takeProfit: 110,
        };
      },
    };

    const result = new BacktestEngine(params()).run(strategy, [
      bar(0, { open: 100, high: 100, low: 100, close: 100 }),
      bar(1, { open: 95, high: 96, low: 94, close: 95 }),
    ]);

    expect(result.trades).toHaveLength(1);
    expect(result.trades[0]?.exitReason).toBe("STOP_LOSS");
    expect(result.trades[0]?.exitPrice).toBeCloseTo(94.05, 10);
  });

  test("refuses a protective price on the exposure-increasing side of entry", () => {
    const strategy = {
      id: "invalid-protection",
      name: "invalid-protection",
      generateSignal(current: OHLC): Signal {
        return {
          type: "BUY",
          price: current.close,
          timestamp: current.timestamp,
          reason: "invalid stop",
          stopLoss: 105,
        };
      },
    };

    expect(() =>
      new BacktestEngine(params({ slippageRate: 0 })).run(strategy, [
        bar(0, { open: 100, high: 100, low: 100, close: 100 }),
      ]),
    ).toThrow(/long stopLoss 105 must be below entry 100/);
  });
});
