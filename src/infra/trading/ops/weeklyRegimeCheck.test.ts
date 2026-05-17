import { describe, it, expect } from "bun:test";

import {
  isWeeklyRegimeCheckEnabled,
  evaluateRegimeCheck,
  classifyVolatilityLevel,
  formatRegimeCheck,
  regimeCheckToPayload,
  WEEKLY_REGIME_CHECK_FLAG_ENV,
} from "./weeklyRegimeCheck.ts";

describe("isWeeklyRegimeCheckEnabled", () => {
  it("respects the flag", () => {
    expect(isWeeklyRegimeCheckEnabled({})).toBe(false);
    expect(isWeeklyRegimeCheckEnabled({ [WEEKLY_REGIME_CHECK_FLAG_ENV]: "1" })).toBe(true);
  });
});

describe("classifyVolatilityLevel — Wright Ch 16 bands", () => {
  it("matches the documented thresholds", () => {
    expect(classifyVolatilityLevel(10)).toBe("low");
    expect(classifyVolatilityLevel(14.9)).toBe("low");
    expect(classifyVolatilityLevel(15)).toBe("normal");
    expect(classifyVolatilityLevel(20)).toBe("normal");
    expect(classifyVolatilityLevel(25)).toBe("elevated");
    expect(classifyVolatilityLevel(34.9)).toBe("elevated");
    expect(classifyVolatilityLevel(35)).toBe("crisis");
    expect(classifyVolatilityLevel(60)).toBe("crisis");
  });
});

describe("evaluateRegimeCheck — four quadrants", () => {
  it("trending_up + low vol → quiet_trend, full size, trend_momentum favored", () => {
    const r = evaluateRegimeCheck({ regime: "trending_up", volatility: "low" });
    expect(r.quadrant).toBe("quiet_trend");
    expect(r.sizingMultiplier).toBe(1.0);
    expect(r.favored).toContain("trend_momentum");
    expect(r.avoided).toContain("mean_reversion");
  });

  it("trending_down + normal vol → quiet_trend (normal counts as low)", () => {
    const r = evaluateRegimeCheck({ regime: "trending_down", volatility: "normal" });
    expect(r.quadrant).toBe("quiet_trend");
  });

  it("trending_up + elevated vol → volatile_trend, size cut", () => {
    const r = evaluateRegimeCheck({ regime: "trending_up", volatility: "elevated" });
    expect(r.quadrant).toBe("volatile_trend");
    expect(r.sizingMultiplier).toBeLessThan(1.0);
    expect(r.favored).toContain("trend_momentum");
  });

  it("ranging + low vol → quiet_range, mean_reversion favored", () => {
    const r = evaluateRegimeCheck({ regime: "ranging", volatility: "low" });
    expect(r.quadrant).toBe("quiet_range");
    expect(r.favored).toContain("mean_reversion");
    expect(r.avoided).toContain("trend_momentum");
  });

  it("volatile regime → volatile_chop regardless of vol level", () => {
    expect(evaluateRegimeCheck({ regime: "volatile", volatility: "normal" }).quadrant).toBe(
      "volatile_chop",
    );
    expect(evaluateRegimeCheck({ regime: "volatile", volatility: "crisis" }).quadrant).toBe(
      "volatile_chop",
    );
  });

  it("volatile_chop: no favored families, all directional avoided", () => {
    const r = evaluateRegimeCheck({ regime: "volatile", volatility: "elevated" });
    expect(r.favored.length).toBe(0);
    expect(r.avoided).toContain("trend_momentum");
    expect(r.avoided).toContain("mean_reversion");
    expect(r.sizingMultiplier).toBeLessThanOrEqual(0.5);
  });
});

describe("evaluateRegimeCheck — edge cases", () => {
  it("ranging + crisis vol → volatile_chop (not quiet_range)", () => {
    const r = evaluateRegimeCheck({ regime: "ranging", volatility: "crisis" });
    expect(r.quadrant).toBe("volatile_chop");
  });

  it("quiet regime maps to quiet_range regardless of vol input", () => {
    expect(evaluateRegimeCheck({ regime: "quiet", volatility: "low" }).quadrant).toBe(
      "quiet_range",
    );
  });

  it("breakout is treated as trending (transitioning)", () => {
    const r = evaluateRegimeCheck({ regime: "breakout", volatility: "elevated" });
    expect(r.quadrant).toBe("volatile_trend");
  });
});

describe("formatRegimeCheck + regimeCheckToPayload", () => {
  it("formats human summary", () => {
    const out = formatRegimeCheck(
      evaluateRegimeCheck({ regime: "trending_up", volatility: "low" }),
    );
    expect(out).toContain("quiet_trend");
    expect(out).toContain("size × 1");
    expect(out).toContain("Favored: trend_momentum");
  });

  it("payload is stable shape", () => {
    const p = regimeCheckToPayload(
      evaluateRegimeCheck({ regime: "ranging", volatility: "low" }),
    ) as { kind: string; quadrant: string };
    expect(p.kind).toBe("weekly_regime_check.classified");
    expect(p.quadrant).toBe("quiet_range");
  });
});

describe("Wright Ch 16 'volatile chop' scenario", () => {
  it("recommends sitting in cash when worst environment is identified", () => {
    const r = evaluateRegimeCheck({ regime: "volatile", volatility: "crisis" });
    expect(r.quadrant).toBe("volatile_chop");
    expect(r.guidance.toLowerCase()).toContain("no trade");
  });
});
