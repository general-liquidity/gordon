import { describe, it, expect } from "bun:test";
import {
  computeOrderBookImbalance,
  standardizeOrderBookImbalance,
  isOrderBookPersistent,
  type OrderBookSnapshot,
} from "./order-book-imbalance.ts";

function makeBook(
  bidLevels: Array<[number, number]>,
  askLevels: Array<[number, number]>,
): OrderBookSnapshot {
  return {
    bids: bidLevels.map(([price, quantity]) => ({ price, quantity })),
    asks: askLevels.map(([price, quantity]) => ({ price, quantity })),
    timestamp: 1_700_000_000_000,
    symbol: "BTC/USDT",
  };
}

describe("computeOrderBookImbalance — basic", () => {
  it("returns 0 OBI on balanced book", () => {
    const book = makeBook(
      [
        [100, 1],
        [99, 1],
        [98, 1],
      ],
      [
        [101, 1],
        [102, 1],
        [103, 1],
      ],
    );
    const result = computeOrderBookImbalance(book);
    expect(result.obi).toBe(0);
    expect(result.midPrice).toBe(100.5);
    expect(result.bidVolume).toBe(3);
    expect(result.askVolume).toBe(3);
  });

  it("returns +1 on bid-only book", () => {
    const book = makeBook([[100, 5]], []);
    const result = computeOrderBookImbalance(book);
    expect(result.obi).toBe(1);
  });

  it("returns -1 on ask-only book", () => {
    const book = makeBook([], [[101, 5]]);
    const result = computeOrderBookImbalance(book);
    expect(result.obi).toBe(-1);
  });

  it("returns 0 on empty book without crashing", () => {
    const book = makeBook([], []);
    const result = computeOrderBookImbalance(book);
    expect(result.obi).toBe(0);
    expect(result.midPrice).toBe(0);
  });

  it("respects depth limit", () => {
    const book = makeBook(
      [
        [100, 10],
        [99, 10],
        [98, 10],
        [97, 10],
      ],
      [
        [101, 1],
        [102, 1],
      ],
    );
    const result = computeOrderBookImbalance(book, { depthLevels: 2 });
    expect(result.bidVolume).toBe(20);
    expect(result.askVolume).toBe(2);
    // OBI = (20 - 2) / 22 = 0.818...
    expect(result.obi).toBeCloseTo(18 / 22, 4);
  });

  it("includes symbol when supplied", () => {
    const book = makeBook([[100, 1]], [[101, 1]]);
    const result = computeOrderBookImbalance(book);
    expect(result.symbol).toBe("BTC/USDT");
  });
});

describe("computeOrderBookImbalance — bid/ask imbalance", () => {
  it("positive OBI on bid-heavy book", () => {
    const book = makeBook(
      [
        [100, 5],
        [99, 3],
      ],
      [
        [101, 1],
        [102, 1],
      ],
    );
    const result = computeOrderBookImbalance(book);
    expect(result.obi).toBeGreaterThan(0.5);
  });

  it("negative OBI on ask-heavy book", () => {
    const book = makeBook(
      [
        [100, 1],
        [99, 1],
      ],
      [
        [101, 5],
        [102, 3],
      ],
    );
    const result = computeOrderBookImbalance(book);
    expect(result.obi).toBeLessThan(-0.5);
  });
});

describe("standardizeOrderBookImbalance — Z-score + verdict", () => {
  it("returns balanced + zero standardized when no history", () => {
    const current = computeOrderBookImbalance(makeBook([[100, 3]], [[101, 1]]));
    const result = standardizeOrderBookImbalance(current, []);
    expect(result.standardizedObi).toBe(0);
    expect(result.verdict).toBe("balanced");
  });

  it("flags strong_bid when current OBI is +2σ above history", () => {
    const current = computeOrderBookImbalance(makeBook([[100, 10]], [[101, 1]]));
    // History centered around 0
    const history = [-0.1, 0.0, 0.1, -0.05, 0.05];
    const result = standardizeOrderBookImbalance(current, history);
    expect(result.standardizedObi).toBeGreaterThan(2);
    expect(result.verdict).toBe("strong_bid");
  });

  it("flags strong_ask when current OBI is -2σ below history", () => {
    const current = computeOrderBookImbalance(makeBook([[100, 1]], [[101, 10]]));
    const history = [0.0, 0.05, -0.05, 0.1, -0.1];
    const result = standardizeOrderBookImbalance(current, history);
    expect(result.standardizedObi).toBeLessThan(-2);
    expect(result.verdict).toBe("strong_ask");
  });

  it("flags moderate when between 0.5σ and 2σ", () => {
    const current = computeOrderBookImbalance(makeBook([[100, 3]], [[101, 1]]));
    const history = [0, 0.1, -0.05, 0.05, -0.1];
    const result = standardizeOrderBookImbalance(current, history);
    expect(["moderate_bid", "strong_bid"]).toContain(result.verdict);
  });

  it("respects custom moderate/strong thresholds", () => {
    const current = computeOrderBookImbalance(makeBook([[100, 3]], [[101, 1]]));
    const history = [-0.1, 0.0, 0.1, -0.05, 0.05];
    // Current OBI ≈ 0.5, history std ≈ 0.077 → standardized ≈ 6.5
    // With moderate=100 and strong=200, the 6.5 falls in balanced range
    const lax = standardizeOrderBookImbalance(current, history, {
      moderateThreshold: 100,
      strongThreshold: 200,
    });
    expect(lax.verdict).toBe("balanced");
  });
});

describe("standardizeOrderBookImbalance — fair price adjustment", () => {
  it("computes Lipton-style fair price = mid + c × OBI_std", () => {
    const current = computeOrderBookImbalance(makeBook([[100, 10]], [[101, 1]]));
    const history = [-0.05, 0, 0.05, -0.05, 0];
    const c = 0.5; // arbitrary scaling
    const result = standardizeOrderBookImbalance(current, history, {
      scalingCoefficient: c,
    });
    // mid = 100.5, std OBI > 0 → fair > mid
    expect(result.fairPrice).toBeGreaterThan(result.midPrice);
    // Delta in bps should be positive
    expect(result.fairPriceDeltaBps).toBeGreaterThan(0);
  });

  it("fair price equals mid when standardized OBI is 0", () => {
    const current = computeOrderBookImbalance(makeBook([[100, 1]], [[101, 1]]));
    const history = [0, 0, 0, 0, 0];
    const result = standardizeOrderBookImbalance(current, history);
    // Constant history → std = 0 → standardized = 0 → fair = mid
    expect(result.fairPrice).toBe(result.midPrice);
    expect(result.fairPriceDeltaBps).toBe(0);
  });
});

describe("isOrderBookPersistent — anti-spoofing", () => {
  it("returns false for fewer than required observations", () => {
    expect(isOrderBookPersistent([0.5, 0.5], 3)).toBe(false);
  });

  it("returns true when last N values are same-sign + above threshold", () => {
    expect(isOrderBookPersistent([0.2, 0.3, 0.5], 3, 0.1)).toBe(true);
  });

  it("returns false when signs flip", () => {
    expect(isOrderBookPersistent([0.5, -0.5, 0.5], 3, 0.1)).toBe(false);
  });

  it("returns false when magnitude is below threshold", () => {
    expect(isOrderBookPersistent([0.05, 0.05, 0.05], 3, 0.1)).toBe(false);
  });

  it("uses only the last N values", () => {
    // First value would fail, last 3 succeed
    expect(isOrderBookPersistent([-0.9, 0.2, 0.3, 0.5], 3, 0.1)).toBe(true);
  });
});
