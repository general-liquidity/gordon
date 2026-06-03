import { describe, expect, it } from "bun:test";
import { computeWeightedBookImbalance } from "./weighted-book-imbalance.ts";
import type { OrderBookSnapshot } from "./order-book-imbalance.ts";

function book(bids: [number, number][], asks: [number, number][]): OrderBookSnapshot {
  return {
    bids: bids.map(([price, quantity]) => ({ price, quantity })),
    asks: asks.map(([price, quantity]) => ({ price, quantity })),
  };
}

describe("computeWeightedBookImbalance", () => {
  it("is balanced for a symmetric book", () => {
    const r = computeWeightedBookImbalance(
      book(
        [
          [100, 10],
          [99, 10],
        ],
        [
          [101, 10],
          [102, 10],
        ],
      ),
    );
    expect(r.weightedImbalance).toBeCloseTo(0, 6);
    expect(r.flatImbalance).toBeCloseTo(0, 6);
    expect(r.verdict).toBe("balanced");
    expect(r.midPrice).toBeCloseTo(100.5, 6);
  });

  it("detects touch-concentrated bid pressure (|WDI| > |flat|, same sign)", () => {
    // Big bid at the touch, asks heavier but spread deep.
    const r = computeWeightedBookImbalance(
      book(
        [
          [100, 100], // touch bid dominates after 1/(level+1) weighting
          [99, 1],
        ],
        [
          [101, 10],
          [102, 10],
        ],
      ),
    );
    expect(r.weightedImbalance).toBeGreaterThan(0);
    expect(Math.abs(r.weightedImbalance)).toBeGreaterThan(Math.abs(r.flatImbalance));
    expect(r.concentration).toBe("at_touch");
    expect(r.verdict === "moderate_bid" || r.verdict === "strong_bid").toBe(true);
  });

  it("flags depth-resident pressure (|WDI| < |flat|)", () => {
    // Asks light at touch but a wall deep; bids modest near touch.
    const r = computeWeightedBookImbalance(
      book(
        [
          [100, 5],
          [99, 5],
        ],
        [
          [101, 1],
          [102, 1],
          [103, 200], // deep ask wall — heavy in flat, light after decay
        ],
      ),
    );
    // Flat is ask-heavy (big deep wall); weighted is far less ask-heavy.
    expect(r.flatImbalance).toBeLessThan(0);
    expect(Math.abs(r.weightedImbalance)).toBeLessThan(Math.abs(r.flatImbalance));
    expect(r.concentration).toBe("in_depth");
  });

  it("flags a touch-vs-depth direction conflict", () => {
    // Touch leans bid (big touch bid); the ask wall sits DEEP (level 9), so
    // 1/(level+1) decay crushes it below the touch bid in WDI, while flat
    // still counts its full size → weighted bid-heavy, flat ask-heavy.
    const r = computeWeightedBookImbalance(
      book(
        [
          [100, 80],
          [99, 1],
        ],
        [
          [101, 1],
          [102, 1],
          [103, 1],
          [104, 1],
          [105, 1],
          [106, 1],
          [107, 1],
          [108, 1],
          [109, 1],
          [110, 300],
        ],
      ),
    );
    expect(r.weightedImbalance).toBeGreaterThan(0); // touch bid wins after decay
    expect(r.flatImbalance).toBeLessThan(0); // deep ask wall wins flat
    expect(r.concentration).toBe("touch_vs_depth_conflict");
  });

  it("respects the depthLevels cap", () => {
    const r = computeWeightedBookImbalance(
      book(
        [
          [100, 10],
          [99, 10],
          [98, 999],
        ],
        [
          [101, 10],
          [102, 10],
          [103, 999],
        ],
      ),
      { depthLevels: 2 },
    );
    expect(r.depthLevels).toBe(2);
    expect(r.weightedImbalance).toBeCloseTo(0, 6); // symmetric within top 2
  });
});
