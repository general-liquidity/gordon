import { describe, it, expect } from "bun:test";
import { PositionSizer } from "./position-sizer.ts";

describe("PositionSizer.calculateWithKelly — cost-aware", () => {
  const sizer = new PositionSizer();

  it("matches legacy behavior when transactionCostBps is 0", () => {
    const result = sizer.calculateWithKelly(10_000, 0.6, 0.02, 0.01, 0);
    expect(result.kellyPercent).toBeGreaterThan(0);
    expect(result.costAdjustment).toBeUndefined();
  });

  it("matches legacy behavior when transactionCostBps is omitted", () => {
    const result = sizer.calculateWithKelly(10_000, 0.6, 0.02, 0.01);
    expect(result.kellyPercent).toBeGreaterThan(0);
    expect(result.costAdjustment).toBeUndefined();
  });

  it("reduces Kelly size when transactionCostBps > 0", () => {
    const gross = sizer.calculateWithKelly(10_000, 0.6, 0.02, 0.01, 0);
    const net = sizer.calculateWithKelly(10_000, 0.6, 0.02, 0.01, 30);
    expect(net.kellyPercent).toBeLessThan(gross.kellyPercent);
    expect(net.positionSize).toBeLessThan(gross.positionSize);
  });

  it("surfaces costAdjustment block with raw vs net values", () => {
    const result = sizer.calculateWithKelly(10_000, 0.6, 0.02, 0.01, 50);
    expect(result.costAdjustment).toBeDefined();
    expect(result.costAdjustment!.transactionCostBps).toBe(50);
    expect(result.costAdjustment!.rawWin).toBe(0.02);
    expect(result.costAdjustment!.rawLoss).toBe(0.01);
    // 50 bps round-trip = 100 bps total = 0.01 deduction
    expect(result.costAdjustment!.netWin).toBeCloseTo(0.01, 4);
    expect(result.costAdjustment!.netLoss).toBeCloseTo(0.02, 4);
  });

  it("flips to negative when cost-adjusted edge is non-positive", () => {
    // 20bp gross edge — 30bp round-trip cost would eat it twice over.
    const result = sizer.calculateWithKelly(10_000, 0.6, 0.002, 0.001, 30);
    expect(result.kellyPercent).toBe(0);
    expect(result.adjustedPercent).toBe(0);
    expect(result.positionSize).toBe(0);
    expect(result.costAdjustment!.flipsToNegative).toBe(true);
    expect(result.recommendation).toContain("Cost-adjusted edge is negative");
  });

  it("preserves trade when cost adjustment is bearable", () => {
    // Healthy 200bp gross win / 100bp gross loss vs 10bp round-trip cost
    const result = sizer.calculateWithKelly(10_000, 0.6, 0.02, 0.01, 10);
    expect(result.kellyPercent).toBeGreaterThan(0);
    expect(result.costAdjustment!.flipsToNegative).toBe(false);
    expect(result.costAdjustment!.grossKellyPercent).toBeGreaterThan(result.kellyPercent);
  });

  it("recommendation distinguishes cost-adjusted vs raw Kelly when both positive", () => {
    const result = sizer.calculateWithKelly(10_000, 0.6, 0.02, 0.01, 20);
    expect(result.kellyPercent).toBeGreaterThan(0);
    expect(result.recommendation).toContain("Cost-adjusted Kelly");
    expect(result.recommendation).toContain("gross");
  });

  it("respects the 25% cap even with cost adjustment", () => {
    // Extreme win rate / huge edge that would blow past 25% raw
    const result = sizer.calculateWithKelly(10_000, 0.95, 0.1, 0.01, 5);
    expect(result.adjustedPercent).toBeLessThanOrEqual(25);
    expect(result.positionSize).toBeLessThanOrEqual(2500);
  });

  it("returns 0 sizing when winRate is 0 or 1 or avgLoss is 0 (legacy invariant)", () => {
    expect(sizer.calculateWithKelly(10_000, 0, 0.02, 0.01).kellyPercent).toBe(0);
    expect(sizer.calculateWithKelly(10_000, 1, 0.02, 0.01).kellyPercent).toBe(0);
    expect(sizer.calculateWithKelly(10_000, 0.5, 0.02, 0).kellyPercent).toBe(0);
  });
});
