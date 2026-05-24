/**
 * MA-Crossover Cleanness Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `classifyMaCrossoverCleanness` from core/alpha/ma-crossover-cleanness.ts.
 * Counts crosses of price vs an SMMA (default length 30) and combines with
 * MA terminal slope to verdict trend cleanness + edge activation. Koroush
 * AK / ZCT 2025 MA masterclass framing.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { classifyMaCrossoverCleanness } from "../../../../core/alpha/ma-crossover-cleanness.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const maCrossoverCleannessDiagnosticTool = createTool({
  id: "classify_ma_crossover_cleanness",
  description:
    "Classify trend cleanness by counting price/SMMA crosses + MA terminal slope. Default SMMA(30); " +
    "0-3 crosses + trending MA = clean_trend (momentum-favorable); 4-6 + trending = messy_trend " +
    "(mixed); 7+ OR sideways MA = chop (mean-reversion-favorable). Wick-inclusive cross counting per " +
    "Koroush AK ZCT-2025 rules. Distinct from meanCrossingFrequency (Sarmento pairs-eligibility) and " +
    "ma-proximity (single-bar R:R classifier).",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          open: z.number(),
          high: z.number(),
          low: z.number(),
          close: z.number(),
        }),
      )
      .min(1)
      .describe("OHLC bars ordered oldest → newest. Needs ≥ maLength + slopeWindow bars."),
    maLength: z.number().int().min(2).optional().describe("SMMA length. Default 30."),
    startBarIndex: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Index to begin cross counting (skip pre-breakout consolidation). Default 0."),
    slopeWindow: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Bars from end used to compute MA slope. Default 10."),
    trendingSlopeThreshold: z
      .number()
      .min(0)
      .optional()
      .describe("Min |slope|/SMMA per bar to count as trending. Default 0.0005."),
    cleanCrossCeiling: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe("Crosses ≤ this + trending MA = clean. Default 3."),
    messyCrossCeiling: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Crosses ≤ this + trending MA = messy. Default 6."),
  }),
  outputSchema: z.object({
    totalBars: z.number(),
    maLength: z.number(),
    smmaSeries: z.array(z.number()),
    crossCount: z.number(),
    crossIndices: z.array(z.number()),
    maDirection: z.enum(["trending_up", "trending_down", "sideways"]),
    smmaSlope: z.number(),
    slopeFraction: z.number(),
    cleanness: z.enum(["clean_trend", "messy_trend", "chop"]),
    edgeActivation: z.enum([
      "momentum_favorable",
      "mean_reversion_favorable",
      "mixed",
      "insufficient_data",
    ]),
    cleannessScore: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = classifyMaCrossoverCleanness(input.bars, {
      maLength: input.maLength,
      startBarIndex: input.startBarIndex,
      slopeWindow: input.slopeWindow,
      trendingSlopeThreshold: input.trendingSlopeThreshold,
      cleanCrossCeiling: input.cleanCrossCeiling,
      messyCrossCeiling: input.messyCrossCeiling,
    });
    recordStructuredObservation({
      eventType: "ma_crossover_cleanness.classified",
      workflow: "analysis",
      source: "agent_tool",
      component: "classify_ma_crossover_cleanness",
      toolName: "classify_ma_crossover_cleanness",
      outcome: result.edgeActivation === "insufficient_data" ? "failure" : "info",
      details: {
        edgeActivation: result.edgeActivation,
        cleanness: result.cleanness,
        crossCount: result.crossCount,
        maDirection: result.maDirection,
        cleannessScore: result.cleannessScore,
      },
    });
    return result;
  },
});

export const maCrossoverCleannessTools = {
  classify_ma_crossover_cleanness: maCrossoverCleannessDiagnosticTool,
};
