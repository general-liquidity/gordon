import { describe, it, expect } from "bun:test";
import { computeCost, compareVenues } from "./orderBookCost.ts";
import type { OrderBook } from "./types.ts";

const flatBook: OrderBook = {
  lastUpdateId: 1,
  bids: [
    { price: 100, quantity: 5 },
    { price: 99, quantity: 10 },
  ],
  asks: [
    { price: 101, quantity: 5 },
    { price: 102, quantity: 10 },
  ],
};

describe("computeCost", () => {
  it("walks asks for buys, computes effective price + fee", () => {
    const r = computeCost({
      venue: "Test",
      book: flatBook,
      side: "buy",
      sizeBase: 5,
      fee: { taker: 0.001 },
    });
    expect(r.effectivePrice).toBe(101);
    expect(r.notionalQuote).toBe(505);
    expect(r.feeQuote).toBeCloseTo(0.505, 5);
    expect(r.allInQuote).toBeCloseTo(505.505, 3);
    expect(r.slippageQuote).toBe(0); // top of book = reference, no slippage
  });

  it("crosses multiple ask levels and accrues slippage", () => {
    const r = computeCost({
      venue: "Test",
      book: flatBook,
      side: "buy",
      sizeBase: 10, // consumes all of $101 + 5 of $102
      fee: { taker: 0.001 },
    });
    // 5*101 + 5*102 = 1015; effective = 101.5
    expect(r.notionalQuote).toBe(1015);
    expect(r.effectivePrice).toBe(101.5);
    expect(r.referencePrice).toBe(101); // best ask
    expect(r.slippageRate).toBeCloseTo(0.5 / 101, 6);
    expect(r.levelsConsumed).toBe(2);
  });

  it("walks bids for sells", () => {
    const r = computeCost({
      venue: "Test",
      book: flatBook,
      side: "sell",
      sizeBase: 3,
      fee: { taker: 0.001 },
    });
    expect(r.effectivePrice).toBe(100);
    expect(r.notionalQuote).toBe(300);
    expect(r.allInQuote).toBeCloseTo(300 - 0.3, 5); // proceeds shrink by fee
  });

  it("throws on insufficient liquidity", () => {
    expect(() =>
      computeCost({
        venue: "Test",
        book: flatBook,
        side: "buy",
        sizeBase: 100,
        fee: { taker: 0.001 },
      }),
    ).toThrow(/Insufficient liquidity/);
  });

  it("supports midpoint reference basis", () => {
    const r = computeCost({
      venue: "Test",
      book: flatBook,
      side: "buy",
      sizeBase: 1,
      fee: { taker: 0.001 },
      referenceBasis: "mid",
    });
    expect(r.referencePrice).toBe(100.5); // (100 + 101) / 2
  });
});

describe("compareVenues", () => {
  const cheap: OrderBook = {
    lastUpdateId: 1,
    bids: [{ price: 100, quantity: 100 }],
    asks: [{ price: 100.1, quantity: 100 }],
  };
  const expensive: OrderBook = {
    lastUpdateId: 1,
    bids: [{ price: 99.5, quantity: 100 }],
    asks: [{ price: 100.5, quantity: 100 }],
  };

  it("ranks venues by all-in cost (buy → lowest first)", () => {
    const { ranked, savingsVsBest } = compareVenues([
      { venue: "Expensive", book: expensive, side: "buy", sizeBase: 1, fee: { taker: 0.001 } },
      { venue: "Cheap", book: cheap, side: "buy", sizeBase: 1, fee: { taker: 0.001 } },
    ]);
    expect(ranked[0]!.venue).toBe("Cheap");
    expect(ranked[1]!.venue).toBe("Expensive");
    expect(savingsVsBest.Cheap).toBe(0);
    expect(savingsVsBest.Expensive).toBeGreaterThan(0);
  });

  it("ranks venues by proceeds (sell → highest first)", () => {
    const { ranked } = compareVenues([
      { venue: "Expensive", book: expensive, side: "sell", sizeBase: 1, fee: { taker: 0.001 } },
      { venue: "Cheap", book: cheap, side: "sell", sizeBase: 1, fee: { taker: 0.001 } },
    ]);
    // Cheap has bid 100, expensive has bid 99.5 → cheap pays MORE on a sell
    expect(ranked[0]!.venue).toBe("Cheap");
  });

  it("collects per-venue errors without sinking the comparison", () => {
    const { ranked, errors } = compareVenues([
      { venue: "Cheap", book: cheap, side: "buy", sizeBase: 1, fee: { taker: 0.001 } },
      {
        venue: "Empty",
        book: { lastUpdateId: 1, bids: [], asks: [] },
        side: "buy",
        sizeBase: 1,
        fee: { taker: 0.001 },
      },
    ]);
    expect(ranked.length).toBe(1);
    expect(ranked[0]!.venue).toBe("Cheap");
    expect(errors.length).toBe(1);
    expect(errors[0]!.venue).toBe("Empty");
  });
});
