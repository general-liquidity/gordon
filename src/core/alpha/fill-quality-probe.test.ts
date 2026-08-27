import { describe, expect, test } from "bun:test";
import { analyzeFillQualityProbe, formatFillQualityProbe } from "./fill-quality-probe.ts";

describe("analyzeFillQualityProbe", () => {
  test("zero size → insufficient_data", () => {
    const r = analyzeFillQualityProbe({
      side: "BUY",
      intendedQty: 0,
      filledQty: 0,
      submitMidPrice: 100,
      avgFillPrice: 100,
      expectedSlippageBps: 5,
      latencyMs: 100,
      latencyBudgetMs: 500,
    });
    expect(r.verdict).toBe("insufficient_data");
  });

  test("aggressive demand: poor fill + heavy slippage + slow", () => {
    const r = analyzeFillQualityProbe({
      side: "BUY",
      intendedQty: 1000,
      filledQty: 400, // 40% — poor
      submitMidPrice: 100,
      avgFillPrice: 100.2, // 20bps slippage
      expectedSlippageBps: 5, // expected 5bps → 4× over
      latencyMs: 2000,
      latencyBudgetMs: 500, // 4× over
    });
    expect(r.verdict).toBe("aggressive_demand");
    expect(r.poorAxesCount).toBe(3);
    expect(r.demandScore).toBeCloseTo(1.0, 4);
  });

  test("easy fill: full + clean slippage + fast", () => {
    const r = analyzeFillQualityProbe({
      side: "BUY",
      intendedQty: 1000,
      filledQty: 1000, // 100%
      submitMidPrice: 100,
      avgFillPrice: 100.01, // 1bps
      expectedSlippageBps: 10,
      latencyMs: 100,
      latencyBudgetMs: 500, // 0.2× budget
    });
    expect(r.verdict).toBe("easy_fill");
    expect(r.cleanAxesCount).toBe(3);
    expect(r.demandScore).toBeCloseTo(0, 4);
  });

  test("neutral: one poor axis, two not-poor", () => {
    const r = analyzeFillQualityProbe({
      side: "BUY",
      intendedQty: 1000,
      filledQty: 800, // 80% — not poor, not clean
      submitMidPrice: 100,
      avgFillPrice: 100.05, // 5bps slippage, expected 5 → 1×, neutral
      expectedSlippageBps: 5,
      latencyMs: 600, // 1.2× budget — neutral
      latencyBudgetMs: 500,
    });
    expect(r.verdict).toBe("neutral_fill");
  });

  test("SELL side: slippage sign flips", () => {
    const r = analyzeFillQualityProbe({
      side: "SELL",
      intendedQty: 1000,
      filledQty: 300,
      submitMidPrice: 100,
      avgFillPrice: 99.8, // adverse for SELL = 20bps positive
      expectedSlippageBps: 5,
      latencyMs: 2000,
      latencyBudgetMs: 500,
    });
    expect(r.realizedSlippageBps).toBeCloseTo(20, 1);
    expect(r.verdict).toBe("aggressive_demand");
  });

  test("favorable fill price: negative slippage classified clean", () => {
    const r = analyzeFillQualityProbe({
      side: "BUY",
      intendedQty: 1000,
      filledQty: 1000,
      submitMidPrice: 100,
      avgFillPrice: 99.99, // BETTER than midpoint (negative slippage)
      expectedSlippageBps: 5,
      latencyMs: 100,
      latencyBudgetMs: 500,
    });
    expect(r.realizedSlippageBps).toBeLessThan(0);
    expect(r.axes.find((a) => a.axis === "slippage")!.classification).toBe("clean");
  });

  test("returns per-axis description strings", () => {
    const r = analyzeFillQualityProbe({
      side: "BUY",
      intendedQty: 1000,
      filledQty: 800,
      submitMidPrice: 100,
      avgFillPrice: 100.05,
      expectedSlippageBps: 5,
      latencyMs: 600,
      latencyBudgetMs: 500,
    });
    expect(r.axes.length).toBe(3);
    for (const a of r.axes) expect(a.description).toBeTruthy();
  });

  test("custom thresholds change verdict", () => {
    const input = {
      side: "BUY" as const,
      intendedQty: 1000,
      filledQty: 700,
      submitMidPrice: 100,
      avgFillPrice: 100.1,
      expectedSlippageBps: 5,
      latencyMs: 1000,
      latencyBudgetMs: 500,
    };
    const lax = analyzeFillQualityProbe(input);
    const strict = analyzeFillQualityProbe(input, {
      poorFillRatioThreshold: 0.85,
      poorSlippageMultiple: 1.5,
      poorLatencyMultiple: 1.5,
    });
    expect(strict.poorAxesCount).toBeGreaterThanOrEqual(lax.poorAxesCount);
  });
});

describe("formatFillQualityProbe", () => {
  test("renders verdict + axes", () => {
    const r = analyzeFillQualityProbe({
      side: "BUY",
      intendedQty: 1000,
      filledQty: 400,
      submitMidPrice: 100,
      avgFillPrice: 100.2,
      expectedSlippageBps: 5,
      latencyMs: 2000,
      latencyBudgetMs: 500,
    });
    const text = formatFillQualityProbe(r);
    expect(text).toContain("Fill-Quality Probe");
    expect(text).toContain("completeness");
    expect(text).toContain("slippage");
    expect(text).toContain("latency");
  });
});
