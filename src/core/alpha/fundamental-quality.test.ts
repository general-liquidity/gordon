import { describe, expect, it } from "bun:test";
import { computeFundamentalQuality, computeWACC } from "./fundamental-quality.ts";

describe("computeFundamentalQuality", () => {
  it("Rule of 40 = growth% + FCF-margin%, passes at ≥40", () => {
    const r = computeFundamentalQuality({ revenue: 100, revenueGrowthPct: 25, freeCashFlow: 20 });
    expect(r.fcfMarginPct).toBe(20);
    expect(r.ruleOf40).toBe(45);
    expect(r.ruleOf40Pass).toBe(true);
  });

  it("Rule of 40 fails below 40", () => {
    const r = computeFundamentalQuality({ revenue: 100, revenueGrowthPct: 25, freeCashFlow: 10 });
    expect(r.ruleOf40).toBe(35);
    expect(r.ruleOf40Pass).toBe(false);
  });

  it("derives growth from priorRevenue", () => {
    const r = computeFundamentalQuality({ revenue: 120, priorRevenue: 100, freeCashFlow: 24 });
    expect(r.revenueGrowthPct).toBe(20);
    expect(r.ruleOf40).toBe(40); // 20 + 20
  });

  it("computes FCF conversion (FCF/NI) and FCF/OCF", () => {
    const r = computeFundamentalQuality({ revenue: 100, freeCashFlow: 20, netIncome: 25, operatingCashFlow: 30 });
    expect(r.fcfConversion).toBe(0.8);
    expect(r.fcfToOcf).toBeCloseTo(0.667, 2);
  });

  it("computes DSO/DIO/DPO and the cash-conversion cycle", () => {
    // daysInPeriod=365: revenue 365 → 1/day; AR 30 → DSO 30; cogs 365, inv 73 → DIO 73; AP 36.5 → DPO 36.5.
    const r = computeFundamentalQuality({ revenue: 365, cogs: 365, accountsReceivable: 30, inventory: 73, accountsPayable: 36.5 });
    expect(r.dso).toBe(30);
    expect(r.dio).toBe(73);
    expect(r.dpo).toBe(36.5);
    expect(r.cashConversionCycle).toBe(66.5); // 30 + 73 − 36.5
  });

  it("returns null metrics when inputs are missing (no wrong numbers)", () => {
    const r = computeFundamentalQuality({ revenue: 100 });
    expect(r.ruleOf40).toBeNull();
    expect(r.cashConversionCycle).toBeNull();
    expect(r.interpretation).toContain("insufficient");
  });
});

describe("computeWACC", () => {
  it("builds Ke via CAPM and market-weights into WACC", () => {
    const r = computeWACC({
      riskFreeRate: 0.04, beta: 1.2, equityRiskPremium: 0.05,
      marketCapEquity: 800, marketValueDebt: 200, costOfDebt: 0.06, taxRate: 0.21,
    });
    expect(r.costOfEquity).toBeCloseTo(0.1, 5); // 0.04 + 1.2·0.05
    expect(r.afterTaxCostOfDebt).toBeCloseTo(0.0474, 5); // 0.06·0.79
    expect(r.weightEquity).toBe(0.8);
    expect(r.wacc).toBeCloseTo(0.08948, 4); // 0.8·0.10 + 0.2·0.0474
    expect(r.valid).toBe(true);
  });

  it("adds a size/country premium to cost of equity", () => {
    const r = computeWACC({
      riskFreeRate: 0.04, beta: 1, equityRiskPremium: 0.05, additionalPremium: 0.02,
      marketCapEquity: 100, marketValueDebt: 0, costOfDebt: 0, taxRate: 0.21,
    });
    expect(r.costOfEquity).toBeCloseTo(0.11, 5); // 0.04 + 0.05 + 0.02
    expect(r.wacc).toBeCloseTo(0.11, 5); // all-equity
  });

  it("invalid when E+D ≤ 0", () => {
    expect(computeWACC({ riskFreeRate: 0.04, beta: 1, equityRiskPremium: 0.05, marketCapEquity: 0, marketValueDebt: 0, costOfDebt: 0.05, taxRate: 0.2 }).valid).toBe(false);
  });
});
