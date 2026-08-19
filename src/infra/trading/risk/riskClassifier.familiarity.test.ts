import { describe, it, expect } from "bun:test";
import { classifyTradeRisk } from "./riskClassifier.ts";
import type { TradeProposal, PortfolioContext } from "./riskClassifier.ts";

function trade(overrides: Partial<TradeProposal> = {}): TradeProposal {
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

function context(overrides: Partial<PortfolioContext> = {}): PortfolioContext {
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

function familiarityOf(assessment: ReturnType<typeof classifyTradeRisk>) {
  const dim = assessment.dimensions.find((d) => d.name === "Asset Familiarity");
  if (!dim) throw new Error("Asset Familiarity dimension missing");
  return dim;
}

/** Calm advance: small, evenly signed steps and no meaningful drawdown. */
function calmSeries(n: number, start = 100): number[] {
  const prices: number[] = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p *= 1 + 0.001 * (i % 3 === 0 ? 1 : 0.5);
    prices.push(p);
  }
  return prices;
}

describe("asset familiarity scores market state, not just the symbol", () => {
  it("keeps the previously-traded symbol unpenalized when the state is ordinary", () => {
    const assessment = classifyTradeRisk(
      trade(),
      context({ targetPriceHistory: calmSeries(200) }),
    );
    expect(familiarityOf(assessment).score).toBe(0);
  });

  it("penalizes a known symbol whose current state is unlike anything in its history", () => {
    const prices = calmSeries(200);
    // A violent, deep selloff appended to a calm advance: same symbol, a regime
    // the reference distribution has never contained.
    for (let i = 0; i < 40; i++) {
      const prev = prices[prices.length - 1] ?? 100;
      prices.push(prev * (i % 2 === 0 ? 0.88 : 1.05));
    }
    const assessment = classifyTradeRisk(
      trade(),
      context({ targetPriceHistory: prices }),
    );
    const dim = familiarityOf(assessment);
    expect(dim.score).toBeGreaterThan(0);
    expect(dim.reason).toContain("outside the distribution");
  });

  it("never scores a familiar state below the untraded-symbol penalty", () => {
    const untraded = classifyTradeRisk(
      trade({ symbol: "ETHUSDT" }),
      context({ targetPriceHistory: calmSeries(200) }),
    );
    expect(familiarityOf(untraded).score).toBeGreaterThanOrEqual(40);
  });

  it("falls back to the symbol check when there is too little history to judge state", () => {
    const assessment = classifyTradeRisk(
      trade(),
      context({ targetPriceHistory: calmSeries(20) }),
    );
    const dim = familiarityOf(assessment);
    expect(dim.score).toBe(0);
    expect(dim.reason).not.toContain("outside the distribution");
  });

  it("scores identically on repeated calls, reading no clock", () => {
    const ctx = context({ targetPriceHistory: calmSeries(200) });
    const a = familiarityOf(classifyTradeRisk(trade(), ctx));
    const b = familiarityOf(classifyTradeRisk(trade(), ctx));
    expect(a).toEqual(b);
  });
});
