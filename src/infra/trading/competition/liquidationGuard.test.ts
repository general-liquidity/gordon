import { describe, it, expect } from "bun:test";
import {
  liquidationDistance,
  assessLiquidationRisk,
  maxSafeLeverage,
  formatLiquidationRisk,
  normalCdf,
  normalInvCdf,
  DEFAULT_MAINTENANCE_BUFFER,
} from "./liquidationGuard.ts";

describe("normalCdf", () => {
  it("matches known Φ values", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(-0.33)).toBeCloseTo(0.3707, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe("normalInvCdf", () => {
  it("inverts normalCdf (round-trip)", () => {
    for (const p of [0.001, 0.01, 0.05, 0.2, 0.5, 0.8, 0.99]) {
      expect(normalCdf(normalInvCdf(p))).toBeCloseTo(p, 5);
    }
  });
});

describe("liquidationDistance", () => {
  it("is ~1/L minus buffer", () => {
    // 30×, no buffer → 1/30 = 0.0333…
    expect(liquidationDistance(30, 0)).toBeCloseTo(0.033333, 6);
    // buffer shrinks the distance
    expect(liquidationDistance(30, 0.005)).toBeCloseTo(0.028333, 6);
  });

  it("floors at a small positive for absurd inputs", () => {
    expect(liquidationDistance(0, 0)).toBeGreaterThan(0);
    expect(liquidationDistance(1e9, 0)).toBeGreaterThan(0);
    // buffer larger than 1/L would go negative → floored positive
    expect(liquidationDistance(2, 0.9)).toBeGreaterThan(0);
  });
});

describe("assessLiquidationRisk — monotonicity", () => {
  const base = { perBarVol: 0.01, barsToDeadline: 100, maxBreachProb: 0.02, maintenanceBufferPct: 0 };

  it("(1) higher leverage → larger pBreach", () => {
    const lo = assessLiquidationRisk({ ...base, leverage: 5 }).pBreach;
    const mid = assessLiquidationRisk({ ...base, leverage: 15 }).pBreach;
    const hi = assessLiquidationRisk({ ...base, leverage: 30 }).pBreach;
    expect(mid).toBeGreaterThan(lo);
    expect(hi).toBeGreaterThan(mid);
  });

  it("(2) more bars-to-deadline → larger pBreach", () => {
    const few = assessLiquidationRisk({ ...base, leverage: 20, barsToDeadline: 20 }).pBreach;
    const many = assessLiquidationRisk({ ...base, leverage: 20, barsToDeadline: 200 }).pBreach;
    expect(many).toBeGreaterThan(few);
  });

  it("(3) higher vol → larger pBreach", () => {
    const calm = assessLiquidationRisk({ ...base, leverage: 20, perBarVol: 0.005 }).pBreach;
    const wild = assessLiquidationRisk({ ...base, leverage: 20, perBarVol: 0.02 }).pBreach;
    expect(wild).toBeGreaterThan(calm);
  });
});

describe("maxSafeLeverage — round-trip", () => {
  it("(4) leverage at the edge has breach prob ≈ the threshold", () => {
    const cfg = { perBarVol: 0.008, barsToDeadline: 96, maxBreachProb: 0.02, maintenanceBufferPct: 0 };
    const lMax = maxSafeLeverage(cfg);
    expect(Number.isFinite(lMax)).toBe(true);

    const atEdge = assessLiquidationRisk({ ...cfg, leverage: lMax });
    expect(atEdge.pBreach).toBeCloseTo(cfg.maxBreachProb, 4);
    expect(atEdge.safe).toBe(true);

    // Nudging leverage up tips it over the budget.
    const overLevered = assessLiquidationRisk({ ...cfg, leverage: lMax * 1.05 });
    expect(overLevered.pBreach).toBeGreaterThan(cfg.maxBreachProb);
    expect(overLevered.safe).toBe(false);
  });

  it("round-trips with a maintenance buffer", () => {
    const cfg = { perBarVol: 0.012, barsToDeadline: 50, maxBreachProb: 0.05, maintenanceBufferPct: DEFAULT_MAINTENANCE_BUFFER };
    const lMax = maxSafeLeverage(cfg);
    const atEdge = assessLiquidationRisk({ ...cfg, leverage: lMax });
    expect(atEdge.pBreach).toBeCloseTo(cfg.maxBreachProb, 4);
  });

  it("returns Infinity when there is no vol/horizon risk", () => {
    expect(maxSafeLeverage({ perBarVol: 0, barsToDeadline: 100 })).toBe(Number.POSITIVE_INFINITY);
    expect(maxSafeLeverage({ perBarVol: 0.01, barsToDeadline: 0 })).toBe(Number.POSITIVE_INFINITY);
  });
});

describe("the survival lesson — 30× over 100 bars is near-certain liquidation", () => {
  it("(5) leverage 30, perBarVol 0.01, bars 100 → distance ≈ 0.033, pBreach ≈ 0.74", () => {
    const risk = assessLiquidationRisk({
      leverage: 30,
      perBarVol: 0.01,
      barsToDeadline: 100,
      maxBreachProb: 0.02,
      maintenanceBufferPct: 0,
    });
    // distance = 1/30 = 0.0333…
    expect(risk.distance).toBeCloseTo(0.033333, 5);
    // pBreach = 2·Φ(−0.0333/(0.01·10)) = 2·Φ(−0.3333) ≈ 0.74 (exact 0.7414;
    // the A-S erf approximation lands 0.7389 — within tolerance, same lesson).
    expect(risk.pBreach).toBeCloseTo(0.74, 2);
    expect(risk.pBreach).toBeGreaterThan(0.7);
    // Wildly over a 2% survival budget → blocked.
    expect(risk.safe).toBe(false);
  });
});

describe("formatLiquidationRisk", () => {
  it("renders PASS/FAIL with the key fields", () => {
    const fail = formatLiquidationRisk({ leverage: 30, perBarVol: 0.01, barsToDeadline: 100 });
    expect(fail).toContain("FAIL");
    expect(fail).toContain("P(breach)");
    expect(fail).toContain("max safe leverage");

    const pass = formatLiquidationRisk({ leverage: 2, perBarVol: 0.005, barsToDeadline: 20 });
    expect(pass).toContain("PASS");
  });
});
