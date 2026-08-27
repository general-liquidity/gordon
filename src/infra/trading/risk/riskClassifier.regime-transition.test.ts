import { describe, it, expect } from "bun:test";
import { classifyTradeRisk, DEFAULT_CLASSIFIER_CONFIG } from "./riskClassifier.ts";
import type { TradeProposal, PortfolioContext } from "./riskClassifier.ts";

function baseTrade(): TradeProposal {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 0.01,
    price: 50_000,
    notionalUsd: 500,
    orderType: "LIMIT",
  };
}

function baseContext(): PortfolioContext {
  return {
    totalValueUsd: 50_000,
    cashUsd: 25_000,
    positions: [],
    dailyPnlUsd: 0,
    dailyLossLimitUsd: 1_000,
    maxDrawdownPct: 20,
    currentDrawdownPct: 2,
    recentTradeCount: 1,
    tradedSymbols: new Set(["BTCUSDT"]),
  };
}

describe("classifyTradeRisk — regime-transition risk dimension", () => {
  it("adds no Regime Transition dimension when regimeTransition is absent (back-compat)", () => {
    const result = classifyTradeRisk(baseTrade(), baseContext());
    expect(result.dimensions.find((d) => d.name === "Regime Transition Risk")).toBeUndefined();
  });

  it("scores zero when shift probability is below threshold", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 0.2, // below default 0.30
      currentState: "bull",
      matrixStability: "stable",
    };
    const result = classifyTradeRisk(baseTrade(), ctx);
    const dim = result.dimensions.find((d) => d.name === "Regime Transition Risk");
    expect(dim).toBeDefined();
    expect(dim!.score).toBe(0);
  });

  it("scales score with shift probability above threshold", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 0.5,
      currentState: "bull",
      matrixStability: "stable",
    };
    const result = classifyTradeRisk(baseTrade(), ctx);
    const dim = result.dimensions.find((d) => d.name === "Regime Transition Risk")!;
    expect(dim.score).toBeGreaterThan(0);
    expect(dim.score).toBeLessThanOrEqual(80);
  });

  it("adds penalty when matrix is drifting", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 0.1, // below threshold on its own
      currentState: "bull",
      matrixStability: "drifting",
    };
    const result = classifyTradeRisk(baseTrade(), ctx);
    const dim = result.dimensions.find((d) => d.name === "Regime Transition Risk")!;
    expect(dim.score).toBe(20); // drifting penalty
    expect(dim.reason).toContain("DRIFTING");
  });

  it("adds larger penalty when matrix is unstable", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 0.1,
      currentState: "bull",
      matrixStability: "unstable",
    };
    const result = classifyTradeRisk(baseTrade(), ctx);
    const dim = result.dimensions.find((d) => d.name === "Regime Transition Risk")!;
    expect(dim.score).toBe(40);
    expect(dim.reason).toContain("UNSTABLE");
    expect(dim.reason).toContain("discard inferences");
  });

  it("combines high probShift + unstable matrix into ceiling score", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 0.95,
      currentState: "neutral",
      matrixStability: "unstable",
    };
    const result = classifyTradeRisk(baseTrade(), ctx);
    const dim = result.dimensions.find((d) => d.name === "Regime Transition Risk")!;
    expect(dim.score).toBe(100); // ceilinged at 100
  });

  it("flags insufficient_data with a moderate score and clear reason", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 0.1,
      currentState: "bull",
      matrixStability: "insufficient_data",
    };
    const result = classifyTradeRisk(baseTrade(), ctx);
    const dim = result.dimensions.find((d) => d.name === "Regime Transition Risk")!;
    expect(dim.score).toBe(10);
    expect(dim.reason).toContain("insufficient data");
  });

  it("respects custom threshold via classifier config", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 0.4,
      currentState: "bull",
      matrixStability: "stable",
    };
    // Strict operator: any shift probability above 20% escalates
    const strictResult = classifyTradeRisk(baseTrade(), ctx, {
      ...DEFAULT_CLASSIFIER_CONFIG,
      regimeTransitionThreshold: 0.2,
    });
    // Lax operator: only escalate above 60%
    const laxResult = classifyTradeRisk(baseTrade(), ctx, {
      ...DEFAULT_CLASSIFIER_CONFIG,
      regimeTransitionThreshold: 0.6,
    });
    const strictDim = strictResult.dimensions.find((d) => d.name === "Regime Transition Risk")!;
    const laxDim = laxResult.dimensions.find((d) => d.name === "Regime Transition Risk")!;
    expect(strictDim.score).toBeGreaterThan(laxDim.score);
    expect(laxDim.score).toBe(0);
  });

  it("clamps shift probabilities outside [0, 1]", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 1.5, // bogus input
      currentState: "bull",
      matrixStability: "stable",
    };
    const result = classifyTradeRisk(baseTrade(), ctx);
    const dim = result.dimensions.find((d) => d.name === "Regime Transition Risk")!;
    expect(dim.score).toBeLessThanOrEqual(80);
  });

  it("contributes to composite + recommendation when severe", () => {
    const ctx = baseContext();
    ctx.regimeTransition = {
      probShift: 0.9,
      currentState: "bull",
      matrixStability: "unstable",
    };
    const result = classifyTradeRisk(baseTrade(), ctx);
    expect(result.compositeScore).toBeGreaterThan(0);
    // Should be at least medium tier given the 100-score weighted dimension
    expect(["medium", "high", "critical"]).toContain(result.tier);
  });
});
