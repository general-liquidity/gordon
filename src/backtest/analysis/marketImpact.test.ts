import { describe, it, expect } from "bun:test";

import {
  realisticCostBps,
  capacitySweep,
  capacityToPayload,
  efficientTradingFrontier,
  efficientTradingFrontierToPayload,
  DEFAULT_VENUES,
  DEFAULT_COST_PARAMS,
} from "./marketImpact.ts";

describe("realisticCostBps", () => {
  it("returns positive cost decomposed into half-spread + impact + venue", () => {
    const r = realisticCostBps({ orderSize: 100, adv: 10_000, vol: 0.02 });
    expect(r.halfSpreadBps).toBeGreaterThan(0);
    expect(r.impactBps).toBeGreaterThan(0);
    expect(r.venueBps).toBeGreaterThan(0);
    expect(r.totalBps).toBeCloseTo(r.halfSpreadBps + r.impactBps + r.venueBps);
  });

  it("impact scales as sqrt(orderSize/ADV)", () => {
    const r1 = realisticCostBps({ orderSize: 100, adv: 10_000, vol: 0 });
    const r4 = realisticCostBps({ orderSize: 400, adv: 10_000, vol: 0 });
    // 4x size → 2x impact
    expect(r4.impactBps / r1.impactBps).toBeCloseTo(2, 1);
  });

  it("impact is zero when order size is zero", () => {
    const r = realisticCostBps({ orderSize: 0, adv: 10_000, vol: 0 });
    expect(r.impactBps).toBe(0);
  });

  it("half-spread grows with vol", () => {
    const low = realisticCostBps({ orderSize: 0, adv: 10_000, vol: 0 });
    const high = realisticCostBps({ orderSize: 0, adv: 10_000, vol: 0.1 });
    expect(high.halfSpreadBps).toBeGreaterThan(low.halfSpreadBps);
  });

  it("resolves venue by id", () => {
    const lit = realisticCostBps({ orderSize: 0, adv: 10_000, vol: 0, venue: "lit" });
    const amm = realisticCostBps({ orderSize: 0, adv: 10_000, vol: 0, venue: "amm" });
    expect(amm.venueBps).toBeGreaterThan(lit.venueBps);
  });

  it("accepts explicit venue params object", () => {
    const r = realisticCostBps({
      orderSize: 0,
      adv: 10_000,
      vol: 0,
      venue: { id: "custom", venueBps: 99 },
    });
    expect(r.venueBps).toBe(99);
  });

  it("falls back to default venueBps when venue id unknown", () => {
    const r = realisticCostBps({ orderSize: 0, adv: 10_000, vol: 0, venue: "nonexistent" });
    expect(r.venueBps).toBe(DEFAULT_COST_PARAMS.venueBps);
  });

  it("rejects non-positive ADV", () => {
    expect(() => realisticCostBps({ orderSize: 1, adv: 0, vol: 0 })).toThrow();
    expect(() => realisticCostBps({ orderSize: 1, adv: -1, vol: 0 })).toThrow();
  });

  it("rejects negative order size", () => {
    expect(() => realisticCostBps({ orderSize: -1, adv: 1000, vol: 0 })).toThrow();
  });

  it("respects custom impact coefficient", () => {
    const base = realisticCostBps({ orderSize: 100, adv: 10_000, vol: 0 });
    const heavy = realisticCostBps(
      { orderSize: 100, adv: 10_000, vol: 0 },
      { ...DEFAULT_COST_PARAMS, impactCoef: 100 },
    );
    expect(heavy.impactBps).toBeCloseTo(base.impactBps * 10);
  });

  it("computes ADV fraction correctly", () => {
    const r = realisticCostBps({ orderSize: 250, adv: 10_000, vol: 0 });
    expect(r.advFraction).toBe(0.025);
  });
});

describe("DEFAULT_VENUES", () => {
  it("includes lit, dark, rfq, amm", () => {
    const ids = DEFAULT_VENUES.map((v) => v.id);
    expect(ids).toContain("lit");
    expect(ids).toContain("dark");
    expect(ids).toContain("rfq");
    expect(ids).toContain("amm");
  });
});

describe("capacitySweep", () => {
  it("net Sharpe decreases as order size grows", () => {
    const curve = capacitySweep({
      grossSharpe: 2,
      grossReturnAnn: 0.2,
      volAnn: 0.1,
      adv: 1_000_000,
      vol: 0.02,
      turnoverPerDay: 0.1,
    });
    const points = curve.points;
    expect(points.length).toBeGreaterThan(2);
    expect(points[0]!.netSharpe).toBeGreaterThan(points[points.length - 1]!.netSharpe);
  });

  it("identifies capacity as largest size with netSharpe >= threshold", () => {
    const curve = capacitySweep(
      {
        grossSharpe: 2,
        grossReturnAnn: 0.2,
        volAnn: 0.1,
        adv: 1_000_000,
        vol: 0.02,
        turnoverPerDay: 0.1,
      },
      0.5,
    );
    expect(curve.capacityAtMinSharpe).not.toBeNull();
    if (curve.capacityAtMinSharpe !== null) {
      // Find the point right at capacity and confirm its Sharpe >= 0.5
      const atCapacity = curve.points.find(
        (p) => Math.abs(p.orderSize - curve.capacityAtMinSharpe!) < 1e-9,
      );
      expect(atCapacity).toBeDefined();
      expect(atCapacity!.netSharpe).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("returns null capacity when no size meets the threshold", () => {
    const curve = capacitySweep(
      {
        grossSharpe: 0.1,
        grossReturnAnn: 0.001,
        volAnn: 0.5,
        adv: 1_000,
        vol: 0.05,
        turnoverPerDay: 1.0,
      },
      0.5,
    );
    expect(curve.capacityAtMinSharpe).toBeNull();
  });

  it("respects custom size points", () => {
    const curve = capacitySweep({
      grossSharpe: 1,
      grossReturnAnn: 0.1,
      volAnn: 0.1,
      adv: 1_000_000,
      vol: 0.02,
      turnoverPerDay: 0.1,
      sizePoints: [100, 1000, 10_000],
    });
    expect(curve.points.length).toBe(3);
    expect(curve.points.map((p) => p.orderSize)).toEqual([100, 1000, 10_000]);
  });

  it("uses daysPerYear annualization correctly", () => {
    const crypto = capacitySweep({
      grossSharpe: 1,
      grossReturnAnn: 0.1,
      volAnn: 0.1,
      adv: 1_000_000,
      vol: 0.02,
      turnoverPerDay: 0.1,
      daysPerYear: 365,
    });
    const stocks = capacitySweep({
      grossSharpe: 1,
      grossReturnAnn: 0.1,
      volAnn: 0.1,
      adv: 1_000_000,
      vol: 0.02,
      turnoverPerDay: 0.1,
      daysPerYear: 252,
    });
    // Same order size, more days/year → more cost drag → lower Sharpe
    const cryptoMid = crypto.points[Math.floor(crypto.points.length / 2)]!;
    const stocksMid = stocks.points[Math.floor(stocks.points.length / 2)]!;
    expect(cryptoMid.netSharpe).toBeLessThan(stocksMid.netSharpe);
  });

  it("rejects non-positive ADV", () => {
    expect(() =>
      capacitySweep({
        grossSharpe: 1,
        grossReturnAnn: 0.1,
        volAnn: 0.1,
        adv: 0,
        vol: 0.02,
        turnoverPerDay: 0.1,
      }),
    ).toThrow();
  });

  it("rejects non-positive volAnn", () => {
    expect(() =>
      capacitySweep({
        grossSharpe: 1,
        grossReturnAnn: 0.1,
        volAnn: 0,
        adv: 1000,
        vol: 0.02,
        turnoverPerDay: 0.1,
      }),
    ).toThrow();
  });
});

describe("capacityToPayload", () => {
  it("emits stable shape", () => {
    const curve = capacitySweep({
      grossSharpe: 1,
      grossReturnAnn: 0.1,
      volAnn: 0.1,
      adv: 1_000_000,
      vol: 0.02,
      turnoverPerDay: 0.1,
    });
    const p = capacityToPayload(curve);
    expect(p.kind).toBe("capacity.sweep_recorded");
    expect(p.pointCount).toBe(curve.points.length);
  });
});

describe("efficientTradingFrontier", () => {
  const base = {
    orderSize: 10_000,
    adv: 1_000_000,
    vol: 0.02,
  };

  it("expected impact decreases monotonically as horizon grows", () => {
    const f = efficientTradingFrontier({
      ...base,
      horizonDays: [0.1, 0.5, 1, 2, 5],
    });
    for (let i = 1; i < f.points.length; i++) {
      expect(f.points[i]!.expectedImpactBps).toBeLessThan(f.points[i - 1]!.expectedImpactBps);
    }
  });

  it("timing risk increases monotonically as horizon grows", () => {
    const f = efficientTradingFrontier({
      ...base,
      horizonDays: [0.1, 0.5, 1, 2, 5],
    });
    for (let i = 1; i < f.points.length; i++) {
      expect(f.points[i]!.timingRiskBps).toBeGreaterThan(f.points[i - 1]!.timingRiskBps);
    }
  });

  it("optimal horizon under high risk aversion is shorter than under low", () => {
    const patient = efficientTradingFrontier({ ...base, riskAversion: 0.01 });
    const urgent = efficientTradingFrontier({ ...base, riskAversion: 100 });
    // High λ penalizes timing risk → prefers shorter horizon.
    expect(urgent.optimalHorizonDays).toBeLessThanOrEqual(patient.optimalHorizonDays);
  });

  it("participation rate scales 1/horizon for fixed size", () => {
    const f = efficientTradingFrontier({
      ...base,
      horizonDays: [1, 2],
    });
    // Half the duration → double the participation
    expect(f.points[0]!.participationRate / f.points[1]!.participationRate).toBeCloseTo(2, 4);
  });

  it("orderSizeAdvFraction is correct", () => {
    const f = efficientTradingFrontier({ ...base });
    expect(f.orderSizeAdvFraction).toBeCloseTo(0.01, 6);
  });

  it("rejects non-positive orderSize", () => {
    expect(() => efficientTradingFrontier({ ...base, orderSize: 0 })).toThrow();
  });

  it("rejects non-positive adv", () => {
    expect(() => efficientTradingFrontier({ ...base, adv: 0 })).toThrow();
  });

  it("rejects non-positive horizon entries", () => {
    expect(() =>
      efficientTradingFrontier({ ...base, horizonDays: [0.1, 0, 1] }),
    ).toThrow();
  });
});

describe("efficientTradingFrontierToPayload", () => {
  it("emits stable shape", () => {
    const f = efficientTradingFrontier({
      orderSize: 10_000,
      adv: 1_000_000,
      vol: 0.02,
    });
    const p = efficientTradingFrontierToPayload(f) as {
      kind: string;
      optimalHorizonDays: number;
      pointCount: number;
    };
    expect(p.kind).toBe("efficient_trading_frontier.computed");
    expect(p.optimalHorizonDays).toBe(f.optimalHorizonDays);
    expect(p.pointCount).toBe(f.points.length);
  });
});
