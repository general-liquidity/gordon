/**
 * Cross-Sectional Momentum Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `rankCrossSectionalMomentum` from
 * core/alpha/cross-sectional-momentum.ts. Standard quant primitive:
 * rank N assets by return over a lookback, select top-P% (long
 * basket) and bottom-P% (short basket). Drogan / Starkiller cite
 * this as the basic cross-sectional momentum strategy.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { rankCrossSectionalMomentum } from "../../../../core/alpha/cross-sectional-momentum.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const crossSectionalMomentumDiagnosticTool = createTool({
  id: "rank_cross_sectional_momentum",
  description:
    "Rank N assets by return over a lookback window. Returns top-P% (long basket) and bottom-P% " +
    "(short basket) plus median/mean returns + long-short spread. Standard quant primitive used " +
    "for the 'long winners, short losers' strategy. Distinct from streak-detector (single asset) " +
    "and reversal-timing (pair-level). Caller supplies aligned closing price series per symbol.",
  inputSchema: z.object({
    assets: z
      .array(
        z.object({
          symbol: z.string(),
          prices: z.array(z.number()).min(2),
        }),
      )
      .min(5)
      .describe("Per-asset closing prices ordered oldest → newest."),
    topFraction: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Top fraction for long basket. Default 0.20."),
    bottomFraction: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Bottom fraction for short basket. Default 0.20."),
    minEndingPrice: z
      .number()
      .min(0)
      .optional()
      .describe("Drop symbols below this ending price. Default 0."),
    minSymbols: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Min valid symbols for verdict. Default 5."),
  }),
  outputSchema: z.object({
    totalSymbols: z.number(),
    validSymbols: z.number(),
    longBasket: z.array(z.string()),
    shortBasket: z.array(z.string()),
    middleBasket: z.array(z.string()),
    medianReturn: z.number(),
    meanReturn: z.number(),
    longShortSpread: z.number(),
    ranked: z.array(
      z.object({
        symbol: z.string(),
        returnFraction: z.number(),
        rank: z.number(),
        percentile: z.number(),
        position: z.enum(["long", "short", "middle"]),
      }),
    ),
    verdict: z.enum(["ranked", "insufficient_data", "tied_returns_no_basket"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = rankCrossSectionalMomentum(input.assets, {
      topFraction: input.topFraction,
      bottomFraction: input.bottomFraction,
      minEndingPrice: input.minEndingPrice,
      minSymbols: input.minSymbols,
    });
    recordStructuredObservation({
      eventType: "cross_sectional_momentum.ranked",
      workflow: "analysis",
      source: "agent_tool",
      component: "rank_cross_sectional_momentum",
      toolName: "rank_cross_sectional_momentum",
      outcome: "info",
      details: {
        verdict: result.verdict,
        validSymbols: result.validSymbols,
        longCount: result.longBasket.length,
        shortCount: result.shortBasket.length,
        longShortSpread: result.longShortSpread,
      },
    });
    return result;
  },
});

export const crossSectionalMomentumTools = {
  rank_cross_sectional_momentum: crossSectionalMomentumDiagnosticTool,
};
