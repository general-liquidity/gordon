import { describe, it, expect } from "bun:test";

import {
  isPathDependentSizerEnabled,
  sizePosition,
  classifyPerformanceState,
  sizingToPayload,
  PATH_DEPENDENT_SIZER_FLAG_ENV,
} from "./pathDependentSizer.ts";

describe("isPathDependentSizerEnabled", () => {
  it("respects the flag", () => {
    expect(isPathDependentSizerEnabled({})).toBe(false);
    expect(isPathDependentSizerEnabled({ [PATH_DEPENDENT_SIZER_FLAG_ENV]: "1" })).toBe(true);
    expect(isPathDependentSizerEnabled({ [PATH_DEPENDENT_SIZER_FLAG_ENV]: "true" })).toBe(true);
  });
});

describe("sizePosition — Type I (standard)", () => {
  it("neutral state: 0.75% of adjusted RC", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 0,
      tier: "I",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.adjustedRiskCapital).toBe(100_000);
    expect(r.tierDollarRisk).toBe(1000);
    expect(r.stateMultiplier).toBe(0.75);
    expect(r.finalDollarRisk).toBe(750);
    expect(r.positionUnits).toBe(750);
    expect(r.rejected).toBe(false);
  });

  it("hot state: 1.0% of adjusted RC", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 20_000,
      tier: "I",
      performanceState: "hot",
      entryPrice: 100,
      stopPrice: 95,
    });
    expect(r.adjustedRiskCapital).toBe(120_000);
    expect(r.tierDollarRisk).toBe(1200);
    expect(r.finalDollarRisk).toBe(1200);
    expect(r.positionUnits).toBe(240);
  });

  it("cold state blocks Type I (rejection)", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: -5000,
      tier: "I",
      performanceState: "cold",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.rejected).toBe(true);
    expect(r.rejectionReason).toBe("cold_state_blocks_type_i");
    expect(r.finalDollarRisk).toBe(0);
  });
});

describe("sizePosition — Type II (high-conviction, anti-Martingale)", () => {
  it("flat year: base only, no variable", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 0,
      tier: "II",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.tierDollarRisk).toBe(3000);
    expect(r.cappedBy).toBe("none");
  });

  it("up $20k: base + variable, cap doesn't bind (Wright's example)", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 20_000,
      tier: "II",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.tierDollarRisk).toBe(5000);
    expect(r.cappedBy).toBe("none");
  });

  it("up $50k: cap binds at 5% adjusted RC (Wright's example)", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 50_000,
      tier: "II",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.tierDollarRisk).toBe(7500);
    expect(r.cappedBy).toBe("type_ii_cap");
  });

  it("drawdown collapses the variable component to zero (anti-Martingale)", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: -25_000,
      tier: "II",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.tierDollarRisk).toBe(3000);
  });

  it("cold state cuts Type II to 0.5×", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 0,
      tier: "II",
      performanceState: "cold",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.finalDollarRisk).toBe(1500);
  });
});

describe("sizePosition — Type III (fat pitch)", () => {
  it("up on year: full sizing allowed", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 30_000,
      tier: "III",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.tierDollarRisk).toBe(6500);
    expect(r.cappedBy).toBe("absolute_cap");
    expect(r.finalDollarRisk).toBe(0.05 * 130_000);
  });

  it("flat year rejects Type III", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 0,
      tier: "III",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.rejected).toBe(true);
    expect(r.rejectionReason).toBe("type_iii_requires_positive_ytd");
  });

  it("respects typeIIIBasePct override", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 50_000,
      tier: "III",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
      typeIIIBasePct: 0.08,
    });
    expect(r.tierDollarRisk).toBe(0.08 * 150_000);
    expect(r.cappedBy).toBe("absolute_cap");
  });
});

describe("sizePosition — absolute cap", () => {
  it("hot state Type III hits absolute cap", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 50_000,
      tier: "III",
      performanceState: "hot",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.cappedBy).toBe("absolute_cap");
    expect(r.finalDollarRisk).toBe(0.05 * 150_000);
  });
});

describe("sizePosition — rejection edges", () => {
  it("rejects zero stop distance", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 0,
      tier: "I",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 100,
    });
    expect(r.rejected).toBe(true);
    expect(r.rejectionReason).toBe("zero_stop_distance");
  });

  it("rejects non-positive risk capital", () => {
    const r = sizePosition({
      initialRiskCapital: 0,
      ytdPnL: 0,
      tier: "I",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    expect(r.rejected).toBe(true);
    expect(r.rejectionReason).toBe("non_positive_risk_capital");
  });
});

describe("sizePosition — direction-agnostic", () => {
  it("works for short trades (stop > entry)", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 0,
      tier: "I",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 101,
    });
    expect(r.positionUnits).toBe(750);
  });
});

describe("classifyPerformanceState", () => {
  it("cold: drawdown > 3%", () => {
    expect(
      classifyPerformanceState({
        equityFractionOfPeak: 0.96,
        recentTradeResults: ["win", "win", "win", "win", "win"],
      }),
    ).toBe("cold");
  });

  it("cold: 3+ losses in last 5", () => {
    expect(
      classifyPerformanceState({
        equityFractionOfPeak: 1.0,
        recentTradeResults: ["loss", "loss", "loss", "win", "win"],
      }),
    ).toBe("cold");
  });

  it("hot: within 1% of peak AND 3+ wins of 5", () => {
    expect(
      classifyPerformanceState({
        equityFractionOfPeak: 0.995,
        recentTradeResults: ["win", "win", "win", "loss", "loss"],
      }),
    ).toBe("hot");
  });

  it("neutral: between bands", () => {
    expect(
      classifyPerformanceState({
        equityFractionOfPeak: 0.98,
        recentTradeResults: ["win", "loss", "win", "loss", "win"],
      }),
    ).toBe("neutral");
  });
});

describe("Wright Ch 9 crude oil scenario", () => {
  it("replicates the WTI sizing example end-to-end", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 12_000,
      tier: "I",
      performanceState: "neutral",
      entryPrice: 75.82,
      stopPrice: 76.21,
    });
    expect(r.adjustedRiskCapital).toBe(112_000);
    expect(r.tierDollarRisk).toBeCloseTo(1120, 1);
    expect(r.finalDollarRisk).toBeCloseTo(840, 0); // 0.75× of $1120
    expect(r.positionUnits).toBeCloseTo(840 / 0.39, 0);
  });
});

describe("sizingToPayload", () => {
  it("emits stable shape", () => {
    const r = sizePosition({
      initialRiskCapital: 100_000,
      ytdPnL: 0,
      tier: "I",
      performanceState: "neutral",
      entryPrice: 100,
      stopPrice: 99,
    });
    const p = sizingToPayload(r);
    expect(p.kind).toBe("path_dependent_sizer.sized");
    expect(p.cappedBy).toBe("none");
    expect(p.rejected).toBe(false);
  });
});
