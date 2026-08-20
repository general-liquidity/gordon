import { describe, expect, it } from "bun:test";
import {
  classifyTradeRisk,
  DEFAULT_CLASSIFIER_CONFIG,
  type PortfolioContext,
  type RiskAssessment,
  type RiskDimension,
  type RiskTier,
  type TradeProposal,
} from "./riskClassifier.ts";
import { collapseToScalar, legsFromValues } from "../../../core/alpha/uncertainty-decomposition.ts";

const DIMENSION = "Uncertainty Decomposition";

function baseTrade(overrides: Partial<TradeProposal> = {}): TradeProposal {
  return {
    symbol: "BTCUSDT",
    side: "BUY",
    quantity: 0.01,
    price: 50_000,
    notionalUsd: 500,
    orderType: "MARKET",
    ...overrides,
  };
}

function baseContext(overrides: Partial<PortfolioContext> = {}): PortfolioContext {
  return {
    totalValueUsd: 100_000,
    cashUsd: 50_000,
    positions: [],
    dailyPnlUsd: 0,
    dailyLossLimitUsd: 2_000,
    maxDrawdownPct: 20,
    currentDrawdownPct: 2,
    recentTradeCount: 1,
    tradedSymbols: new Set(["BTCUSDT"]),
    ...overrides,
  };
}

/** Steady drift with a small oscillation, so returns disperse without trending wildly. */
function steadyPrices(n: number): number[] {
  return Array.from({ length: n }, (_, i) => 100 * Math.pow(1.0005, i) + Math.sin(i) * 0.05);
}

/** Symmetric alternating moves: pure market noise, no drift for estimators to argue over. */
function alternatingPrices(n: number, magnitude: number): number[] {
  let price = 100;
  const out = [price];
  for (let i = 0; i < n - 1; i++) {
    price *= 1 + (i % 2 === 0 ? magnitude : -magnitude);
    out.push(price);
  }
  return out;
}

function uncertaintyDimension(assessment: RiskAssessment): RiskDimension {
  const dim = assessment.dimensions.find((d) => d.name === DIMENSION);
  if (!dim) throw new Error(`${DIMENSION} dimension is absent`);
  return dim;
}

/** The reported leg values, read back off the dimension's own reason line. */
function legsOf(dim: RiskDimension): {
  aleatoric: number | null;
  epistemic: number | null;
  distributional: number | null;
} {
  const read = (leg: string): number | null => {
    const match = new RegExp(`${leg} (unavailable|[0-9.]+)`).exec(dim.reason);
    if (!match || match[1] === undefined) throw new Error(`no ${leg} leg in: ${dim.reason}`);
    return match[1] === "unavailable" ? null : Number(match[1]);
  };
  return {
    aleatoric: read("aleatoric"),
    epistemic: read("epistemic"),
    distributional: read("distributional"),
  };
}

function totalUncertaintyOf(dim: RiskDimension): number {
  const total = collapseToScalar(legsFromValues(legsOf(dim)));
  if (total.value === null) throw new Error(`total unmeasurable for: ${dim.reason}`);
  return total.value;
}

const TIER_ORDER: RiskTier[] = ["low", "medium", "high", "critical"];

function tierFor(composite: number): RiskTier {
  const t = DEFAULT_CLASSIFIER_CONFIG.tiers;
  if (composite >= t.high) return "critical";
  if (composite >= t.medium) return "high";
  if (composite >= t.low) return "medium";
  return "low";
}

/** Tier the trade would have carried had the uncertainty dimension never been added. */
function tierWithoutUncertainty(assessment: RiskAssessment): RiskTier {
  const others = assessment.dimensions.filter((d) => d.name !== DIMENSION);
  const totalWeight = others.reduce((s, d) => s + d.weight, 0);
  const composite = others.reduce((s, d) => s + d.score * d.weight, 0) / totalWeight;
  return tierFor(composite);
}

function classify(overrides: Partial<PortfolioContext>): RiskAssessment {
  return classifyTradeRisk(baseTrade(), baseContext(overrides), DEFAULT_CLASSIFIER_CONFIG);
}

describe("classifyTradeRisk — uncertainty decomposition dimension", () => {
  it("the same total uncertainty scores differently depending on which leg carries it", () => {
    // Noise the market owns, versus estimators that cannot agree on the drift.
    const noisy = uncertaintyDimension(
      classify({ targetPriceHistory: alternatingPrices(121, 0.03) }),
    );
    const disputed = uncertaintyDimension(
      classify({
        targetPriceHistory: steadyPrices(120),
        targetReturns: Array(60).fill(0.1),
      }),
    );

    expect(Math.abs(totalUncertaintyOf(noisy) - totalUncertaintyOf(disputed))).toBeLessThan(0.05);
    expect(disputed.score).toBeGreaterThan(noisy.score);
    expect(noisy.reason).toContain("size_down");
    expect(disputed.reason).toContain("gather_evidence");
  });

  it("estimators that disagree raise the score above the same history with no dispute", () => {
    const history = steadyPrices(120);
    const agreed = uncertaintyDimension(classify({ targetPriceHistory: history }));
    const disputed = uncertaintyDimension(
      classify({ targetPriceHistory: history, targetReturns: Array(60).fill(0.1) }),
    );

    expect(legsOf(disputed).epistemic).toBeGreaterThan(legsOf(agreed).epistemic ?? 0);
    expect(disputed.score).toBeGreaterThan(agreed.score);
  });

  it("market noise on its own asks for smaller size rather than for no trade", () => {
    const dim = uncertaintyDimension(
      classify({ targetPriceHistory: alternatingPrices(121, 0.03) }),
    );

    expect(dim.reason).toContain("size_down");
    expect(dim.reason).not.toContain("abstain");
    expect(legsOf(dim).aleatoric).toBeGreaterThanOrEqual(0.5);
    expect(dim.score).toBeLessThan(70);
    expect(dim.score).toBeGreaterThan(0);
  });

  it("history too thin to place the current state reads as not knowing, not as calm", () => {
    const thin = uncertaintyDimension(classify({ targetPriceHistory: steadyPrices(70) }));
    const full = uncertaintyDimension(classify({ targetPriceHistory: steadyPrices(120) }));

    expect(legsOf(thin).distributional).toBeNull();
    expect(thin.reason).toContain("unavailable");
    expect(thin.score).toBeGreaterThan(full.score);
  });

  it("evidence that cannot be measured is scored conservatively and says why", () => {
    const dim = uncertaintyDimension(classify({ targetPriceHistory: Array(120).fill(100) }));

    expect(legsOf(dim).aleatoric).toBeNull();
    expect(dim.score).toBeGreaterThanOrEqual(55);
    expect(dim.reason).toContain("aleatoric unavailable");
  });

  it("the dimension is absent rather than guessed when there is no price history", () => {
    const assessment = classify({});
    expect(assessment.dimensions.map((d) => d.name)).not.toContain(DIMENSION);
  });

  it("no trade's tier improves for having its uncertainty scored", () => {
    const fixtures: Array<Partial<PortfolioContext>> = [
      { targetPriceHistory: steadyPrices(120) },
      { targetPriceHistory: steadyPrices(70) },
      { targetPriceHistory: alternatingPrices(121, 0.03) },
      { targetPriceHistory: alternatingPrices(121, 0.01) },
      { targetPriceHistory: Array(120).fill(100) },
      { targetPriceHistory: steadyPrices(120), targetReturns: Array(60).fill(0.1) },
      {
        targetPriceHistory: steadyPrices(120),
        currentDrawdownPct: 18,
        dailyPnlUsd: -1_900,
        recentTradeCount: 9,
        tradedSymbols: new Set<string>(),
      },
    ];

    let anyRaised = false;
    for (const fixture of fixtures) {
      const assessment = classify(fixture);
      const before = tierWithoutUncertainty(assessment);
      expect(TIER_ORDER.indexOf(assessment.tier)).toBeGreaterThanOrEqual(
        TIER_ORDER.indexOf(before),
      );

      const others = assessment.dimensions.filter((d) => d.name !== DIMENSION);
      const otherWeight = others.reduce((s, d) => s + d.weight, 0);
      const otherComposite = others.reduce((s, d) => s + d.score * d.weight, 0) / otherWeight;
      expect(assessment.compositeScore).toBeGreaterThanOrEqual(Math.round(otherComposite));
      if (assessment.compositeScore > Math.round(otherComposite)) anyRaised = true;
    }
    expect(anyRaised).toBe(true);
  });

  it("a rejected trade is never turned into an approval by the added dimension", () => {
    const rejecting = baseContext({
      targetPriceHistory: steadyPrices(120),
      currentDrawdownPct: 19,
      dailyPnlUsd: -2_000,
      recentTradeCount: 40,
      tradedSymbols: new Set<string>(),
    });
    const assessment = classifyTradeRisk(
      baseTrade({ notionalUsd: 40_000, quantity: 0.8 }),
      rejecting,
      DEFAULT_CLASSIFIER_CONFIG,
    );
    const before = tierWithoutUncertainty(assessment);

    expect(TIER_ORDER.indexOf(assessment.tier)).toBeGreaterThanOrEqual(
      TIER_ORDER.indexOf(before),
    );
    expect(assessment.recommendation).not.toBe("auto_approve");
  });

  it("the same input classifies to the same assessment on every call", () => {
    const fixture = {
      targetPriceHistory: steadyPrices(120),
      targetReturns: Array(60).fill(0.1),
    };
    const first = classify(fixture);
    const second = classify(fixture);
    const third = classify(fixture);

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    expect(uncertaintyDimension(second).reason).toBe(uncertaintyDimension(first).reason);
  });
});
