/**
 * IBS Cross-Sectional Ranker Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `rankIbsCrossSectional` from core/alpha/ibs-cross-sectional.ts.
 * Single-bar mean-reversion intensity: IBS = (Close - Low) / (High - Low).
 * Bottom-decile by IBS = oversold (long candidates); top-decile = overbought
 * (short candidates).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { rankIbsCrossSectional } from "../../../../core/alpha/ibs-cross-sectional.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const ibsCrossSectionalDiagnosticTool = createTool({
  id: "rank_ibs_cross_sectional",
  description:
    "Rank a universe by Internal Bar Strength (IBS = (close - low) / (high - low)). " +
    "Bottom-decile = oversold (long candidates); top-decile = overbought (short candidates). " +
    "Single-bar mean-reversion primitive (Pagonidis 2014 for ETFs). Returns long/short " +
    "baskets + per-symbol IBS + spread. Distinct from cross-sectional-momentum (cumulative " +
    "return ranking, opposite direction) and streak-detector (single-asset multi-bar).",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          symbol: z.string(),
          high: z.number(),
          low: z.number(),
          close: z.number(),
        }),
      )
      .min(1)
      .describe("Per-symbol latest bar with (high, low, close)."),
    topFraction: z
      .number()
      .min(0.01)
      .max(0.5)
      .optional()
      .describe("Top fraction (overbought / short candidates). Default 0.10."),
    bottomFraction: z
      .number()
      .min(0.01)
      .max(0.5)
      .optional()
      .describe("Bottom fraction (oversold / long candidates). Default 0.10."),
    minSymbols: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Minimum universe size for a verdict. Default 5."),
    minRangeFraction: z
      .number()
      .min(0)
      .optional()
      .describe("Minimum bar range / close required. Defaults 0 (no filter)."),
  }),
  outputSchema: z.object({
    totalSymbols: z.number(),
    validSymbols: z.number(),
    ranked: z.array(
      z.object({
        symbol: z.string(),
        ibs: z.number(),
        rank: z.number(),
        percentile: z.number(),
        position: z.enum(["long", "short", "middle"]),
      }),
    ),
    longBasket: z.array(z.string()),
    shortBasket: z.array(z.string()),
    middleBasket: z.array(z.string()),
    meanIbs: z.number(),
    medianIbs: z.number(),
    ibsSpread: z.number(),
    verdict: z.enum(["ranked", "insufficient_data", "degenerate_bars"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = rankIbsCrossSectional(input.bars, {
      topFraction: input.topFraction,
      bottomFraction: input.bottomFraction,
      minSymbols: input.minSymbols,
      minRangeFraction: input.minRangeFraction,
    });
    recordStructuredObservation({
      eventType: "ibs_cross_sectional.ranked",
      workflow: "analysis",
      source: "agent_tool",
      component: "rank_ibs_cross_sectional",
      toolName: "rank_ibs_cross_sectional",
      outcome: result.verdict === "ranked" ? "info" : "failure",
      details: {
        verdict: result.verdict,
        validSymbols: result.validSymbols,
        longBasketSize: result.longBasket.length,
        shortBasketSize: result.shortBasket.length,
        ibsSpread: result.ibsSpread,
      },
    });
    return {
      totalSymbols: result.totalSymbols,
      validSymbols: result.validSymbols,
      ranked: result.ranked,
      longBasket: result.longBasket,
      shortBasket: result.shortBasket,
      middleBasket: result.middleBasket,
      meanIbs: result.meanIbs,
      medianIbs: result.medianIbs,
      ibsSpread: result.ibsSpread,
      verdict: result.verdict,
      summary: result.summary,
    };
  },
});

export const ibsCrossSectionalTools = {
  rank_ibs_cross_sectional: ibsCrossSectionalDiagnosticTool,
};
