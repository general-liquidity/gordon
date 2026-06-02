import { describe, expect, test } from "bun:test";
import { calculateMomentum, calculateROC } from "./momentum-roc.ts";

describe("Momentum", () => {
  test("known series period 2: close - close[t-2]", () => {
    // closes [10, 11, 13, 16]; period 2
    // idx2: 13-10=3; idx3: 16-11=5
    const m = calculateMomentum([10, 11, 13, 16], 2);
    expect(m[0]).toBeNull();
    expect(m[1]).toBeNull();
    expect(m[2]).toBeCloseTo(3, 6);
    expect(m[3]).toBeCloseTo(5, 6);
  });

  test("flat series → momentum 0 once warm", () => {
    const m = calculateMomentum([5, 5, 5, 5], 2);
    expect(m[3]).toBeCloseTo(0, 6);
  });

  test("insufficient data → all null", () => {
    expect(calculateMomentum([1, 2], 2).every((v) => v === null)).toBe(true);
  });
});

describe("ROC", () => {
  test("known series period 2: (close/close[t-2] - 1)*100", () => {
    // closes [10, 11, 20, 22]; period 2
    // idx2: (20/10 - 1)*100 = 100; idx3: (22/11 - 1)*100 = 100
    const r = calculateROC([10, 11, 20, 22], 2);
    expect(r[0]).toBeNull();
    expect(r[1]).toBeNull();
    expect(r[2]).toBeCloseTo(100, 6);
    expect(r[3]).toBeCloseTo(100, 6);
  });

  test("decline gives negative ROC", () => {
    // closes [10, 10, 5]; period 2 → (5/10-1)*100 = -50
    const r = calculateROC([10, 10, 5], 2);
    expect(r[2]).toBeCloseTo(-50, 6);
  });

  test("zero base price → null (no divide-by-zero)", () => {
    const r = calculateROC([0, 5, 8], 2);
    expect(r[2]).toBeNull();
  });

  test("insufficient data → all null", () => {
    expect(calculateROC([1, 2], 2).every((v) => v === null)).toBe(true);
  });
});
