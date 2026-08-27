/**
 * Market-Microstructure Diagnostic Tools.
 *
 *   - `compute_microprice` — Stoikov 2017 fair-price estimator. Takes
 *     a recent book history, returns the microprice for the most
 *     recent snapshot + transition diagnostics.
 *
 *   - `compute_inventory_adjusted_price` — Avellaneda-Stoikov
 *     reservation-price formula repurposed as an inventory-bias
 *     adjustment Gordon can consult during entry sizing.
 *
 * Both are pure READ tools — no state mutation, no order placement.
 * Surfaced to Gordon (orchestrator) and Researcher (read-only research
 * agent). Executor doesn't get them by default — these are analytical
 * primitives, not execution helpers.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";
import {
  computeMicroprice,
  summarizeMicroprice,
  type BookSnapshot,
} from "../../../../core/alpha/microprice.ts";
import {
  computeInventoryAdjustedPrice,
  inventoryAwareSizeMultiplier,
  summarizeInventoryAdjustment,
} from "../../../trading/risk/inventoryAdjustedPrice.ts";
import { monteCarloPath, summarizeMonteCarloPath } from "../../../../core/alpha/monteCarloPath.ts";
import { kellySize } from "../../../../core/alpha/kellySize.ts";
import { computeMarketMemory } from "../../../../core/alpha/marketMemory.ts";
import { computeDcf } from "../../../../core/alpha/dcf.ts";
import { fitHmmRegime } from "../../../../core/alpha/hmmRegime.ts";
import { computePriceImpliedExpectations } from "../../../../core/alpha/priceImpliedExpectations.ts";
import { computeFundamentalRatios } from "../../../../core/alpha/fundamentalRatios.ts";
import { computeRuinProbability } from "../../../../core/alpha/ruinProbability.ts";
import { computeVsRandom } from "../../../../core/alpha/vsRandom.ts";
import { computeSignalPool } from "../../../../core/alpha/signalPool.ts";
import { computePortfolioCombine } from "../../../../core/alpha/portfolioCombine.ts";
import {
  shiftBars,
  mcpPermute,
  addNoiseBands,
  type Candle as AugCandle,
} from "../../../../core/alpha/syntheticAugmentation.ts";

// ============================================================================
// compute_microprice
// ============================================================================

export const computeMicropriceTool = createTool({
  id: "compute_microprice",
  description: [
    "Compute the Stoikov microprice estimator for the most-recent order-book",
    "snapshot. Microprice is a fair-price estimator that corrects mid-price",
    "blind spots — it conditions on the current (imbalance, spread) state",
    "and returns the expected mid-price ~6 quote changes ahead.",
    "",
    "INPUT: a list of book snapshots sorted oldest → newest. The last snapshot",
    "is the current book; the rest is the history used to estimate transition",
    "probabilities. Typical inputs: 1-2 hours of book updates at sub-second",
    "intervals (more is better — sparse states will return reliable=false).",
    "",
    "OUTPUT: microprice estimate, adjustment vs mid, state details, and a",
    "reliability flag. When `reliable` is false the microprice falls back to",
    "mid; the caller should treat it as 'no signal' rather than acting on a",
    "0 adjustment as if it were meaningful.",
    "",
    "Honest caveat: the original Stanford writeup reports the microprice was",
    "'insightful but failed to make significant profit as a standalone signal'.",
    "Treat this as a building block — useful as input to other signals and",
    "anomaly detection, not as a strategy by itself.",
  ].join("\n"),
  inputSchema: z.object({
    snapshots: z
      .array(
        z.object({
          mid: z.number(),
          bid: z.number(),
          ask: z.number(),
          bidVolume: z.number().nonnegative(),
          askVolume: z.number().nonnegative(),
          timestamp: z.number(),
        }),
      )
      .min(1)
      .describe("Book snapshots sorted oldest → newest. ≥100 for reliable estimates."),
    tickSize: z
      .number()
      .positive()
      .describe(
        "Tick size for the instrument (e.g. 0.01 for most equities, 0.5 for some futures). Required.",
      ),
    imbalanceBuckets: z
      .number()
      .int()
      .min(2)
      .max(50)
      .optional()
      .describe("Discretization granularity for imbalance. Default 10."),
    maxSpreadTicks: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Maximum distinct spread tiers in ticks. Default 3."),
    iterations: z
      .number()
      .int()
      .min(1)
      .max(20)
      .optional()
      .describe("Recursion depth. Default 6 (paper convergence point)."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    mid: z.number(),
    microprice: z.number(),
    adjustment: z.number(),
    state: z.number(),
    imbalanceBucket: z.number(),
    spreadBucket: z.number(),
    perIteration: z.array(z.number()),
    transitionsObserved: z.number(),
    reliable: z.boolean(),
  }),
  execute: async ({
    snapshots,
    tickSize,
    imbalanceBuckets,
    maxSpreadTicks,
    iterations,
  }: {
    snapshots: BookSnapshot[];
    tickSize: number;
    imbalanceBuckets?: number;
    maxSpreadTicks?: number;
    iterations?: number;
  }) => {
    const result = computeMicroprice(snapshots, {
      tickSize,
      imbalanceBuckets,
      maxSpreadTicks,
      iterations,
    });
    return {
      summary: summarizeMicroprice(result),
      ...result,
    };
  },
});

// ============================================================================
// compute_inventory_adjusted_price
// ============================================================================

export const computeInventoryAdjustedPriceTool = createTool({
  id: "compute_inventory_adjusted_price",
  description: [
    "Compute the inventory-adjusted reference price using the Avellaneda-Stoikov",
    "reservation formula: r = s - q·γ·σ²·(T-t).",
    "",
    "When Gordon holds a large position, the 'fair value' for additional sizing",
    "should be biased AWAY from mid in the direction that reduces exposure:",
    "  - Long inventory → r below mid → next entry sized smaller, exit sized larger.",
    "  - Short inventory → r above mid → next entry (short) sized smaller, cover larger.",
    "",
    "Use during entry sizing decisions when there's already meaningful inventory.",
    "Returns the adjusted price + a bias label + an audit-friendly summary. Also",
    "returns a size multiplier (0.5-1.0) the caller can apply to a base position",
    "size — values < 1.0 indicate the new trade adds to existing inventory and",
    "should be scaled down.",
    "",
    "Pure compute. The output is a directional bias, not a hard fair value —",
    "treat it as input to sizing, not as a stop or take-profit level.",
  ].join("\n"),
  inputSchema: z.object({
    mid: z.number().positive().describe("Current mid price."),
    inventory: z
      .number()
      .describe(
        "Signed inventory. Positive=long, negative=short. For Gordon, fraction-of-portfolio (-1..+1) is the cleanest unit.",
      ),
    volatility: z
      .number()
      .positive()
      .describe("Per-unit-time volatility (decimal, e.g. 0.02 for 2%)."),
    horizon: z
      .number()
      .positive()
      .describe("Time horizon (T − t) in the same units as volatility."),
    riskAversion: z
      .number()
      .positive()
      .optional()
      .describe(
        "γ parameter. Paper range 0.1-0.5. Higher = more inventory-averse but lower headline P&L. Default 0.1.",
      ),
    intendedSide: z
      .number()
      .optional()
      .describe(
        "Optional. +1 for a buy decision, -1 for a sell. When supplied, the response includes a size multiplier (≤1) that scales down the trade if it would add to existing inventory.",
      ),
  }),
  outputSchema: z.object({
    summary: z.string(),
    adjustedPrice: z.number(),
    adjustment: z.number(),
    adjustmentPct: z.number(),
    bias: z.enum(["long_inventory_sell_bias", "short_inventory_buy_bias", "neutral"]),
    sizeMultiplier: z.number().optional(),
    inputs: z.object({
      mid: z.number(),
      inventory: z.number(),
      volatility: z.number(),
      horizon: z.number(),
      riskAversion: z.number(),
    }),
  }),
  execute: async ({
    mid,
    inventory,
    volatility,
    horizon,
    riskAversion,
    intendedSide,
  }: {
    mid: number;
    inventory: number;
    volatility: number;
    horizon: number;
    riskAversion?: number;
    intendedSide?: number;
  }) => {
    const result = computeInventoryAdjustedPrice({
      mid,
      inventory,
      volatility,
      horizon,
      riskAversion,
    });
    let sizeMultiplier: number | undefined;
    if (intendedSide !== undefined && intendedSide !== 0) {
      sizeMultiplier = inventoryAwareSizeMultiplier(inventory, intendedSide, result.adjustmentPct);
    }
    return {
      summary: summarizeInventoryAdjustment(result),
      adjustedPrice: result.adjustedPrice,
      adjustment: result.adjustment,
      adjustmentPct: result.adjustmentPct,
      bias: result.bias,
      ...(sizeMultiplier !== undefined && { sizeMultiplier }),
      inputs: result.inputs,
    };
  },
});

// ============================================================================
// compute_monte_carlo_path
// ============================================================================

export const computeMonteCarloPathTool = createTool({
  id: "compute_monte_carlo_path",
  description: [
    "Simulate N forward price paths from a recent price series and return",
    "the terminal-price distribution + exceedance probabilities. Two model",
    "modes: 'markov' (state-conditional returns from observed transitions —",
    "captures regime persistence) and 'gbm' (Gaussian iid log returns —",
    "memoryless baseline).",
    "",
    "Use for scenario analysis ('what's P(BTC > 80k in 30 bars)?'),",
    "for Kelly inputs (winProbability via exceedance), and to size around",
    "calibrated terminal distributions instead of point forecasts.",
    "",
    "Honest caveats: Markov on returns assumes the next-return distribution",
    "depends only on the current return bucket — violated during regime",
    "shifts. GBM understates crypto tail risk (log-normal isn't fat enough).",
    "Treat as a sizing aid, not a forecast.",
  ].join("\n"),
  inputSchema: z.object({
    prices: z
      .array(z.number())
      .min(2)
      .describe("Price history, oldest → newest. ≥ 60 points recommended."),
    horizonBars: z.number().int().min(1).max(2000).describe("Bars to project forward."),
    nSims: z.number().int().min(100).max(100_000).optional().describe("Default 10000."),
    model: z.enum(["markov", "gbm"]).optional().describe("Default 'markov'."),
    nStates: z
      .number()
      .int()
      .min(2)
      .max(50)
      .optional()
      .describe("Return-discretization buckets for Markov. Default 10."),
    exceedanceLevels: z
      .array(z.number())
      .optional()
      .describe("Prices for P(terminal ≥ level) reporting."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    model: z.enum(["markov", "gbm"]),
    startPrice: z.number(),
    horizonBars: z.number(),
    nSims: z.number(),
    meanTerminal: z.number(),
    stddevTerminal: z.number(),
    quantiles: z.object({
      p05: z.number(),
      p25: z.number(),
      p50: z.number(),
      p75: z.number(),
      p95: z.number(),
    }),
    exceedance: z.array(z.object({ level: z.number(), probability: z.number() })),
    metadata: z.object({
      fittedMu: z.number(),
      fittedSigma: z.number(),
      reliability: z.enum(["low", "medium", "high"]),
    }),
  }),
  execute: async (input) => {
    const result = monteCarloPath(input);
    return { summary: summarizeMonteCarloPath(result), ...result };
  },
});

// ============================================================================
// compute_kelly_size
// ============================================================================

export const computeKellySizeTool = createTool({
  id: "compute_kelly_size",
  description: [
    "Fractional Kelly position sizing. Two modes:",
    "",
    "  'rr' (default, for trade plans): payoutRatio = win/loss R-multiple.",
    "       e.g. 2.0 means target wins 2R, stop loses 1R.",
    "",
    "  'binary' (prediction-market style): payoutRatio = (1 − price) / price.",
    "       For a contract at 42¢ paying $1: b = 0.58/0.42 ≈ 1.38.",
    "",
    "Default multiplier is 0.25 (quarter-Kelly) — the professional standard.",
    "Full Kelly maximizes long-run growth on paper but its finite-sample",
    "drawdowns are punishing and a single bad p estimate is catastrophic.",
    "",
    "Returns recommended dollar size, full-Kelly fraction, edge in bps,",
    "and a verdict label. Does NOT enforce concentration caps — downstream",
    "risk-gate may reduce further.",
  ].join("\n"),
  inputSchema: z.object({
    winProbability: z.number().min(0).max(1),
    bankrollUsd: z.number().positive(),
    payoutRatio: z.number().positive(),
    mode: z.enum(["binary", "rr"]).optional(),
    fractionMultiplier: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Default 0.25 (quarter-Kelly)."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    fullKellyFraction: z.number(),
    recommendedFraction: z.number(),
    positionUsd: z.number(),
    edgeBps: z.number(),
    verdict: z.enum(["skip", "small", "normal", "large", "all-in"]),
  }),
  execute: async (input) => kellySize(input),
});

// ============================================================================
// Export
// ============================================================================

// ============================================================================
// compute_market_memory
// ============================================================================

export const computeMarketMemoryTool = createTool({
  id: "compute_market_memory",
  description: [
    "Diagnose what KIND of memory a price series has on this horizon —",
    "trending, mean-reverting, or random walk. Use this BEFORE picking a",
    "strategy class: a momentum/breakout system requires persistence, a",
    "mean-reversion system requires anti-persistence, and a random-walk",
    "verdict says the daily-path strategy isn't the right tool.",
    "",
    "Complements compute_regime. Regime classifies the CURRENT state of",
    "the market (trending_up, ranging, ...). market_memory classifies the",
    "TYPE of memory the market carries — i.e. which strategy class can",
    "have edge on it at all.",
    "",
    "Pipeline:",
    "  - R/S Hurst with Anis-Lloyd small-sample bias correction",
    "  - Surrogate permutation test for significance (tests against the",
    "    shuffled null, not against 0.5, so the estimator's own bias",
    "    cancels out of the comparison)",
    "  - Lo-MacKinlay variance-ratio profile (q ∈ {2,5,10,20}) with",
    "    heteroskedasticity-robust z, so volatility clustering can't",
    "    fake a memory reading",
    "",
    "Decision rule: significance gate from p-value; direction from",
    "corrected H; horizon shape from VR profile. Reliability is 'low'",
    "below 100 returns, 'high' above 500.",
  ].join("\n"),
  inputSchema: z.object({
    prices: z
      .array(z.number())
      .min(16)
      .describe("Price series, oldest → newest. ≥ 60 strongly recommended."),
    nSurrogates: z.number().int().min(100).max(5000).optional().describe("Default 1000."),
    minWindow: z
      .number()
      .int()
      .min(2)
      .max(50)
      .optional()
      .describe("Smallest R/S window. Default 8."),
    vrHorizons: z
      .array(z.number().int().positive())
      .optional()
      .describe("Variance-ratio horizons. Default [2, 5, 10, 20]."),
    pValueCutoff: z.number().min(0).max(1).optional().describe("Significance gate. Default 0.05."),
  }),
  outputSchema: z.object({
    summary: z.string(),
    nReturns: z.number(),
    hurst: z.number(),
    hurstCorrected: z.number(),
    surrogateP: z.number(),
    nullMean: z.number(),
    varianceRatio: z.array(
      z.object({
        horizon: z.number(),
        ratio: z.number(),
        zScore: z.number(),
        pValue: z.number(),
      }),
    ),
    verdict: z.enum(["trending", "mean_reverting", "random_walk"]),
    reliability: z.enum(["low", "medium", "high"]),
  }),
  execute: async (input) => {
    const r = computeMarketMemory(input);
    return r;
  },
});

// ============================================================================
// compute_dcf
// ============================================================================

export const computeDcfTool = createTool({
  id: "compute_dcf",
  description: [
    "Discounted Cash Flow intrinsic-value calc. Two-stage model:",
    "explicit FCF projections + Gordon-growth terminal value, both",
    "discounted by WACC.",
    "",
    "Inputs:",
    "  - fcfProjections: number[] — FCF per period (year 1, 2, 3, ...)",
    "  - netCash: cash - debt at t=0 (added to enterprise value)",
    "  - sharesOutstanding: diluted; defaults to 1 (returns equity value)",
    "  - base: { wacc, terminalGrowthPct } — required",
    "  - bear / bull: optional alternate cases for sensitivity band",
    "",
    "Output: per-case price-per-share, EV, equity value, terminal-",
    "fraction, plus a 5x5 sensitivity grid (+/-100bps on WACC + growth).",
    "",
    "Constraint: WACC > terminalGrowthPct (otherwise terminal value",
    "diverges — the tool throws rather than return Infinity).",
    "",
    "Not for: cyclical businesses where terminal dominates, pre-revenue",
    "firms with negative FCF, or anything where the operator hasn't",
    "validated the projections externally first.",
  ].join("\n"),
  inputSchema: z.object({
    fcfProjections: z.array(z.number()).min(1),
    netCash: z.number(),
    sharesOutstanding: z.number().positive().optional(),
    base: z.object({
      wacc: z.number().positive(),
      terminalGrowthPct: z.number(),
    }),
    bear: z.object({ wacc: z.number().positive(), terminalGrowthPct: z.number() }).optional(),
    bull: z.object({ wacc: z.number().positive(), terminalGrowthPct: z.number() }).optional(),
  }),
  outputSchema: z.object({
    base: z.unknown(),
    bear: z.unknown().nullable(),
    bull: z.unknown().nullable(),
    sensitivity: z.array(z.unknown()),
    interpretation: z.string(),
  }),
  execute: async (input) => computeDcf(input),
});

// ============================================================================
// compute_vs_random
// ============================================================================

export const computeVsRandomTool = createTool({
  id: "compute_vs_random",
  description: [
    "Vs Random benchmarking (Woodriff / Build Alpha). Generates N",
    "random-signal strategies on the same candle series, computes",
    "fitness on each, returns the actual strategy's percentile + a",
    "pass/borderline/fail verdict.",
    "",
    "Distinct from MCPT: this asks 'could a random strategy on the same",
    "data plausibly do this well?'. MCPT asks 'is the path-dependent",
    "edge real?'. Both questions matter.",
    "",
    "Pass criteria: actual must beat the BEST random, not the average.",
    "Generating enough random strategies guarantees some look good —",
    "we benchmark against the survivor of N tries.",
  ].join("\n"),
  inputSchema: z.object({
    closes: z.array(z.number()).min(2),
    actualFitness: z.number(),
    fitness: z.enum(["sharpe", "profit_factor", "win_rate", "total_return"]),
    exposureRate: z.number().min(0).max(1),
    nRandom: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
  }),
  outputSchema: z.object({
    actualFitness: z.number(),
    bestRandomFitness: z.number(),
    meanRandomFitness: z.number(),
    percentile: z.number(),
    verdict: z.enum(["pass", "borderline", "fail"]),
    nRandom: z.number(),
    interpretation: z.string(),
  }),
  execute: async (input) => computeVsRandom(input),
});

// ============================================================================
// compute_signal_pool
// ============================================================================

export const computeSignalPoolTool = createTool({
  id: "compute_signal_pool",
  description: [
    "Ensemble voting across N boolean indicator outputs. Pool the same",
    "indicator across parameter sweeps (parameter-risk reduction) OR",
    "different indicator KINDS (context aggregation). Per-bar output",
    "is the fraction of signals true; the fired flag is set when",
    "fraction >= threshold.",
    "",
    "Most individual indicators barely carry edge alone in noisy",
    "markets. A vote across N weak signals can be informative when",
    "the components are genuinely orthogonal.",
  ].join("\n"),
  inputSchema: z.object({
    signals: z.array(z.array(z.union([z.boolean(), z.number()]))),
    threshold: z.number().min(0).max(1).optional(),
  }),
  outputSchema: z.object({
    fractions: z.array(z.number()),
    fired: z.array(z.boolean()),
    barCount: z.number(),
    signalCount: z.number(),
    firedCount: z.number(),
    meanFraction: z.number(),
    threshold: z.number(),
  }),
  execute: async (input) =>
    computeSignalPool({
      signals: input.signals as Array<boolean[]> | Array<number[]>,
      threshold: input.threshold,
    }),
});

// ============================================================================
// compute_portfolio_combine
// ============================================================================

export const computePortfolioCombineTool = createTool({
  id: "compute_portfolio_combine",
  description: [
    "Combine N strategy equity curves into a portfolio, optionally",
    "rebalancing periodically. Reports the combined curve + the",
    "Parrondo / Shannon rebalancing premium (does the combined",
    "geometric mean beat the weighted geometric of components?).",
    "",
    "Uncorrelated components + rebalancing can flip a portfolio of",
    "losers into a winner. High-correlation portfolios get no benefit.",
    "Frequent rebalancing on a clear-winner portfolio acts like a",
    "'sell your best idea' tax — verify on your real curves.",
  ].join("\n"),
  inputSchema: z.object({
    equityCurves: z.array(z.array(z.number()).min(2)),
    weights: z.array(z.number()).optional(),
    rebalanceCadence: z.enum(["never", "daily", "weekly", "monthly"]).optional(),
    txCostBps: z.number().min(0).optional(),
  }),
  outputSchema: z.object({
    combinedEquity: z.array(z.number()),
    finalEquity: z.number(),
    geometricMeanReturn: z.number(),
    arithmeticMeanReturn: z.number(),
    volatility: z.number(),
    weightedGeometricComponent: z.number(),
    rebalancingPremium: z.number(),
    hasParrondo: z.boolean(),
    rebalanceEvents: z.number(),
    totalTxCost: z.number(),
  }),
  execute: async (input) => computePortfolioCombine(input),
});

// ============================================================================
// compute_synthetic_augment
// ============================================================================

export const computeSyntheticAugmentTool = createTool({
  id: "compute_synthetic_augment",
  description: [
    "Generate alternate-reality candle series from real history for",
    "backtest robustness. Three methods:",
    "",
    "  - 'shift_bars'    — re-aggregate every N consecutive bars into",
    "                      one synthetic bar. Tests bar-boundary",
    "                      sensitivity. params: { offsetBars: 2+ }",
    "  - 'mcp_permute'   — Masters' Monte Carlo Permutation. Shuffles",
    "                      intra-bar log-deltas; preserves marginal",
    "                      statistics, destroys temporal patterns.",
    "                      params: { seed: number }",
    "  - 'noise_bands'   — inject block-level vol noise into bar H-L",
    "                      ranges. Tests ATR sensitivity without",
    "                      changing trajectory shape. params: { volPct: 0..1, seed: number }",
    "",
    "Distinct from compute_monte_carlo_path which generates FORWARD",
    "paths (Cholesky MC for stress). This module augments HISTORICAL",
    "data for in-sample / walk-forward robustness.",
  ].join("\n"),
  inputSchema: z.object({
    method: z.enum(["shift_bars", "mcp_permute", "noise_bands"]),
    candles: z.array(
      z.object({
        open: z.number(),
        high: z.number(),
        low: z.number(),
        close: z.number(),
        volume: z.number().optional(),
        openTime: z.number().optional(),
        closeTime: z.number().optional(),
      }),
    ),
    params: z.record(z.string(), z.unknown()).optional(),
  }),
  outputSchema: z.object({
    method: z.string(),
    candles: z.array(z.unknown()),
    inputBarCount: z.number(),
    outputBarCount: z.number(),
  }),
  execute: async (input) => {
    const candles = input.candles as AugCandle[];
    const params = (input.params ?? {}) as Record<string, unknown>;
    let out: AugCandle[];
    switch (input.method) {
      case "shift_bars": {
        const offsetBars = typeof params.offsetBars === "number" ? params.offsetBars : 2;
        out = shiftBars(candles, offsetBars);
        break;
      }
      case "mcp_permute": {
        const seed = typeof params.seed === "number" ? params.seed : Date.now() & 0xffffffff;
        out = mcpPermute(candles, seed);
        break;
      }
      case "noise_bands": {
        const volPct = typeof params.volPct === "number" ? params.volPct : 0.1;
        const seed = typeof params.seed === "number" ? params.seed : Date.now() & 0xffffffff;
        out = addNoiseBands(candles, volPct, seed);
        break;
      }
    }
    return {
      method: input.method,
      candles: out,
      inputBarCount: candles.length,
      outputBarCount: out.length,
    };
  },
});

// ============================================================================
// compute_hmm_regime
// ============================================================================

export const computeHmmRegimeTool = createTool({
  id: "compute_hmm_regime",
  description: [
    "Hidden Markov Model regime classifier (Baum-Welch EM + Viterbi).",
    "Gaussian emissions. Fits a transition matrix + per-state mean/",
    "variance from observed returns, then Viterbi-decodes the most-",
    "likely hidden state sequence.",
    "",
    "Honest scope: descriptive, not edge-generating. The reference",
    "article's own conclusion was 'Sharpe 0.2-0.5 after costs, often",
    "below buy-and-hold.' Use HMM labels as a feature inside a richer",
    "strategy (regime-conditioned sizing, regime-filtered entries),",
    "not as a standalone signal.",
    "",
    "Multiple random restarts because Baum-Welch finds a LOCAL",
    "maximum. States are sorted ascending by mean so labels are",
    "stable across runs (3 states: bear/sideways/bull).",
  ].join("\n"),
  inputSchema: z.object({
    observations: z.array(z.number()).min(4),
    nStates: z.number().int().min(2).optional(),
    nRestarts: z.number().int().positive().optional(),
    maxIterations: z.number().int().positive().optional(),
    tolerance: z.number().positive().optional(),
    seed: z.number().int().optional(),
  }),
  outputSchema: z.object({
    initialProbs: z.array(z.number()),
    transitions: z.array(z.array(z.number())),
    means: z.array(z.number()),
    variances: z.array(z.number()),
    stateSequence: z.array(z.number()),
    logLikelihood: z.number(),
    convergedRestarts: z.number(),
    iterations: z.number(),
    stationaryDistribution: z.array(z.number()),
    stateLabels: z.array(z.string()),
  }),
  execute: async (input) => fitHmmRegime(input),
});

// ============================================================================
// compute_pie (Price-Implied Expectations)
// ============================================================================

export const computePieTool = createTool({
  id: "compute_pie",
  description: [
    "Price-Implied Expectations (Mauboussin reverse DCF). Given the",
    "current enterprise value + base FCF + WACC + terminal growth,",
    "solves for one of: explicit-period growth rate, competitive",
    "advantage period (years of supranormal growth), or implied WACC.",
    "",
    "Use BEFORE taking a variant view on a stock — knowing what the",
    "market already implies lets you size the variance honestly.",
    "Consensus 8% + market implies 12% means even a bullish-on-",
    "consensus view loses money.",
    "",
    "Bisection search. Reports 'converged: false' when the implied",
    "value falls outside sensible bands (likely operator misspec).",
  ].join("\n"),
  inputSchema: z.object({
    enterpriseValue: z.number().positive(),
    baseFcf: z.number().positive(),
    wacc: z.number().positive().optional(),
    terminalGrowthPct: z.number(),
    horizonYears: z.number().int().positive().optional(),
    growthRate: z.number().optional(),
    solveFor: z.enum(["growth_rate", "competitive_advantage", "wacc"]),
  }),
  outputSchema: z.object({
    solvedValue: z.number(),
    solveFor: z.string(),
    derivedEnterpriseValue: z.number(),
    residualError: z.number(),
    iterations: z.number(),
    converged: z.boolean(),
    interpretation: z.string(),
  }),
  execute: async (input) => computePriceImpliedExpectations(input),
});

// ============================================================================
// compute_fundamental_ratios
// ============================================================================

// ============================================================================
// compute_ruin_probability
// ============================================================================

export const computeRuinProbabilityTool = createTool({
  id: "compute_ruin_probability",
  description: [
    "Gambler's-ruin Monte Carlo for fixed-fractional position sizing.",
    "Given win probability + payout ratio + per-trade risk fraction +",
    "horizon, simulates portfolios and reports probability of breaching",
    "a ruin threshold (default 50% drawdown).",
    "",
    "Distinct from compute_kelly_size: Kelly returns the OPTIMAL",
    "fraction for log-growth; this primitive quantifies SURVIVAL risk",
    "at a CHOSEN fraction over a FINITE horizon. Even Kelly-optimal",
    "sizing has non-zero ruin probability over a short horizon.",
    "",
    "Verdict bands: safe (<1%) / cautious (1-5%) / risky (5-20%) /",
    "ruinous (>20%). Calibrated operationally, not academically.",
  ].join("\n"),
  inputSchema: z.object({
    winProbability: z.number().min(0).max(1),
    payoutRatio: z.number().positive(),
    riskFraction: z.number(),
    horizonTrades: z.number().int().positive(),
    ruinThresholdPct: z.number().optional(),
    nTrials: z.number().int().positive().optional(),
    seed: z.number().int().optional(),
  }),
  outputSchema: z.object({
    ruinProbability: z.number(),
    medianFinalCapital: z.number(),
    p05FinalCapital: z.number(),
    p95FinalCapital: z.number(),
    expectedLogReturn: z.number(),
    verdict: z.enum(["safe", "cautious", "risky", "ruinous"]),
    nTrials: z.number(),
    horizonTrades: z.number(),
    interpretation: z.string(),
  }),
  execute: async (input) => computeRuinProbability(input),
});

// ============================================================================
// compute_fundamental_ratios
// ============================================================================

export const computeFundamentalRatiosTool = createTool({
  id: "compute_fundamental_ratios",
  description: [
    "Typed wrapper for fundamental valuation ratios — NOPAT, ROIC,",
    "ROIIC, ROE, P/E, EV/EBITDA, FCF yield, plus enterprise value",
    "and net cash derivations. Math is trivial; the value is having",
    "one tool the LLM can call without mis-remembering formulas.",
    "",
    "Missing inputs produce null outputs (not zero, not Infinity) so",
    "partial ratio sheets render honestly. The interpretation field",
    "lists every ratio that was computable.",
    "",
    "Common gotchas this primitive handles:",
    "  - ROIC numerator is NOPAT (EBIT × (1 - taxRate)), not net income",
    "  - EV = marketCap + totalDebt - cash, not just marketCap",
    "  - FCF yield is FCF/marketCap (not FCF/EV — that's owner's yield)",
  ].join("\n"),
  inputSchema: z.object({
    ebit: z.number().optional(),
    taxRate: z.number().optional(),
    investedCapital: z.number().optional(),
    deltaNopat: z.number().optional(),
    deltaInvestedCapital: z.number().optional(),
    price: z.number().optional(),
    sharesOutstanding: z.number().optional(),
    eps: z.number().optional(),
    ebitda: z.number().optional(),
    fcf: z.number().optional(),
    bookEquity: z.number().optional(),
    netIncome: z.number().optional(),
    totalDebt: z.number().optional(),
    cashAndEquivalents: z.number().optional(),
  }),
  outputSchema: z.object({
    netCash: z.number().nullable(),
    marketCap: z.number().nullable(),
    enterpriseValue: z.number().nullable(),
    nopat: z.number().nullable(),
    roic: z.number().nullable(),
    roiic: z.number().nullable(),
    roe: z.number().nullable(),
    peRatio: z.number().nullable(),
    evToEbitda: z.number().nullable(),
    fcfYield: z.number().nullable(),
    interpretation: z.string(),
  }),
  execute: async (input) => computeFundamentalRatios(input),
});

export const microstructureTools = {
  compute_microprice: computeMicropriceTool,
  compute_inventory_adjusted_price: computeInventoryAdjustedPriceTool,
  compute_monte_carlo_path: computeMonteCarloPathTool,
  compute_kelly_size: computeKellySizeTool,
  compute_market_memory: computeMarketMemoryTool,
  compute_dcf: computeDcfTool,
  compute_vs_random: computeVsRandomTool,
  compute_signal_pool: computeSignalPoolTool,
  compute_portfolio_combine: computePortfolioCombineTool,
  compute_synthetic_augment: computeSyntheticAugmentTool,
  compute_hmm_regime: computeHmmRegimeTool,
  compute_pie: computePieTool,
  compute_fundamental_ratios: computeFundamentalRatiosTool,
  compute_ruin_probability: computeRuinProbabilityTool,
};
