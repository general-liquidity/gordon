import { describe, expect, test } from "bun:test";
import { OrderBook, type Transaction } from "./lob.ts";

describe("OrderBook - resting and snapshot", () => {
  test("non-crossing orders rest and aggregate into levels", () => {
    const ob = new OrderBook();
    expect(ob.submit({ id: "b1", side: "buy", price: 99, quantity: 5 })).toEqual([]);
    expect(ob.submit({ id: "b2", side: "buy", price: 99, quantity: 3 })).toEqual([]);
    expect(ob.submit({ id: "a1", side: "sell", price: 101, quantity: 4 })).toEqual([]);

    const snap = ob.snapshot();
    expect(snap.bids).toEqual([{ price: 99, quantity: 8, orderCount: 2 }]);
    expect(snap.asks).toEqual([{ price: 101, quantity: 4, orderCount: 1 }]);
    expect(ob.bestBid()).toBe(99);
    expect(ob.bestAsk()).toBe(101);
    expect(ob.spread()).toBe(2);
  });

  test("bids sort high-to-low, asks low-to-high", () => {
    const ob = new OrderBook();
    ob.submit({ id: "b1", side: "buy", price: 98, quantity: 1 });
    ob.submit({ id: "b2", side: "buy", price: 100, quantity: 1 });
    ob.submit({ id: "b3", side: "buy", price: 99, quantity: 1 });
    ob.submit({ id: "a1", side: "sell", price: 103, quantity: 1 });
    ob.submit({ id: "a2", side: "sell", price: 101, quantity: 1 });
    ob.submit({ id: "a3", side: "sell", price: 102, quantity: 1 });

    const snap = ob.snapshot();
    expect(snap.bids.map((l) => l.price)).toEqual([100, 99, 98]);
    expect(snap.asks.map((l) => l.price)).toEqual([101, 102, 103]);
  });
});

describe("OrderBook - matching", () => {
  test("crossing limit order fills at the resting maker price", () => {
    const ob = new OrderBook();
    ob.submit({ id: "a1", side: "sell", price: 100, quantity: 10 });
    const txs = ob.submit({ id: "b1", side: "buy", price: 101, quantity: 6 });
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      makerId: "a1",
      takerId: "b1",
      price: 100,
      quantity: 6,
      aggressor: "buy",
    });
    // Resting ask partially consumed to 4; incoming buy fully filled (nothing rests).
    expect(ob.snapshot().asks).toEqual([{ price: 100, quantity: 4, orderCount: 1 }]);
    expect(ob.snapshot().bids).toEqual([]);
  });

  test("partial fill: taker larger than book rests the remainder", () => {
    const ob = new OrderBook();
    ob.submit({ id: "a1", side: "sell", price: 100, quantity: 4 });
    const txs = ob.submit({ id: "b1", side: "buy", price: 100, quantity: 10 });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.quantity).toBe(4);
    expect(ob.snapshot().asks).toEqual([]);
    // 6 remaining rests on the bid at 100.
    expect(ob.snapshot().bids).toEqual([{ price: 100, quantity: 6, orderCount: 1 }]);
  });

  test("walks the book across multiple price-time levels", () => {
    const ob = new OrderBook();
    ob.submit({ id: "a1", side: "sell", price: 100, quantity: 3 });
    ob.submit({ id: "a2", side: "sell", price: 100, quantity: 2 }); // same price, later
    ob.submit({ id: "a3", side: "sell", price: 101, quantity: 5 });
    const txs = ob.submit({ id: "b1", side: "buy", price: 101, quantity: 8 });

    // Price-time: a1(100) -> a2(100) -> a3(101), quantities 3,2,3
    expect(txs.map((t: Transaction) => [t.makerId, t.price, t.quantity])).toEqual([
      ["a1", 100, 3],
      ["a2", 100, 2],
      ["a3", 101, 3],
    ]);
    // Trade sequence is monotonic.
    expect(txs.map((t) => t.sequence)).toEqual([0, 1, 2]);
    expect(ob.snapshot().asks).toEqual([{ price: 101, quantity: 2, orderCount: 1 }]);
  });

  test("time priority: earlier order at the same price fills first", () => {
    const ob = new OrderBook();
    ob.submit({ id: "early", side: "buy", price: 100, quantity: 5 });
    ob.submit({ id: "late", side: "buy", price: 100, quantity: 5 });
    const txs = ob.submit({ id: "s1", side: "sell", price: 100, quantity: 5 });
    expect(txs).toHaveLength(1);
    expect(txs[0]!.makerId).toBe("early");
  });

  test("non-marketable limit does not cross", () => {
    const ob = new OrderBook();
    ob.submit({ id: "a1", side: "sell", price: 101, quantity: 5 });
    const txs = ob.submit({ id: "b1", side: "buy", price: 100, quantity: 5 });
    expect(txs).toEqual([]);
    expect(ob.snapshot().bids).toEqual([{ price: 100, quantity: 5, orderCount: 1 }]);
  });
});

describe("OrderBook - market orders", () => {
  test("market buy sweeps regardless of price and discards remainder", () => {
    const ob = new OrderBook();
    ob.submit({ id: "a1", side: "sell", price: 100, quantity: 2 });
    ob.submit({ id: "a2", side: "sell", price: 105, quantity: 2 });
    const txs = ob.submit({ id: "m1", side: "buy", price: 0, quantity: 10, type: "market" });
    expect(txs.map((t) => [t.price, t.quantity])).toEqual([
      [100, 2],
      [105, 2],
    ]);
    // Book fully consumed; 6 leftover discarded (market orders do not rest).
    expect(ob.snapshot().asks).toEqual([]);
    expect(ob.snapshot().bids).toEqual([]);
  });
});

describe("OrderBook - cancels", () => {
  test("cancel removes a resting order and returns true", () => {
    const ob = new OrderBook();
    ob.submit({ id: "b1", side: "buy", price: 99, quantity: 5 });
    ob.submit({ id: "b2", side: "buy", price: 99, quantity: 5 });
    expect(ob.cancel("b1")).toBe(true);
    expect(ob.snapshot().bids).toEqual([{ price: 99, quantity: 5, orderCount: 1 }]);
    // Cancelled order no longer participates in matching.
    const txs = ob.submit({ id: "s1", side: "sell", price: 99, quantity: 5 });
    expect(txs[0]!.makerId).toBe("b2");
  });

  test("cancel of an unknown id returns false", () => {
    const ob = new OrderBook();
    expect(ob.cancel("nope")).toBe(false);
  });
});

describe("OrderBook - determinism", () => {
  test("identical order streams yield identical transactions and book", () => {
    const stream = () => {
      const ob = new OrderBook();
      const out: Transaction[] = [];
      out.push(...ob.submit({ id: "a1", side: "sell", price: 100, quantity: 5 }));
      out.push(...ob.submit({ id: "a2", side: "sell", price: 101, quantity: 5 }));
      out.push(...ob.submit({ id: "b1", side: "buy", price: 100, quantity: 3 }));
      ob.cancel("a2");
      out.push(...ob.submit({ id: "b2", side: "buy", price: 102, quantity: 4 }));
      return { out, snap: ob.snapshot() };
    };
    const a = stream();
    const b = stream();
    expect(a.out).toEqual(b.out);
    expect(a.snap).toEqual(b.snap);
  });

  test("snapshot depth caps levels per side", () => {
    const ob = new OrderBook();
    for (let i = 0; i < 5; i++) {
      ob.submit({ id: `b${i}`, side: "buy", price: 100 - i, quantity: 1 });
    }
    expect(ob.snapshot(2).bids.map((l) => l.price)).toEqual([100, 99]);
  });
});
