/**
 * Volume-Pattern Edge Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `classifyVolumePatternEdge` from core/alpha/volume-pattern-edge.ts.
 * Three-way volume-shape classifier (increasing / flat / decreasing /
 * spike) with explicit edge activation mapping. Koroush AK / ZCT 2025
 * volume masterclass framing.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { classifyVolumePatternEdge } from "../../../../core/alpha/volume-pattern-edge.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const volumePatternEdgeDiagnosticTool = createTool({
  id: "classify_volume_pattern_edge",
  description:
    "Classify volume pattern (increasing / flat / decreasing / spike_with_price / spike_isolated) " +
    "and map to edge activation: increasing → momentum_favorable, flat → mean_reversion_favorable, " +
    "spike_with_price → reversal_setup, decreasing/spike_isolated → no_edge. Adds the explicit " +
    "'flat' intermediate state and price-coincident spike trigger that volume-trend (single-slope) " +
    "lacks. Composes with ma-crossover-cleanness (LV31) for cross-confirmation.",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          open: z.number(),
          high: z.number(),
          low: z.number(),
          close: z.number(),
          volume: z.number().min(0),
        }),
      )
      .min(1)
      .describe("OHLCV bars ordered oldest → newest. Last bar is the spike candidate."),
    window: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Lookback window in bars. Default 20."),
    trendingSlopePctPerBar: z
      .number()
      .min(0)
      .optional()
      .describe("Slope %/bar threshold to classify increasing/decreasing. Default 0.03."),
    spikeMultiple: z
      .number()
      .min(1)
      .optional()
      .describe("Terminal-bar volume / mean to qualify as spike. Default 2.5."),
    priceSpikeBodyFraction: z
      .number()
      .min(0)
      .optional()
      .describe("Body |close-open|/open on spike bar that escalates to with_price. Default 0.03."),
    minBars: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Minimum bars required for a verdict. Default 5."),
  }),
  outputSchema: z.object({
    totalBars: z.number(),
    windowUsed: z.number(),
    meanVolume: z.number(),
    volumeStd: z.number(),
    volumeSlope: z.number(),
    volumeSlopePctPerBar: z.number(),
    terminalVolume: z.number(),
    terminalVolumeMultiple: z.number(),
    terminalBodyFraction: z.number(),
    pattern: z.enum([
      "increasing",
      "flat",
      "decreasing",
      "spike_isolated",
      "spike_with_price",
      "insufficient_data",
    ]),
    edgeActivation: z.enum([
      "momentum_favorable",
      "mean_reversion_favorable",
      "reversal_setup",
      "no_edge",
      "insufficient_data",
    ]),
    patternScore: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = classifyVolumePatternEdge(input.bars, {
      window: input.window,
      trendingSlopePctPerBar: input.trendingSlopePctPerBar,
      spikeMultiple: input.spikeMultiple,
      priceSpikeBodyFraction: input.priceSpikeBodyFraction,
      minBars: input.minBars,
    });
    recordStructuredObservation({
      eventType: "volume_pattern_edge.classified",
      workflow: "analysis",
      source: "agent_tool",
      component: "classify_volume_pattern_edge",
      toolName: "classify_volume_pattern_edge",
      outcome: result.edgeActivation === "insufficient_data" ? "failure" : "info",
      details: {
        pattern: result.pattern,
        edgeActivation: result.edgeActivation,
        patternScore: result.patternScore,
        terminalVolumeMultiple: result.terminalVolumeMultiple,
        volumeSlopePctPerBar: result.volumeSlopePctPerBar,
      },
    });
    return result;
  },
});

export const volumePatternEdgeTools = {
  classify_volume_pattern_edge: volumePatternEdgeDiagnosticTool,
};
