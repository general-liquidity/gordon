import { describe, expect, it } from "bun:test";
import { buildCompetitionRunConfig, sizeCompetitionOrder, COMPETITION_MANDATE } from "./competition-runner.ts";
import { COMPETITION_RISK_DEFAULTS, sizeCompetitionTrade } from "../risk-management/competition-risk-preset.ts";

describe("buildCompetitionRunConfig", () => {
  it("defaults to paper / $1M / all 3 asset classes / the preset", () => {
    const c = buildCompetitionRunConfig();
    expect(c.venue).toBe("paper");
    expect(c.startingEquity).toBe(1_000_000);
    expect(c.assetClasses).toEqual(["fx", "metals", "crypto"]);
    expect(c.riskProfile).toEqual(COMPETITION_RISK_DEFAULTS);
    expect(c.sessionHorizonDays).toBeGreaterThan(0);
    expect(c.mandate).toContain("Sharpe");
    expect(c.mandate).toContain("wipeout");
  });

  it("applies overrides (e.g. switch venue to syphonix, change equity)", () => {
    const c = buildCompetitionRunConfig({ venue: "syphonix", startingEquity: 500_000 });
    expect(c.venue).toBe("syphonix");
    expect(c.startingEquity).toBe(500_000);
    expect(c.assetClasses).toEqual(["fx", "metals", "crypto"]); // untouched
  });

  it("merges a partial riskProfile over the preset (not a wholesale replace)", () => {
    const c = buildCompetitionRunConfig({ riskProfile: { maxLeverage: 2 } as any });
    expect(c.riskProfile.maxLeverage).toBe(2); // overridden
    expect(c.riskProfile.maxRiskPerTradePct).toBe(COMPETITION_RISK_DEFAULTS.maxRiskPerTradePct); // retained
    expect(c.riskProfile.dailyLossKillPct).toBe(COMPETITION_RISK_DEFAULTS.dailyLossKillPct);
  });

  it("does not hardcode symbols — scopes asset classes only", () => {
    const c = buildCompetitionRunConfig();
    // assetClasses are categories, not instrument symbols (resolved from venue catalog at runtime)
    for (const cls of c.assetClasses) expect(["fx", "metals", "crypto"]).toContain(cls);
  });
});

describe("sizeCompetitionOrder", () => {
  it("delegates to the competition risk preset", () => {
    const input = {
      equity: 1_000_000, price: 100, stopDistance: 2, instrumentVolAnnual: 0.8,
      openExposureNotional: 0, dailyPnL: 0,
    };
    const viaRunner = sizeCompetitionOrder(input);
    const viaPreset = sizeCompetitionTrade({ ...input, params: COMPETITION_RISK_DEFAULTS });
    expect(viaRunner).toEqual(viaPreset);
    expect(viaRunner.riskPct).toBeLessThanOrEqual(COMPETITION_RISK_DEFAULTS.maxRiskPerTradePct);
  });

  it("the daily-loss kill halts trading through the runner too", () => {
    const r = sizeCompetitionOrder({
      equity: 1_000_000, price: 100, stopDistance: 2, instrumentVolAnnual: 0.8,
      openExposureNotional: 0, dailyPnL: -40_000,
    });
    expect(r.verdict).toBe("halt");
  });
});

describe("COMPETITION_MANDATE", () => {
  it("encodes survive-and-compound, not leaderboard-gaming", () => {
    expect(COMPETITION_MANDATE).toContain("Survive-and-compound");
    expect(COMPETITION_MANDATE.toLowerCase()).toContain("leaderboard-gaming");
  });
});
