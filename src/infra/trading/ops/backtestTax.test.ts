import { describe, it, expect } from "bun:test";

import {
  isBacktestTaxEnabled,
  applyBacktestTax,
  expectedRAfterTax,
  formatTaxedStats,
  taxToPayload,
  BACKTEST_TAX_FLAG_ENV,
} from "./backtestTax.ts";

describe("isBacktestTaxEnabled", () => {
  it("respects the flag", () => {
    expect(isBacktestTaxEnabled({})).toBe(false);
    expect(isBacktestTaxEnabled({ [BACKTEST_TAX_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("applyBacktestTax — defaults", () => {
  it("discounts win-rate by 15% and payoff by 25%", () => {
    const t = applyBacktestTax({ stats: { winRate: 0.58, payoffRatio: 1.3 } });
    expect(t.winRate).toBeCloseTo(0.58 * 0.85, 4);
    expect(t.payoffRatio).toBeCloseTo(1.3 * 0.75, 4);
    expect(t.rawWinRate).toBe(0.58);
    expect(t.rawPayoffRatio).toBe(1.3);
  });
});

describe("applyBacktestTax — custom fractions", () => {
  it("respects override of both fractions", () => {
    const t = applyBacktestTax({
      stats: { winRate: 0.6, payoffRatio: 2.0 },
      winRateTaxFraction: 0.2,
      payoffTaxFraction: 0.3,
    });
    expect(t.winRate).toBeCloseTo(0.48, 4);
    expect(t.payoffRatio).toBeCloseTo(1.4, 4);
  });

  it("respects 0% tax (passthrough)", () => {
    const t = applyBacktestTax({
      stats: { winRate: 0.6, payoffRatio: 2.0 },
      winRateTaxFraction: 0,
      payoffTaxFraction: 0,
    });
    expect(t.winRate).toBe(0.6);
    expect(t.payoffRatio).toBe(2.0);
  });

  it("clamps at zero (no negative win rates)", () => {
    const t = applyBacktestTax({
      stats: { winRate: 0.1, payoffRatio: 1.0 },
      winRateTaxFraction: 1.5,
      payoffTaxFraction: 1.5,
    });
    expect(t.winRate).toBe(0);
    expect(t.payoffRatio).toBe(0);
  });
});

describe("expectedRAfterTax", () => {
  it("computes EV in R-multiples", () => {
    const t = applyBacktestTax({
      stats: { winRate: 0.6, payoffRatio: 2.0 },
      winRateTaxFraction: 0,
      payoffTaxFraction: 0,
    });
    expect(expectedRAfterTax(t)).toBeCloseTo(0.6 * 2.0 - 0.4, 5);
  });

  it("a marginal strategy crosses negative once taxed", () => {
    const raw = { winRate: 0.55, payoffRatio: 1.1 };
    const untaxedT = applyBacktestTax({
      stats: raw,
      winRateTaxFraction: 0,
      payoffTaxFraction: 0,
    });
    expect(expectedRAfterTax(untaxedT)).toBeCloseTo(0.55 * 1.1 - 0.45, 4);
    expect(expectedRAfterTax(untaxedT)).toBeGreaterThan(0);
    const taxed = applyBacktestTax({ stats: raw });
    expect(expectedRAfterTax(taxed)).toBeLessThan(0);
  });
});

describe("Wright Ch 9 example", () => {
  it("backtest 58% / 1.3:1 → taxed parameters used for Kelly", () => {
    const t = applyBacktestTax({ stats: { winRate: 0.58, payoffRatio: 1.3 } });
    expect(t.winRate).toBeCloseTo(0.493, 3);
    expect(t.payoffRatio).toBeCloseTo(0.975, 3);
  });
});

describe("formatTaxedStats + taxToPayload", () => {
  it("formats human summary", () => {
    const t = applyBacktestTax({ stats: { winRate: 0.58, payoffRatio: 1.3 } });
    const out = formatTaxedStats(t);
    expect(out).toContain("Backtest tax applied");
    expect(out).toContain("Win rate:");
    expect(out).toContain("Payoff:");
    expect(out).toContain("Expected R after tax:");
  });

  it("payload stable shape", () => {
    const t = applyBacktestTax({ stats: { winRate: 0.6, payoffRatio: 2.0 } });
    const p = taxToPayload(t) as { kind: string };
    expect(p.kind).toBe("backtest_tax.applied");
  });
});
