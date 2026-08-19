import { describe, expect, test } from "bun:test";

import { BacktestEngine } from "./engine.ts";
import type { BacktestEngineParams } from "./engine.ts";
import { walkBookFill } from "./fill-model.ts";
import type { BarDepth } from "./fill-model.ts";
import type { OHLC, Position, Signal } from "./types.ts";

const SLIPPAGE_RATE = 0.001;

/** Thinning depth: each step away from the touch holds less size than the last. */
const THINNING_BOOK: BarDepth = {
  bids: [
    { price: 99.95, quantity: 100 },
    { price: 99.9, quantity: 50 },
    { price: 99.8, quantity: 25 },
    { price: 99.6, quantity: 12 },
    { price: 99.2, quantity: 500 },
  ],
  asks: [
    { price: 100.0, quantity: 100 },
    { price: 100.05, quantity: 50 },
    { price: 100.1, quantity: 25 },
    { price: 100.2, quantity: 12 },
    { price: 100.4, quantity: 500 },
  ],
};

const TOTAL_ASK_DEPTH = 100 + 50 + 25 + 12 + 500;

function bars(count: number): OHLC[] {
  return Array.from({ length: count }, (_, i) => ({
    timestamp: 1_700_000_000_000 + i * 60_000,
    open: 100,
    high: 100,
    low: 100,
    close: 100,
    volume: 1_000,
  }));
}

/** Buys on the second bar, sells on the fourth. Deterministic, indicator-free. */
function entryExitStrategy() {
  return {
    id: "fill-test",
    name: "Fill Test",
    generateSignal(bar: OHLC, _indicators: unknown, _position: Position | null): Signal | null {
      const index = (bar.timestamp - 1_700_000_000_000) / 60_000;
      if (index === 1) return { type: "BUY", price: 100, timestamp: bar.timestamp, reason: "entry" };
      if (index === 3) return { type: "SELL", price: 100, timestamp: bar.timestamp, reason: "exit" };
      return null;
    },
  };
}

function baseParams(notional: number): BacktestEngineParams {
  return {
    initialCapital: 1_000_000,
    positionSizing: "FIXED_AMOUNT",
    fixedAmount: notional,
    commissionRate: 0,
    slippageRate: SLIPPAGE_RATE,
    spreadRate: 0,
    marketImpactRate: 0,
    allowShorts: false,
  };
}

describe("flat-rate fills stay the default", () => {
  test("an engine built without a fill model prices entries and exits at the flat rate", () => {
    const engine = new BacktestEngine(baseParams(5_000));
    const result = engine.run(entryExitStrategy(), bars(6));

    expect(result.trades).toHaveLength(1);
    const trade = result.trades[0]!;
    expect(trade.entryPrice).toBe(100 * (1 + SLIPPAGE_RATE));
    expect(trade.exitPrice).toBe(100 * (1 - SLIPPAGE_RATE));
    expect(trade.quantity).toBe(5_000 / (100 * (1 + SLIPPAGE_RATE)));
    expect(engine.getFillLog()).toHaveLength(0);
  });

  test("enabling the fill model is the only thing that changes the fill price", () => {
    const flat = new BacktestEngine(baseParams(5_000)).run(entryExitStrategy(), bars(6));
    const booked = new BacktestEngine({
      ...baseParams(5_000),
      fillModel: { depth: () => THINNING_BOOK },
    }).run(entryExitStrategy(), bars(6));

    expect(booked.trades[0]!.entryPrice).not.toBe(flat.trades[0]!.entryPrice);
  });
});

describe("book-aware fills price at realized depth", () => {
  test("an order that rests inside the top level fills at the touch", () => {
    const fill = walkBookFill(THINNING_BOOK, "BUY", 50);

    expect(fill.price).toBe(100.0);
    expect(fill.filledQuantity).toBe(50);
    expect(fill.levelsConsumed).toBe(1);
    expect(fill.source).toBe("book");
    expect(fill.estimated).toBe(false);
  });

  test("a buy that exhausts several levels fills above the touch at the realized VWAP", () => {
    const fill = walkBookFill(THINNING_BOOK, "BUY", 240);

    expect(fill.levelsConsumed).toBe(5);
    expect(fill.filledQuantity).toBe(240);
    expect(fill.price).toBeGreaterThan(100.0);
    expect(fill.price).toBeLessThan(100.4);
    expect(fill.price).toBeCloseTo(
      (100 * 100.0 + 50 * 100.05 + 25 * 100.1 + 12 * 100.2 + 53 * 100.4) / 240,
      9
    );
  });

  test("a sell that exhausts several levels fills below the touch, never above it", () => {
    const fill = walkBookFill(THINNING_BOOK, "SELL", 240);

    expect(fill.levelsConsumed).toBe(5);
    expect(fill.price).toBeLessThan(99.95);
    expect(fill.price).toBeGreaterThan(99.2);
  });

  test("impact is directional: the same size costs the buyer up and the seller down", () => {
    const buy = walkBookFill(THINNING_BOOK, "BUY", 240);
    const sell = walkBookFill(THINNING_BOOK, "SELL", 240);

    expect(buy.price - 100.0).toBeGreaterThan(0);
    expect(99.95 - sell.price).toBeGreaterThan(0);
  });

  test("slippage grows faster than order size in a thinning book", () => {
    const small = walkBookFill(THINNING_BOOK, "BUY", 120);
    const double = walkBookFill(THINNING_BOOK, "BUY", 240);

    const smallSlippage = small.price - 100.0;
    const doubleSlippage = double.price - 100.0;

    expect(smallSlippage).toBeGreaterThan(0);
    expect(doubleSlippage).toBeGreaterThan(2 * smallSlippage);
  });

  test("the engine records the book VWAP as the entry price when depth is available", () => {
    const engine = new BacktestEngine({
      ...baseParams(24_000),
      fillModel: { depth: () => THINNING_BOOK },
    });
    engine.run(entryExitStrategy(), bars(6));

    const entryFill = engine.getFillLog()[0]!;
    expect(entryFill.side).toBe("BUY");
    expect(entryFill.source).toBe("book");
    expect(entryFill.estimated).toBe(false);
    expect(entryFill.levelsConsumed).toBeGreaterThan(1);
    expect(entryFill.price).toBeGreaterThan(entryFill.referencePrice);
  });
});

describe("depth exhaustion is explicit", () => {
  test("an order larger than all depth fills only what the book holds and is flagged partial", () => {
    const fill = walkBookFill(THINNING_BOOK, "BUY", 5_000);

    expect(fill.source).toBe("book_partial");
    expect(fill.filledQuantity).toBe(TOTAL_ASK_DEPTH);
    expect(fill.requestedQuantity).toBe(5_000);
    // The unfillable remainder is not priced at the last level, it is not priced at all.
    expect(fill.price).toBeLessThan(100.4);
  });

  test("an entry larger than all depth opens only the quantity the book could absorb", () => {
    const engine = new BacktestEngine({
      ...baseParams(500_000),
      fillModel: { depth: () => THINNING_BOOK },
    });
    const result = engine.run(entryExitStrategy(), bars(6));

    expect(result.trades[0]!.quantity).toBeCloseTo(TOTAL_ASK_DEPTH, 9);
    expect(engine.getFillLog()[0]!.source).toBe("book_partial");
  });

  test("an exit larger than all depth falls back to the flat rate and is flagged estimated", () => {
    const engine = new BacktestEngine({
      ...baseParams(20_000),
      // Only the exit side runs dry, so the entry stays book-priced.
      fillModel: { depth: () => ({ asks: THINNING_BOOK.asks, bids: [{ price: 99.95, quantity: 5 }] }) },
    });
    const result = engine.run(entryExitStrategy(), bars(6));

    const exitFill = engine.getFillLog()[1]!;
    expect(exitFill.side).toBe("SELL");
    expect(exitFill.source).toBe("book_partial");
    expect(exitFill.estimated).toBe(true);
    expect(result.trades[0]!.exitPrice).toBe(100 * (1 - SLIPPAGE_RATE));
  });

  test("an empty book on the traded side opens no position", () => {
    const engine = new BacktestEngine({
      ...baseParams(5_000),
      fillModel: { depth: () => ({ asks: [], bids: THINNING_BOOK.bids }) },
    });
    const result = engine.run(entryExitStrategy(), bars(6));

    expect(result.trades).toHaveLength(0);
  });
});

describe("missing depth degrades visibly", () => {
  test("a bar with no depth data falls back to the flat rate and is flagged estimated", () => {
    const engine = new BacktestEngine({
      ...baseParams(5_000),
      fillModel: { depth: () => undefined },
    });
    const result = engine.run(entryExitStrategy(), bars(6));

    expect(result.trades[0]!.entryPrice).toBe(100 * (1 + SLIPPAGE_RATE));
    expect(result.trades[0]!.exitPrice).toBe(100 * (1 - SLIPPAGE_RATE));

    const log = engine.getFillLog();
    expect(log).toHaveLength(2);
    for (const fill of log) {
      expect(fill.source).toBe("estimated");
      expect(fill.estimated).toBe(true);
      expect(fill.levelsConsumed).toBe(0);
    }
  });

  test("book-priced and estimated fills are distinguishable within one run", () => {
    const engine = new BacktestEngine({
      ...baseParams(12_000),
      fillModel: { depth: (_bar, index) => (index === 1 ? THINNING_BOOK : undefined) },
    });
    engine.run(entryExitStrategy(), bars(6));

    const log = engine.getFillLog();
    expect(log[0]!.estimated).toBe(false);
    expect(log[1]!.estimated).toBe(true);
  });
});

describe("determinism", () => {
  test("the same order stream against the same book yields the same fills", () => {
    const config = (): BacktestEngineParams => ({
      ...baseParams(12_000),
      fillModel: { depth: () => THINNING_BOOK },
    });

    const first = new BacktestEngine(config());
    const second = new BacktestEngine(config());
    const firstResult = first.run(entryExitStrategy(), bars(6));
    const secondResult = second.run(entryExitStrategy(), bars(6));

    expect(secondResult.trades).toEqual(firstResult.trades);
    expect(second.getFillLog()).toEqual(first.getFillLog());
  });

  test("re-running one engine reproduces its own fills", () => {
    const engine = new BacktestEngine({
      ...baseParams(12_000),
      fillModel: { depth: () => THINNING_BOOK },
    });
    const firstRun = engine.run(entryExitStrategy(), bars(6));
    const firstLog = [...engine.getFillLog()];
    const secondRun = engine.run(entryExitStrategy(), bars(6));

    expect(secondRun.trades).toEqual(firstRun.trades);
    expect(engine.getFillLog()).toEqual(firstLog);
  });
});
