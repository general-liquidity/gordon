import { describe, expect, test } from "bun:test";
import { uncross, type AuctionOrder } from "./call-auction.ts";

describe("uncross - basic crossing", () => {
  test("single crossing pair clears at the overlap", () => {
    const bids: AuctionOrder[] = [{ price: 101, quantity: 10 }];
    const asks: AuctionOrder[] = [{ price: 100, quantity: 10 }];
    const res = uncross(bids, asks);
    expect(res.volume).toBe(10);
    expect(res.price).toBeGreaterThanOrEqual(100);
    expect(res.price).toBeLessThanOrEqual(101);
  });

  test("no overlap -> no cross", () => {
    const bids: AuctionOrder[] = [{ price: 99, quantity: 10 }];
    const asks: AuctionOrder[] = [{ price: 100, quantity: 10 }];
    const res = uncross(bids, asks);
    expect(res.price).toBeNull();
    expect(res.volume).toBe(0);
  });

  test("empty side -> no cross", () => {
    expect(uncross([], [{ price: 100, quantity: 5 }]).volume).toBe(0);
    expect(uncross([{ price: 100, quantity: 5 }], []).price).toBeNull();
  });
});

describe("uncross - volume maximization", () => {
  test("picks the price that maximizes matched volume", () => {
    // Demand curve: at 100 -> 30, at 101 -> 20, at 102 -> 5
    const bids: AuctionOrder[] = [
      { price: 102, quantity: 5 },
      { price: 101, quantity: 15 },
      { price: 100, quantity: 10 },
    ];
    // Supply curve: at 100 -> 8, at 101 -> 20, at 102 -> 40
    const asks: AuctionOrder[] = [
      { price: 100, quantity: 8 },
      { price: 101, quantity: 12 },
      { price: 102, quantity: 20 },
    ];
    // matched: P=100 min(30,8)=8; P=101 min(20,20)=20; P=102 min(5,40)=5
    const res = uncross(bids, asks);
    expect(res.volume).toBe(20);
    expect(res.price).toBe(101);
    expect(res.imbalance).toBe(0);
  });

  test("ties on volume broken by minimum imbalance", () => {
    // Two prices reach the same matched volume; the one with lower |demand-supply| wins.
    const bids: AuctionOrder[] = [
      { price: 105, quantity: 10 },
      { price: 100, quantity: 10 },
    ];
    const asks: AuctionOrder[] = [
      { price: 100, quantity: 10 },
      { price: 105, quantity: 10 },
    ];
    // P=100: demand 20, supply 10 -> matched 10, imb 10
    // P=105: demand 10, supply 20 -> matched 10, imb 10 (symmetric) -> midpoint 102.5
    const res = uncross(bids, asks);
    expect(res.volume).toBe(10);
    expect(res.price).toBe(102.5);
  });
});

describe("uncross - market orders", () => {
  test("market buy lifts demand at every candidate", () => {
    const bids: AuctionOrder[] = [{ price: 0, quantity: 10, market: true }];
    const asks: AuctionOrder[] = [{ price: 100, quantity: 6 }];
    const res = uncross(bids, asks);
    expect(res.volume).toBe(6);
    expect(res.price).toBe(100);
  });

  test("market orders on both sides still need a limit price anchor", () => {
    const bids: AuctionOrder[] = [{ price: 0, quantity: 10, market: true }];
    const asks: AuctionOrder[] = [{ price: 0, quantity: 10, market: true }];
    // No limit prices at all -> no candidate price to clear at.
    expect(uncross(bids, asks).price).toBeNull();
  });
});

describe("uncross - hygiene", () => {
  test("non-positive quantities ignored", () => {
    const bids: AuctionOrder[] = [
      { price: 101, quantity: 0 },
      { price: 101, quantity: -5 },
      { price: 101, quantity: 10 },
    ];
    const asks: AuctionOrder[] = [{ price: 100, quantity: 10 }];
    expect(uncross(bids, asks).volume).toBe(10);
  });

  test("partial fill on the short side reports the smaller volume", () => {
    const bids: AuctionOrder[] = [{ price: 101, quantity: 100 }];
    const asks: AuctionOrder[] = [{ price: 100, quantity: 30 }];
    const res = uncross(bids, asks);
    expect(res.volume).toBe(30);
    expect(res.imbalance).toBe(70);
  });
});
