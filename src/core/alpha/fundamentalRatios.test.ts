import { describe, expect, test } from "bun:test";
import { computeFundamentalRatios } from "./fundamentalRatios.ts";

describe("fundamentalRatios — ROIC family", () => {
  test("NOPAT = EBIT × (1 - tax_rate)", () => {
    const r = computeFundamentalRatios({ ebit: 1000, taxRate: 0.21 });
    expect(r.nopat).toBeCloseTo(790, 5);
  });

  test("ROIC = NOPAT / Invested Capital", () => {
    const r = computeFundamentalRatios({ ebit: 1000, taxRate: 0.21, investedCapital: 5000 });
    // NOPAT = 790; 790/5000 = 0.158
    expect(r.roic).toBeCloseTo(0.158, 3);
    expect(r.interpretation).toContain("ROIC");
  });

  test("ROIIC = ΔNOPAT / ΔInvestedCapital", () => {
    const r = computeFundamentalRatios({ deltaNopat: 200, deltaInvestedCapital: 1000 });
    expect(r.roiic).toBeCloseTo(0.2, 5);
  });

  test("ROIIC handles zero ΔInvestedCapital safely (null, no throw)", () => {
    const r = computeFundamentalRatios({ deltaNopat: 100, deltaInvestedCapital: 0 });
    expect(r.roiic).toBeNull();
  });

  test("ROIC null when investedCapital missing", () => {
    const r = computeFundamentalRatios({ ebit: 1000, taxRate: 0.21 });
    expect(r.roic).toBeNull();
    expect(r.nopat).not.toBeNull(); // NOPAT still computed
  });
});

describe("fundamentalRatios — equity multiples", () => {
  test("market cap = price × shares", () => {
    const r = computeFundamentalRatios({ price: 100, sharesOutstanding: 1_000_000 });
    expect(r.marketCap).toBe(100_000_000);
  });

  test("P/E = price / EPS", () => {
    const r = computeFundamentalRatios({ price: 100, eps: 5 });
    expect(r.peRatio).toBeCloseTo(20, 5);
  });

  test("ROE = net income / book equity", () => {
    const r = computeFundamentalRatios({ netIncome: 500, bookEquity: 2500 });
    expect(r.roe).toBeCloseTo(0.2, 5);
  });

  test("FCF yield = FCF / market cap", () => {
    const r = computeFundamentalRatios({
      fcf: 10_000_000,
      price: 100,
      sharesOutstanding: 1_000_000,
    });
    // marketCap = 100M; 10M / 100M = 10%
    expect(r.fcfYield).toBeCloseTo(0.1, 5);
  });

  test("zero EPS yields null P/E (no Infinity)", () => {
    const r = computeFundamentalRatios({ price: 100, eps: 0 });
    expect(r.peRatio).toBeNull();
  });
});

describe("fundamentalRatios — enterprise value", () => {
  test("EV = marketCap + totalDebt - cash", () => {
    const r = computeFundamentalRatios({
      price: 100,
      sharesOutstanding: 1_000_000,
      totalDebt: 50_000_000,
      cashAndEquivalents: 30_000_000,
    });
    // marketCap = 100M; EV = 100M + 50M - 30M = 120M
    expect(r.enterpriseValue).toBe(120_000_000);
  });

  test("netCash = cash - debt", () => {
    const r = computeFundamentalRatios({
      totalDebt: 50_000_000,
      cashAndEquivalents: 30_000_000,
    });
    expect(r.netCash).toBe(-20_000_000);
  });

  test("EV/EBITDA = EV / EBITDA", () => {
    const r = computeFundamentalRatios({
      price: 100,
      sharesOutstanding: 1_000_000,
      totalDebt: 50_000_000,
      cashAndEquivalents: 30_000_000,
      ebitda: 20_000_000,
    });
    // EV = 120M; 120M / 20M = 6x
    expect(r.evToEbitda).toBeCloseTo(6, 5);
  });

  test("EV null when net-debt inputs missing", () => {
    const r = computeFundamentalRatios({ price: 100, sharesOutstanding: 1_000_000 });
    expect(r.enterpriseValue).toBeNull();
  });
});

describe("fundamentalRatios — interpretation", () => {
  test("empty input yields the 'nothing computable' message", () => {
    const r = computeFundamentalRatios({});
    expect(r.interpretation).toContain("No ratios computable");
  });

  test("interpretation lists every computable ratio", () => {
    const r = computeFundamentalRatios({
      ebit: 1000,
      taxRate: 0.21,
      investedCapital: 5000,
      price: 100,
      eps: 5,
      ebitda: 200,
      fcf: 30,
      sharesOutstanding: 1,
      totalDebt: 100,
      cashAndEquivalents: 50,
      netIncome: 500,
      bookEquity: 2500,
    });
    expect(r.interpretation).toContain("ROIC");
    expect(r.interpretation).toContain("ROE");
    expect(r.interpretation).toContain("P/E");
    expect(r.interpretation).toContain("EV/EBITDA");
    expect(r.interpretation).toContain("FCF yield");
  });
});

describe("fundamentalRatios — defensiveness", () => {
  test("NaN inputs produce null, not NaN", () => {
    const r = computeFundamentalRatios({
      ebit: NaN,
      taxRate: 0.21,
      investedCapital: 1000,
    });
    expect(r.roic).toBeNull();
  });
});
