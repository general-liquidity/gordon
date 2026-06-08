import { describe, expect, it } from "bun:test";
import { sizeCompetitionTrade, COMPETITION_RISK_DEFAULTS } from "./competition-risk-preset.ts";

const base = {
  equity: 1_000_000,
  price: 100,
  stopDistance: 2, // 2% stop
  instrumentVolAnnual: 0.8,
  openExposureNotional: 0,
  dailyPnL: 0,
};

describe("sizeCompetitionTrade", () => {
  it("sizes a normal trade within all caps (vol-target binds here)", () => {
    const r = sizeCompetitionTrade(base);
    expect(r.verdict).toBe("trade");
    expect(r.bindingConstraint).toBe("vol_target"); // 0.15·1e6/0.8 = 187.5k < risk(250k)/lev(3M)/exp(600k)
    expect(r.riskPct).toBeLessThanOrEqual(COMPETITION_RISK_DEFAULTS.maxRiskPerTradePct);
    expect(r.leverageUsed).toBeLessThanOrEqual(COMPETITION_RISK_DEFAULTS.maxLeverage);
  });

  it("halts for the day when the daily-loss kill is breached", () => {
    const r = sizeCompetitionTrade({ ...base, dailyPnL: -40_000 }); // −4% > 3% kill
    expect(r.verdict).toBe("halt");
    expect(r.bindingConstraint).toBe("daily_loss_kill");
    expect(r.sizeNotional).toBe(0);
  });

  it("skips when the concurrent-exposure cap is full", () => {
    const r = sizeCompetitionTrade({ ...base, openExposureNotional: 600_000 }); // = 60% of equity
    expect(r.verdict).toBe("skip");
    expect(r.bindingConstraint).toBe("exposure_cap");
  });

  it("per-trade risk binds when the stop is wide", () => {
    const r = sizeCompetitionTrade({ ...base, stopDistance: 10 }); // risk notional = 5000·100/10 = 50k < vol 187.5k
    expect(r.bindingConstraint).toBe("risk_per_trade");
    expect(r.riskPct).toBeCloseTo(COMPETITION_RISK_DEFAULTS.maxRiskPerTradePct, 5);
  });

  it("leverage binds when the exposure cap is relaxed and vol/stop are loose", () => {
    // With default exposure cap (60%) the exposure constraint is always tighter than 3× leverage,
    // so to exercise the leverage cap we relax exposure and make risk/vol large.
    const r = sizeCompetitionTrade({
      ...base,
      instrumentVolAnnual: 0.01, // vol-target ≈ 15M
      stopDistance: 0.1, // risk notional ≈ 5M
      params: { maxConcurrentExposurePct: 10 }, // exposure ≈ 10M, so leverage cap 3M binds
    });
    expect(r.bindingConstraint).toBe("leverage");
    expect(r.leverageUsed).toBeCloseTo(COMPETITION_RISK_DEFAULTS.maxLeverage, 3);
  });

  it("never exceeds the per-trade risk cap regardless of which constraint binds", () => {
    for (const stop of [0.5, 1, 2, 5, 10]) {
      const r = sizeCompetitionTrade({ ...base, stopDistance: stop });
      expect(r.riskPct).toBeLessThanOrEqual(COMPETITION_RISK_DEFAULTS.maxRiskPerTradePct + 1e-9);
    }
  });

  it("invalid inputs → skip", () => {
    expect(sizeCompetitionTrade({ ...base, equity: 0 }).verdict).toBe("skip");
  });
});
