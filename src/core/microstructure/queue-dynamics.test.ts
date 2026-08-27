import { describe, it, expect } from "bun:test";
import { queuePositionSignal, spreadCrossingProbability } from "./queue-dynamics.ts";
import type { OrderBookSnapshot } from "./order-book-imbalance.ts";

const book = (bidSize: number, askSize: number): OrderBookSnapshot => ({
  bids: [{ price: 100, quantity: bidSize }],
  asks: [{ price: 100.02, quantity: askSize }],
});

describe("queuePositionSignal", () => {
  it("a thicker ask queue ⇒ positive imbalance ⇒ bid fills faster", () => {
    const r = queuePositionSignal({ snapshot: book(100, 400) });
    expect(r.bidQueue).toBe(100);
    expect(r.askQueue).toBe(400);
    expect(r.queueImbalance).toBeCloseTo(0.6, 6); // (400−100)/500
    expect(r.verdict).toBe("bid_fills_faster");
  });

  it("a thicker bid queue ⇒ negative imbalance ⇒ ask fills faster", () => {
    const r = queuePositionSignal({ snapshot: book(400, 100) });
    expect(r.queueImbalance).toBeCloseTo(-0.6, 6);
    expect(r.verdict).toBe("ask_fills_faster");
  });

  it("balanced queues ⇒ ~0 imbalance ⇒ balanced verdict", () => {
    const r = queuePositionSignal({ snapshot: book(200, 200) });
    expect(r.queueImbalance).toBeCloseTo(0, 6);
    expect(r.verdict).toBe("balanced");
  });

  it("time-to-fill = queueSize / fillRate when a rate is supplied", () => {
    const r = queuePositionSignal({ snapshot: book(300, 150), bidFillRate: 100, askFillRate: 50 });
    expect(r.timeToFillBidSec).toBeCloseTo(3, 6); // 300 / 100
    expect(r.timeToFillAskSec).toBeCloseTo(3, 6); // 150 / 50
  });

  it("empty book ⇒ zero imbalance, null time-to-fill (no rate), balanced", () => {
    const r = queuePositionSignal({ snapshot: { bids: [], asks: [] } });
    expect(r.queueImbalance).toBe(0);
    expect(r.timeToFillBidSec).toBeNull();
    expect(r.verdict).toBe("balanced");
  });
});

describe("spreadCrossingProbability", () => {
  it("crossing probability rises with aggressive flow", () => {
    const slow = spreadCrossingProbability({
      snapshot: book(200, 200),
      buyFlowRate: 50,
      sellFlowRate: 0,
    });
    const fast = spreadCrossingProbability({
      snapshot: book(200, 200),
      buyFlowRate: 400,
      sellFlowRate: 0,
    });
    expect(fast.pCrossUp).toBeGreaterThan(slow.pCrossUp);
    expect(slow.pCrossUp).toBeGreaterThan(0);
    expect(fast.pCrossUp).toBeLessThan(1);
  });

  it("crossing probability rises with horizon", () => {
    const short = spreadCrossingProbability({
      snapshot: book(200, 200),
      buyFlowRate: 100,
      sellFlowRate: 0,
      horizonSec: 1,
    });
    const long = spreadCrossingProbability({
      snapshot: book(200, 200),
      buyFlowRate: 100,
      sellFlowRate: 0,
      horizonSec: 5,
    });
    expect(long.pCrossUp).toBeGreaterThan(short.pCrossUp);
  });

  it("expected clear time = touchSize / flow; matches the exp formula", () => {
    const r = spreadCrossingProbability({
      snapshot: book(100, 200),
      buyFlowRate: 100,
      sellFlowRate: 100,
      horizonSec: 2,
    });
    expect(r.expClearAskSec).toBeCloseTo(2, 6); // 200 / 100
    expect(r.expClearBidSec).toBeCloseTo(1, 6); // 100 / 100
    expect(r.pCrossUp).toBeCloseTo(1 - Math.exp(-2 / 2), 6);
    expect(r.pCrossDown).toBeCloseTo(1 - Math.exp(-2 / 1), 6);
    // thinner bid clears faster → more downward crossing pressure
    expect(r.netCrossBias).toBeLessThan(0);
  });

  it("an empty touch is already crossed (p=1); zero flow can never cross (p=0)", () => {
    const emptyAsk = spreadCrossingProbability({
      snapshot: book(200, 0),
      buyFlowRate: 10,
      sellFlowRate: 10,
    });
    expect(emptyAsk.pCrossUp).toBe(1);
    const noFlow = spreadCrossingProbability({
      snapshot: book(200, 200),
      buyFlowRate: 0,
      sellFlowRate: 0,
    });
    expect(noFlow.pCrossUp).toBe(0);
    expect(noFlow.pCrossDown).toBe(0);
    expect(noFlow.expClearAskSec).toBeNull();
  });
});
