import { describe, expect, it } from "bun:test";
import { microprice, orderBookImbalance, topOfBookSpread, weightedMid } from "./book-imbalance.ts";

describe("orderBookImbalance", () => {
  it("balanced book → 0", () => {
    expect(orderBookImbalance([10, 5], [10, 5])).toBe(0);
  });

  it("bid-heavy book → positive", () => {
    expect(orderBookImbalance([30, 10], [10, 5])).toBeGreaterThan(0);
  });

  it("ask-heavy book → negative", () => {
    expect(orderBookImbalance([10, 5], [30, 10])).toBeLessThan(0);
  });

  it("stays within [-1, +1]", () => {
    expect(orderBookImbalance([100], [0])).toBe(1);
    expect(orderBookImbalance([0], [100])).toBe(-1);
  });

  it("empty / zero-size book → 0", () => {
    expect(orderBookImbalance([], [])).toBe(0);
    expect(orderBookImbalance([0, 0], [0])).toBe(0);
  });

  it("depth-weighting weights nearer levels more", () => {
    // Top of book is ask-heavy, far level is bid-heavy.
    // Flat sum: bid=100, ask=100 → 0. Weighted: top (ask) dominates → negative.
    const flat = orderBookImbalance([0, 100], [100, 0], { depthWeighted: false });
    const weighted = orderBookImbalance([0, 100], [100, 0], { depthWeighted: true });
    expect(flat).toBe(0);
    expect(weighted).toBeLessThan(0);
  });

  it("clamps negative sizes to 0", () => {
    expect(orderBookImbalance([10], [-5])).toBe(1);
  });
});

describe("microprice", () => {
  it("balanced book → equals the mid", () => {
    const mp = microprice([100], [10], [102], [10]);
    expect(mp).toBeCloseTo(101, 9);
    expect(mp).toBeCloseTo(weightedMid([100], [102]), 9);
  });

  it("bid-heavy book → microprice ABOVE mid (leans to thicker bid)", () => {
    const mid = weightedMid([100], [102]);
    const mp = microprice([100], [30], [102], [10]);
    expect(mp).toBeGreaterThan(mid);
  });

  it("ask-heavy book → microprice BELOW mid (leans to thicker ask)", () => {
    const mid = weightedMid([100], [102]);
    const mp = microprice([100], [10], [102], [30]);
    expect(mp).toBeLessThan(mid);
  });

  it("empty-side guards", () => {
    expect(microprice([], [], [], [])).toBe(0);
    expect(microprice([100], [10], [], [])).toBe(100); // ask empty → best bid
    expect(microprice([], [], [102], [10])).toBe(102); // bid empty → best ask
    // both present but zero size → falls back to plain mid
    expect(microprice([100], [0], [102], [0])).toBeCloseTo(101, 9);
  });
});

describe("topOfBookSpread", () => {
  it("returns bestAsk − bestBid", () => {
    expect(topOfBookSpread([100], [102])).toBeCloseTo(2, 9);
  });

  it("NaN when a side is empty", () => {
    expect(topOfBookSpread([], [102])).toBeNaN();
    expect(topOfBookSpread([100], [])).toBeNaN();
  });
});

describe("weightedMid", () => {
  it("plain mid of top of book", () => {
    expect(weightedMid([100], [102])).toBeCloseTo(101, 9);
  });

  it("one side empty → available side; both empty → 0", () => {
    expect(weightedMid([100], [])).toBe(100);
    expect(weightedMid([], [102])).toBe(102);
    expect(weightedMid([], [])).toBe(0);
  });
});
