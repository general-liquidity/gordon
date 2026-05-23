import { describe, it, expect } from "bun:test";
import {
  estimateExpectedReturn,
  formatExpectedReturn,
  DEFAULT_EQUITY_REGIME_ADJUSTMENTS,
} from "./expected-return.ts";

const HIST_12 = Array.from({ length: 12 }, () => 0.08); // flat 8% returns

describe("estimateExpectedReturn — basic shape", () => {
  it("returns all three method results", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 17, metricType: "shiller_pe" },
      regime: "expansion",
    });
    expect(r.methods.length).toBe(3);
    const names = r.methods.map((m) => m.name).sort();
    expect(names).toEqual(["historical", "regime_adjusted", "valuation_implied"]);
  });

  it("includes weights summing to 1", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 17, metricType: "shiller_pe" },
      regime: "expansion",
    });
    const sum = r.weights.historical + r.weights.valuation + r.weights.regime;
    expect(sum).toBeCloseTo(1, 6);
  });

  it("normalizes operator-supplied weights to sum to 1", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 17, metricType: "shiller_pe" },
      regime: "expansion",
      weights: { historical: 2, valuation: 4, regime: 4 },
    });
    const sum = r.weights.historical + r.weights.valuation + r.weights.regime;
    expect(sum).toBeCloseTo(1, 6);
    expect(r.weights.valuation).toBeCloseTo(0.4, 4);
  });
});

describe("estimateExpectedReturn — historical method", () => {
  it("computes arithmetic mean of historical returns", () => {
    const returns = [0.1, 0.2, 0.0, -0.1, 0.15];
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: returns,
      valuation: { metric: 0.05, metricType: "operator_supplied" },
      regime: "unknown",
    });
    const hist = r.methods.find((m) => m.name === "historical")!;
    expect(hist.estimate).toBeCloseTo(0.07, 4);
  });

  it("flags insufficient historical data when < 12 obs", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: [0.1, 0.2],
      valuation: { metric: 0.05, metricType: "operator_supplied" },
      regime: "expansion",
    });
    expect(r.flags.some((f) => f.includes("Insufficient historical"))).toBe(true);
  });
});

describe("estimateExpectedReturn — valuation-implied method", () => {
  it("operator_supplied returns the input directly", () => {
    const r = estimateExpectedReturn({
      assetClass: "commodity",
      historicalReturns: HIST_12,
      valuation: { metric: 0.06, metricType: "operator_supplied" },
      regime: "expansion",
    });
    const val = r.methods.find((m) => m.name === "valuation_implied")!;
    expect(val.estimate).toBe(0.06);
  });

  it("yield_to_maturity returns the YTM directly", () => {
    const r = estimateExpectedReturn({
      assetClass: "bond",
      historicalReturns: HIST_12,
      valuation: { metric: 0.045, metricType: "yield_to_maturity" },
      regime: "late_cycle",
    });
    const val = r.methods.find((m) => m.name === "valuation_implied")!;
    expect(val.estimate).toBe(0.045);
    expect(val.reasoning).toContain("Yield-to-maturity");
  });

  it("shiller_pe at long-run mean yields ~earnings yield + inflation", () => {
    // CAPE = 17 = long-run mean → valuation_change = 0 → return = 1/17 + inflation
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: {
        metric: 17,
        metricType: "shiller_pe",
        longRunMean: 17,
        expectedInflation: 0.025,
      },
      regime: "expansion",
    });
    const val = r.methods.find((m) => m.name === "valuation_implied")!;
    // earnings yield 1/17 ≈ 0.0588; plus inflation 0.025 = 0.0838
    expect(val.estimate).toBeCloseTo(1 / 17 + 0.025, 3);
  });

  it("shiller_pe above long-run mean produces lower expected return", () => {
    // CAPE = 32 (expensive), long-run = 17, mean revert over 10yr → drag on returns
    const expensive = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 32, metricType: "shiller_pe" },
      regime: "late_cycle",
    });
    const fair = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 17, metricType: "shiller_pe" },
      regime: "late_cycle",
    });
    const expValVal = expensive.methods.find((m) => m.name === "valuation_implied")!;
    const fairValVal = fair.methods.find((m) => m.name === "valuation_implied")!;
    expect(expValVal.estimate).toBeLessThan(fairValVal.estimate);
  });

  it("handles invalid CAPE gracefully", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 0, metricType: "shiller_pe" },
      regime: "expansion",
    });
    const val = r.methods.find((m) => m.name === "valuation_implied")!;
    expect(val.estimate).toBe(0);
    expect(val.reasoning).toContain("Invalid CAPE");
  });
});

describe("estimateExpectedReturn — regime-adjusted method", () => {
  it("applies expansion multiplier above 1 → higher than historical", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 0.05, metricType: "operator_supplied" },
      regime: "expansion",
    });
    const reg = r.methods.find((m) => m.name === "regime_adjusted")!;
    expect(reg.estimate).toBeGreaterThan(0.08);
    expect(reg.estimate).toBeCloseTo(0.08 * DEFAULT_EQUITY_REGIME_ADJUSTMENTS.expansion, 6);
  });

  it("applies recession multiplier below 1 → lower than historical", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 0.05, metricType: "operator_supplied" },
      regime: "recession",
    });
    const reg = r.methods.find((m) => m.name === "regime_adjusted")!;
    expect(reg.estimate).toBeLessThan(0.08);
  });

  it("unknown regime yields no adjustment + flag", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 0.05, metricType: "operator_supplied" },
      regime: "unknown",
    });
    const reg = r.methods.find((m) => m.name === "regime_adjusted")!;
    expect(reg.estimate).toBeCloseTo(0.08, 4);
    expect(r.flags.some((f) => f.toLowerCase().includes("unknown"))).toBe(true);
  });

  it("honors regime adjustment overrides", () => {
    const r = estimateExpectedReturn({
      assetClass: "bond",
      historicalReturns: HIST_12,
      valuation: { metric: 0.04, metricType: "yield_to_maturity" },
      regime: "recession",
      regimeAdjustments: { recession: 1.5 }, // bonds rally in recession
    });
    const reg = r.methods.find((m) => m.name === "regime_adjusted")!;
    expect(reg.estimate).toBeCloseTo(0.08 * 1.5, 6);
  });
});

describe("estimateExpectedReturn — composite", () => {
  it("composite is weighted blend of three methods", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 0.10, metricType: "operator_supplied" },
      regime: "expansion",
      weights: { historical: 0, valuation: 1, regime: 0 },
    });
    expect(r.composite).toBeCloseTo(0.10, 4);
  });

  it("100% historical weight yields the historical estimate", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 0.10, metricType: "operator_supplied" },
      regime: "expansion",
      weights: { historical: 1, valuation: 0, regime: 0 },
    });
    expect(r.composite).toBeCloseTo(0.08, 4);
  });
});

describe("estimateExpectedReturn — divergence flags", () => {
  it("flags when methods diverge by more than threshold", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12, // ~8%
      valuation: { metric: 0.0, metricType: "operator_supplied" }, // 0%
      regime: "recession",
      divergenceThreshold: 0.03,
    });
    expect(r.methodDivergenceBps).toBeGreaterThan(300);
    expect(r.flags.some((f) => f.includes("divergence"))).toBe(true);
  });

  it("flags historical-vs-valuation gap separately", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12, // ~8%
      valuation: { metric: 0.0, metricType: "operator_supplied" }, // 0%
      regime: "expansion",
      divergenceThreshold: 0.05,
    });
    expect(r.historicalVsValuationBps).toBeGreaterThan(500);
    expect(r.flags.some((f) => f.includes("Historical vs valuation"))).toBe(true);
  });

  it("no divergence flag when methods agree", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12, // 8%
      valuation: { metric: 0.08, metricType: "operator_supplied" }, // 8%
      regime: "unknown", // multiplier = 1.0, regime = 8%
    });
    expect(r.flags.some((f) => f.includes("divergence"))).toBe(false);
  });
});

describe("estimateExpectedReturn — the article's example", () => {
  it("expensive equity in late cycle: historical 13%, valuation 5%, regime adjusts down", () => {
    // Approximating the article's anecdote: US equities, ~13% historical avg,
    // CAPE ~32 (expensive), late-cycle regime
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: Array.from({ length: 20 }, () => 0.132),
      valuation: { metric: 32, metricType: "shiller_pe", longRunMean: 17 },
      regime: "late_cycle",
    });
    const hist = r.methods.find((m) => m.name === "historical")!;
    const val = r.methods.find((m) => m.name === "valuation_implied")!;
    const reg = r.methods.find((m) => m.name === "regime_adjusted")!;

    expect(hist.estimate).toBeCloseTo(0.132, 3);
    expect(val.estimate).toBeLessThan(hist.estimate); // expensive → val lower
    expect(reg.estimate).toBeLessThan(hist.estimate); // late_cycle → reg lower
    // Should fire the "widest historical-vs-valuation gap" flag
    expect(r.historicalVsValuationBps).toBeGreaterThan(500);
  });
});

describe("formatExpectedReturn", () => {
  it("renders composite + per-method + weights + divergence", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: HIST_12,
      valuation: { metric: 17, metricType: "shiller_pe" },
      regime: "expansion",
    });
    const text = formatExpectedReturn(r);
    expect(text).toContain("Composite expected return");
    expect(text).toContain("historical");
    expect(text).toContain("valuation_implied");
    expect(text).toContain("regime_adjusted");
    expect(text).toContain("Weights");
    expect(text).toContain("Method divergence");
  });

  it("includes Flags section when flags fire", () => {
    const r = estimateExpectedReturn({
      assetClass: "equity",
      historicalReturns: [0.08, 0.09],
      valuation: { metric: 0.0, metricType: "operator_supplied" },
      regime: "unknown",
    });
    const text = formatExpectedReturn(r);
    expect(text).toContain("Flags");
    expect(text).toContain("⚠");
  });
});
