import { describe, expect, it } from "bun:test";
import { computeOuOptimalThresholds } from "./ouOptimalThresholds.ts";

describe("computeOuOptimalThresholds — Bertram (2010) symmetric OU band", () => {
  it("(1) theta>0, sigma>0, cost=0 → finite positive a in (0,4], entryLong<mu<entryShort", () => {
    const res = computeOuOptimalThresholds({ theta: 1, mu: 100, sigma: 2 });
    expect(Number.isFinite(res.dimensionlessEntry)).toBe(true);
    expect(res.dimensionlessEntry).toBeGreaterThan(0);
    expect(res.dimensionlessEntry).toBeLessThanOrEqual(4);
    expect(res.entryLong).toBeLessThan(100);
    expect(res.entryShort).toBeGreaterThan(100);
    expect(res.exitLong).toBe(100);
    expect(res.exitShort).toBe(100);
    expect(res.expectedReturnPerUnitTime).toBeGreaterThan(0);
    expect(res.expectedCycleTime).toBeGreaterThan(0);
  });

  it("(2) higher transactionCost → wider dimensionless entry (monotonic)", () => {
    const base = { theta: 1, mu: 100, sigma: 2 };
    const noCost = computeOuOptimalThresholds({ ...base, transactionCost: 0 });
    const midCost = computeOuOptimalThresholds({ ...base, transactionCost: 0.25 });
    const highCost = computeOuOptimalThresholds({ ...base, transactionCost: 0.5 });
    expect(midCost.dimensionlessEntry).toBeGreaterThan(noCost.dimensionlessEntry);
    expect(highCost.dimensionlessEntry).toBeGreaterThan(midCost.dimensionlessEntry);
  });

  it("(3) faster mean reversion (larger theta, same sigma) → levels closer to mu in price units", () => {
    const slow = computeOuOptimalThresholds({ theta: 0.5, mu: 100, sigma: 2 });
    const fast = computeOuOptimalThresholds({ theta: 4, mu: 100, sigma: 2 });
    const slowBand = 100 - slow.entryLong;
    const fastBand = 100 - fast.entryLong;
    expect(slowBand).toBeGreaterThan(0);
    expect(fastBand).toBeGreaterThan(0);
    expect(fastBand).toBeLessThan(slowBand);
  });

  it("(4) theta<=0 → neutral", () => {
    const res = computeOuOptimalThresholds({ theta: 0, mu: 100, sigma: 2 });
    expect(res.dimensionlessEntry).toBe(0);
    expect(res.entryLong).toBe(100);
    expect(res.exitLong).toBe(100);
    expect(res.entryShort).toBe(100);
    expect(res.expectedReturnPerUnitTime).toBe(0);
    expect(res.interpretation).toContain("Neutral");

    const negSigma = computeOuOptimalThresholds({ theta: 1, mu: 100, sigma: -1 });
    expect(negSigma.dimensionlessEntry).toBe(0);
    expect(negSigma.interpretation).toContain("Neutral");
  });
});
