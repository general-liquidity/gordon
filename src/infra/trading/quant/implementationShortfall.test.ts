import { describe, it, expect } from "bun:test";
import {
  computeImplementationShortfall,
  implementationShortfallToPayload,
} from "./implementationShortfall.ts";

describe("computeImplementationShortfall — basic invariants", () => {
  it("zero cost when decision = arrival = fill = close and no fees", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 100,
      avgFillPrice: 100,
      closePrice: 100,
      decisionQuantity: 1000,
      filledQuantity: 1000,
      side: "BUY",
    });
    expect(r.totalCost).toBe(0);
    expect(r.delayCost).toBe(0);
    expect(r.marketImpactCost).toBe(0);
    expect(r.opportunityCost).toBe(0);
    expect(r.fees).toBe(0);
  });

  it("rejects negative or out-of-range fill quantities", () => {
    expect(() =>
      computeImplementationShortfall({
        decisionPrice: 100,
        arrivalPrice: 100,
        avgFillPrice: 100,
        closePrice: 100,
        decisionQuantity: 1000,
        filledQuantity: -1,
        side: "BUY",
      }),
    ).toThrow();
    expect(() =>
      computeImplementationShortfall({
        decisionPrice: 100,
        arrivalPrice: 100,
        avgFillPrice: 100,
        closePrice: 100,
        decisionQuantity: 1000,
        filledQuantity: 1001,
        side: "BUY",
      }),
    ).toThrow();
  });

  it("rejects non-positive decision quantity or price", () => {
    expect(() =>
      computeImplementationShortfall({
        decisionPrice: 100,
        arrivalPrice: 100,
        avgFillPrice: 100,
        closePrice: 100,
        decisionQuantity: 0,
        filledQuantity: 0,
        side: "BUY",
      }),
    ).toThrow();
    expect(() =>
      computeImplementationShortfall({
        decisionPrice: 0,
        arrivalPrice: 100,
        avgFillPrice: 100,
        closePrice: 100,
        decisionQuantity: 1000,
        filledQuantity: 1000,
        side: "BUY",
      }),
    ).toThrow();
  });
});

describe("computeImplementationShortfall — BUY decomposition", () => {
  it("delay cost when arrival > decision (market moved up before we acted)", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 101,
      avgFillPrice: 101,
      closePrice: 101,
      decisionQuantity: 1000,
      filledQuantity: 1000,
      side: "BUY",
    });
    // delay = (101 - 100) * 1000 = 1000
    expect(r.delayCost).toBeCloseTo(1000, 6);
    expect(r.marketImpactCost).toBeCloseTo(0, 6);
    expect(r.opportunityCost).toBeCloseTo(0, 6);
    expect(r.totalCost).toBeCloseTo(1000, 6);
    // 1000 / (1000*100) * 10000 = 100 bps
    expect(r.totalCostBps).toBeCloseTo(100, 4);
    expect(r.dominantBucket).toBe("delay");
  });

  it("impact cost when fill > arrival", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 100,
      avgFillPrice: 100.5,
      closePrice: 100.5,
      decisionQuantity: 1000,
      filledQuantity: 1000,
      side: "BUY",
    });
    expect(r.delayCost).toBeCloseTo(0, 6);
    expect(r.marketImpactCost).toBeCloseTo(500, 6);
    expect(r.opportunityCost).toBeCloseTo(0, 6);
    expect(r.totalCostBps).toBeCloseTo(50, 4);
    expect(r.dominantBucket).toBe("impact");
  });

  it("opportunity cost when partial fill and close > decision", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 100,
      avgFillPrice: 100,
      closePrice: 102,
      decisionQuantity: 1000,
      filledQuantity: 600,
      side: "BUY",
    });
    // unfilled = 400, opportunity = (102 - 100) * 400 = 800
    expect(r.opportunityCost).toBeCloseTo(800, 6);
    expect(r.delayCost).toBeCloseTo(0, 6);
    expect(r.marketImpactCost).toBeCloseTo(0, 6);
    expect(r.fillRate).toBeCloseTo(0.6, 6);
    expect(r.dominantBucket).toBe("opportunity");
  });

  it("fees add to total", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 100,
      avgFillPrice: 100,
      closePrice: 100,
      decisionQuantity: 1000,
      filledQuantity: 1000,
      side: "BUY",
      fees: 25,
    });
    expect(r.fees).toBe(25);
    expect(r.totalCost).toBe(25);
    // 25 / 100000 * 10000 = 2.5 bps
    expect(r.totalCostBps).toBeCloseTo(2.5, 4);
  });
});

describe("computeImplementationShortfall — SELL symmetry", () => {
  it("for a SELL, prices falling is the cost (delay)", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 99,
      avgFillPrice: 99,
      closePrice: 99,
      decisionQuantity: 1000,
      filledQuantity: 1000,
      side: "SELL",
    });
    // SELL with arrival < decision: delay = -1 * (99 - 100) * 1000 = +1000 (cost)
    expect(r.delayCost).toBeCloseTo(1000, 6);
  });

  it("for a SELL, opportunity cost when close < decision and partial fill", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 100,
      avgFillPrice: 100,
      closePrice: 98,
      decisionQuantity: 1000,
      filledQuantity: 600,
      side: "SELL",
    });
    // unfilled = 400; opportunity = -1 * (98 - 100) * 400 = +800 (we missed selling 400 at 100, then price fell)
    expect(r.opportunityCost).toBeCloseTo(800, 6);
  });
});

describe("computeImplementationShortfall — combined scenarios", () => {
  it("all four buckets present, totals reconcile", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 100.2,
      avgFillPrice: 100.5,
      closePrice: 101,
      decisionQuantity: 1000,
      filledQuantity: 800,
      side: "BUY",
      fees: 10,
    });
    // delay = 0.2 * 1000 = 200
    // impact = 0.3 * 800 = 240
    // opportunity = 1.0 * 200 = 200
    // fees = 10
    expect(r.delayCost).toBeCloseTo(200, 6);
    expect(r.marketImpactCost).toBeCloseTo(240, 6);
    expect(r.opportunityCost).toBeCloseTo(200, 6);
    expect(r.fees).toBe(10);
    expect(r.totalCost).toBeCloseTo(650, 6);
    expect(r.totalCostBps).toBeCloseTo(65, 4);
  });

  it("favorable execution: BUY with arrival below decision yields negative delay (benefit)", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 99,
      avgFillPrice: 99,
      closePrice: 99,
      decisionQuantity: 1000,
      filledQuantity: 1000,
      side: "BUY",
    });
    expect(r.delayCost).toBeCloseTo(-1000, 6);
    expect(r.totalCost).toBeCloseTo(-1000, 6);
    expect(r.totalCostBps).toBeCloseTo(-100, 4);
  });
});

describe("implementationShortfallToPayload", () => {
  it("emits stable shape", () => {
    const r = computeImplementationShortfall({
      decisionPrice: 100,
      arrivalPrice: 100.2,
      avgFillPrice: 100.5,
      closePrice: 101,
      decisionQuantity: 1000,
      filledQuantity: 800,
      side: "BUY",
      fees: 10,
    });
    const p = implementationShortfallToPayload(r) as {
      kind: string;
      fillRate: number;
      dominantBucket: string;
      totalCostBps: number;
      breakdownBps: Record<string, number>;
    };
    expect(p.kind).toBe("implementation_shortfall.computed");
    expect(p.fillRate).toBeCloseTo(0.8, 4);
    expect(p.breakdownBps).toHaveProperty("delay");
    expect(p.breakdownBps).toHaveProperty("impact");
    expect(p.breakdownBps).toHaveProperty("opportunity");
    expect(p.breakdownBps).toHaveProperty("fees");
  });
});
