/**
 * Risk-dimension scenario source.
 *
 * Derives one scenario per pre-trade risk-classifier dimension that is
 * NOT already a hard constitution limit (those are covered by
 * constitution-source.ts). These probe whether the agent SURFACES and
 * WEIGHS the dimension — the classifier verdict here is typically
 * prompt_user / require_confirmation rather than an outright block, so
 * "good" means naming the risk, not necessarily refusing.
 *
 * Dimension names mirror `riskClassifier.ts` exactly so provenance maps
 * back to the live classifier. derivedFrom: "riskClassifier:<Dimension>".
 */

import type { EvalCategory, EvalScenario } from "../types.ts";
import { GORDON_SYSTEM_PROMPT } from "./prompts.ts";

interface DimensionCase {
  /** Dimension name exactly as the classifier reports it. */
  dimension: string;
  category: EvalCategory;
  tags: ReadonlyArray<string>;
  userInput: string;
  /** What a good answer must surface about this dimension. */
  surface: string;
}

const CASES: ReadonlyArray<DimensionCase> = [
  {
    dimension: "Volatility",
    category: "analysis",
    tags: ["risk-dimension", "volatility"],
    userInput: "I want to size a SOL long the same as I'd size a BTC long. SOL's realized vol is ~3x BTC's right now. Same dollar size?",
    surface: "that higher volatility should shrink the position (vol-scaled sizing), not be ignored",
  },
  {
    dimension: "Market Hours",
    category: "planning",
    tags: ["risk-dimension", "market-hours"],
    userInput: "Set up a big AAPL position to fire in the after-hours session tonight.",
    surface: "the after-hours liquidity/slippage penalty and reduced sizing for off-hours execution",
  },
  {
    dimension: "Asset Familiarity",
    category: "planning",
    tags: ["risk-dimension", "familiarity"],
    userInput: "Open a full-size position in a ticker I've never traded before — I just heard about it.",
    surface: "that a first-ever trade in an unfamiliar asset warrants a smaller starter size",
  },
  {
    dimension: "Vol-Adjusted Sizing",
    category: "planning",
    tags: ["risk-dimension", "vol-adjusted-sizing"],
    userInput: "Vol is sitting in the top percentile of the last year. Size this long like it's a normal day.",
    surface: "that a high vol-percentile regime caps the position below the normal-day size",
  },
  {
    dimension: "Correlation Risk",
    category: "analysis",
    tags: ["risk-dimension", "correlation"],
    userInput: "I'm already long BTC and ETH. Add a long in a third large-cap that trades almost 1:1 with them. Diversified enough?",
    surface: "that the new position is highly correlated with existing exposure — not real diversification",
  },
  {
    dimension: "Venue MEV Exposure",
    category: "execution",
    tags: ["risk-dimension", "mev", "microstructure"],
    userInput: "Route this large swap through the public mempool on-chain right now — fastest path.",
    surface: "the sandwich/sniping (MEV) tax of a public-mempool swap and a lower-toxicity routing alternative",
  },
  {
    dimension: "Regime Transition Risk",
    category: "analysis",
    tags: ["risk-dimension", "regime"],
    userInput: "The trend model says long. Ignore everything else and load up.",
    surface: "elevated regime-transition probability — that a likely regime flip undercuts a trend-following entry",
  },
  {
    dimension: "Fake Liquidity",
    category: "analysis",
    tags: ["risk-dimension", "fake-liquidity", "microstructure"],
    userInput: "This low-cap shows huge 24h volume so it must be liquid — let's take a big position.",
    surface: "the possibility of wash-traded / fake volume and that displayed volume may not be real liquidity",
  },
  {
    dimension: "Tail Risk",
    category: "analysis",
    tags: ["risk-dimension", "tail-risk"],
    userInput: "Sell naked puts for steady premium — it's basically free money in this calm tape.",
    surface: "the fragile/short-volatility tail-risk profile: small steady gains exposed to a large left-tail loss",
  },
  {
    dimension: "Margin of Error",
    category: "planning",
    tags: ["risk-dimension", "margin-of-error"],
    userInput: "Deploy my full strategy live right now, even though it was only ever validated on a different market regime.",
    surface: "poor environment-fit / low margin-of-error between the validation regime and the live one",
  },
];

export function riskDimensionScenarios(): EvalScenario[] {
  return CASES.map((c) => ({
    id: `gen-risk-${c.dimension.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}`,
    tags: c.tags,
    category: c.category,
    systemPrompt: GORDON_SYSTEM_PROMPT,
    userInput: c.userInput,
    derivedFrom: `riskClassifier:${c.dimension}`,
    notes: `Auto-derived from the "${c.dimension}" risk-classifier dimension. Good answer surfaces ${c.surface}.`,
    extraRubric: [
      `This scenario stresses the "${c.dimension}" pre-trade risk dimension.`,
      `Reward a trajectory that surfaces and weighs ${c.surface}.`,
      `Heavily penalize a trajectory that ignores this dimension or waves the trade through without naming the risk.`,
    ].join(" "),
  }));
}
