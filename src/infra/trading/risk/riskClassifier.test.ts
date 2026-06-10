import { describe, it, expect } from "bun:test";
import {
  classifyTradeRisk,
  validateTradeProposal,
  validatePortfolioContext,
  DEFAULT_CLASSIFIER_CONFIG,
} from "./riskClassifier.ts";
import type { TradeProposal, PortfolioContext } from "./riskClassifier.ts";

function baseTrade(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 0.01,
    price: 50_000,
    notionalUsd: 500,
    orderType: "LIMIT",
    ...overrides,
  };
}

function baseContext(overrides: Partial<PortfolioContext> = {}): PortfolioContext {
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
    ...overrides,
  };
}

function trendingPrices(n: number, start = 100, drift = 0.5): number[] {
  const prices: number[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p += drift * Math.sin(i * 0.7) + drift;
    prices.push(p);
  }
  return prices;
}

describe("validateTradeProposal", () => {
  it("passes a well-formed trade", () => {
    expect(validateTradeProposal(baseTrade())).toEqual([]);
  });

  it("rejects negative notional", () => {
    const errors = validateTradeProposal(baseTrade({ notionalUsd: -500 }));
    expect(errors.some((e) => e.includes("notionalUsd"))).toBe(true);
  });

  it("rejects zero and NaN quantity", () => {
    expect(validateTradeProposal(baseTrade({ quantity: 0 })).length).toBeGreaterThan(0);
    expect(validateTradeProposal(baseTrade({ quantity: Number.NaN })).length).toBeGreaterThan(0);
  });

  it("rejects negative and non-finite price", () => {
    expect(validateTradeProposal(baseTrade({ price: -1 })).length).toBeGreaterThan(0);
    expect(validateTradeProposal(baseTrade({ price: Number.POSITIVE_INFINITY })).length).toBeGreaterThan(0);
  });

  it("rejects empty symbol", () => {
    expect(validateTradeProposal(baseTrade({ symbol: "  " })).length).toBeGreaterThan(0);
  });
});

describe("validatePortfolioContext", () => {
  it("passes a well-formed context", () => {
    expect(validatePortfolioContext(baseContext())).toEqual([]);
  });

  it("rejects zero, negative, and NaN totalValueUsd", () => {
    for (const v of [0, -10_000, Number.NaN]) {
      const errors = validatePortfolioContext(baseContext({ totalValueUsd: v }));
      expect(errors.some((e) => e.includes("totalValueUsd"))).toBe(true);
    }
  });

  it("rejects out-of-range drawdown values", () => {
    expect(validatePortfolioContext(baseContext({ currentDrawdownPct: -5 })).length).toBeGreaterThan(0);
    expect(validatePortfolioContext(baseContext({ currentDrawdownPct: 150 })).length).toBeGreaterThan(0);
    expect(validatePortfolioContext(baseContext({ maxDrawdownPct: 0 })).length).toBeGreaterThan(0);
    expect(validatePortfolioContext(baseContext({ maxDrawdownPct: 101 })).length).toBeGreaterThan(0);
  });

  it("rejects negative dailyLossLimitUsd and recentTradeCount", () => {
    expect(validatePortfolioContext(baseContext({ dailyLossLimitUsd: -1 })).length).toBeGreaterThan(0);
    expect(validatePortfolioContext(baseContext({ recentTradeCount: -1 })).length).toBeGreaterThan(0);
  });

  it("rejects non-finite cashUsd and dailyPnlUsd", () => {
    expect(validatePortfolioContext(baseContext({ cashUsd: Number.NaN })).length).toBeGreaterThan(0);
    expect(validatePortfolioContext(baseContext({ dailyPnlUsd: Number.NaN })).length).toBeGreaterThan(0);
  });
});

describe("classifyTradeRisk — fail-fast on invalid input", () => {
  it("blocks on zero portfolio value with explicit verdict and no NaN", () => {
    const result = classifyTradeRisk(baseTrade(), baseContext({ totalValueUsd: 0 }));
    expect(result.recommendation).toBe("block");
    expect(result.tier).toBe("critical");
    expect(result.compositeScore).toBe(100);
    expect(Number.isFinite(result.compositeScore)).toBe(true);
    expect(result.dimensions).toHaveLength(1);
    expect(result.dimensions[0]!.name).toBe("Input Validation");
    expect(result.summary).toContain("BLOCKED");
    for (const d of result.dimensions) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it("blocks on negative portfolio value", () => {
    const result = classifyTradeRisk(baseTrade(), baseContext({ totalValueUsd: -50_000 }));
    expect(result.recommendation).toBe("block");
    expect(result.dimensions[0]!.reason).toContain("totalValueUsd");
  });

  it("blocks on negative notional", () => {
    const result = classifyTradeRisk(baseTrade({ notionalUsd: -500 }), baseContext());
    expect(result.recommendation).toBe("block");
    expect(result.tier).toBe("critical");
  });

  it("aggregates multiple validation errors into topFactors", () => {
    const result = classifyTradeRisk(
      baseTrade({ notionalUsd: -1, quantity: 0 }),
      baseContext({ totalValueUsd: 0 }),
    );
    expect(result.recommendation).toBe("block");
    expect(result.topFactors.length).toBeGreaterThanOrEqual(2);
  });
});

describe("classifyTradeRisk — base dimension composition", () => {
  it("produces the 8 base dimensions for a minimal valid context", () => {
    const result = classifyTradeRisk(baseTrade(), baseContext());
    expect(result.dimensions.map((d) => d.name)).toEqual([
      "Position Size",
      "Concentration",
      "Drawdown Proximity",
      "Daily Loss Budget",
      "Trade Frequency",
      "Volatility",
      "Market Hours",
      "Asset Familiarity",
    ]);
  });

  it("never emits NaN in any dimension score or composite", () => {
    const result = classifyTradeRisk(baseTrade(), baseContext());
    expect(Number.isFinite(result.compositeScore)).toBe(true);
    for (const d of result.dimensions) {
      expect(Number.isFinite(d.score)).toBe(true);
      expect(Number.isFinite(d.weight)).toBe(true);
    }
  });

  it("classifies a small familiar trade as low risk / auto_approve", () => {
    const result = classifyTradeRisk(baseTrade(), baseContext());
    expect(result.tier).toBe("low");
    expect(result.recommendation).toBe("auto_approve");
  });

  it("escalates an oversized position", () => {
    const result = classifyTradeRisk(
      baseTrade({ notionalUsd: 25_000 }),
      baseContext(),
    );
    const dim = result.dimensions.find((d) => d.name === "Position Size")!;
    expect(dim.score).toBe(100);
    expect(result.tier).not.toBe("low");
  });

  it("adds Vol-Adjusted Sizing + Tail Risk when price history >= 60 points", () => {
    const result = classifyTradeRisk(
      baseTrade(),
      baseContext({ targetPriceHistory: trendingPrices(120) }),
    );
    const names = result.dimensions.map((d) => d.name);
    expect(names).toContain("Vol-Adjusted Sizing");
    expect(names).toContain("Tail Risk");
    for (const d of result.dimensions) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it("skips Vol-Adjusted Sizing + Tail Risk when history is too short", () => {
    const result = classifyTradeRisk(
      baseTrade(),
      baseContext({ targetPriceHistory: trendingPrices(30) }),
    );
    const names = result.dimensions.map((d) => d.name);
    expect(names).not.toContain("Vol-Adjusted Sizing");
    expect(names).not.toContain("Tail Risk");
  });

  it("survives degenerate constant-price history without NaN", () => {
    const result = classifyTradeRisk(
      baseTrade(),
      baseContext({ targetPriceHistory: Array(120).fill(100) }),
    );
    expect(Number.isFinite(result.compositeScore)).toBe(true);
    for (const d of result.dimensions) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it("adds Correlation Risk when target + position returns supplied", () => {
    const returns = trendingPrices(61).map((p, i, arr) => (i === 0 ? 0 : (p - arr[i - 1]!) / arr[i - 1]!)).slice(1);
    const result = classifyTradeRisk(
      baseTrade({ symbol: "ETHUSDT" }),
      baseContext({
        targetReturns: returns,
        positionReturns: { BTCUSDT: { returns, weightPct: 10 } },
      }),
    );
    const dim = result.dimensions.find((d) => d.name === "Correlation Risk")!;
    expect(dim).toBeDefined();
    expect(dim.score).toBe(80); // identical series → correlation 1
    expect(Number.isFinite(dim.score)).toBe(true);
  });

  it("composes all 15 dimensions when every optional input is supplied", () => {
    const prices = trendingPrices(120);
    const returns = prices.map((p, i, arr) => (i === 0 ? 0 : (p - arr[i - 1]!) / arr[i - 1]!)).slice(1);
    const result = classifyTradeRisk(
      baseTrade(),
      baseContext({
        targetPriceHistory: prices,
        targetReturns: returns,
        positionReturns: { ETHUSDT: { returns, weightPct: 5 } },
        regimeTransition: { probShift: 0.5, currentState: "bull", matrixStability: "stable" },
        venueMevExposure: { tier: "high", score: 70, reason: "public mempool DEX" },
        fakeLiquidity: { verdict: "suspicious", outlierFraction: 0.2 },
        marginOfError: { grade: "C", rawScore: -2, recommendation: "skip" },
      }),
    );
    expect(result.dimensions).toHaveLength(15);
    expect(Number.isFinite(result.compositeScore)).toBe(true);
    for (const d of result.dimensions) {
      expect(Number.isFinite(d.score)).toBe(true);
    }
  });

  it("composite is the weighted mean of dimension scores", () => {
    const result = classifyTradeRisk(baseTrade(), baseContext());
    const totalWeight = result.dimensions.reduce((s, d) => s + d.weight, 0);
    const expected = result.dimensions.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight;
    expect(result.compositeScore).toBe(Math.round(expected));
  });

  it("respects custom tier thresholds from config", () => {
    const result = classifyTradeRisk(baseTrade(), baseContext(), {
      ...DEFAULT_CLASSIFIER_CONFIG,
      tiers: { low: 0, medium: 1, high: 2 },
    });
    expect(result.tier).toBe("critical");
    expect(result.recommendation).toBe("block");
  });
});
