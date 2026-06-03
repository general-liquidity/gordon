import { describe, expect, test } from "bun:test";
import { computeInventoryOrderSize } from "./inventory-order-size.ts";

describe("computeInventoryOrderSize", () => {
  test("flat inventory keeps both sides at maxSize", () => {
    const r = computeInventoryOrderSize({ inventory: 0, maxSize: 100 });
    expect(r.bidSize).toBe(100);
    expect(r.askSize).toBe(100);
    expect(r.bidSize).toBe(r.askSize);
    expect(r.accumulationSide).toBe("none");
    expect(r.reductionFactor).toBe(1);
  });

  test("long shrinks the bid (accumulation side), keeps ask full", () => {
    const r = computeInventoryOrderSize({ inventory: 200, maxSize: 100, shape: 0.005 });
    expect(r.askSize).toBe(100);
    expect(r.bidSize).toBeCloseTo(100 * Math.exp(-1), 4);
    expect(r.bidSize).toBeCloseTo(36.787944, 4);
    expect(r.accumulationSide).toBe("bid");
  });

  test("short shrinks the ask (accumulation side), keeps bid full", () => {
    const r = computeInventoryOrderSize({ inventory: -200, maxSize: 100, shape: 0.005 });
    expect(r.bidSize).toBe(100);
    expect(r.askSize).toBeCloseTo(36.787944, 4);
    expect(r.accumulationSide).toBe("ask");
  });

  test("larger |inventory| produces a smaller reducing-side size (monotonic)", () => {
    const small = computeInventoryOrderSize({ inventory: 100, maxSize: 100 });
    const large = computeInventoryOrderSize({ inventory: 400, maxSize: 100 });
    expect(large.bidSize).toBeLessThan(small.bidSize);
    expect(large.reductionFactor).toBeLessThan(small.reductionFactor);
  });

  test("shape=0 disables the skew (factor 1, both sides full)", () => {
    const r = computeInventoryOrderSize({ inventory: 500, maxSize: 100, shape: 0 });
    expect(r.reductionFactor).toBe(1);
    expect(r.bidSize).toBe(100);
    expect(r.askSize).toBe(100);
  });

  test("non-positive maxSize returns a neutral result", () => {
    const r = computeInventoryOrderSize({ inventory: 200, maxSize: 0 });
    expect(r.interpretation).toBe("invalid inputs");
    expect(r.bidSize).toBe(0);
    expect(r.askSize).toBe(0);
    expect(r.reductionFactor).toBe(1);
    expect(r.accumulationSide).toBe("none");
  });
});
