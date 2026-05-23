/**
 * Volume-Exhaustion Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `detectVolumeExhaustion` from core/alpha/volume-exhaustion.ts.
 * In-trade monitor for breakout entries: when volume drops sharply
 * from the entry baseline, the conditions that justified the entry
 * have changed and the agent should consider scaling out before the
 * stop-loss fires. Inert for mean-reversion entries (which want
 * decreasing volume).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { detectVolumeExhaustion } from "../../../../core/alpha/volume-exhaustion.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const volumeExhaustionDiagnosticTool = createTool({
  id: "detect_volume_exhaustion",
  description:
    "Detect volume exhaustion in an active BREAKOUT trade. Compares post-entry mean USD volume " +
    "to the entry-window baseline; emits hold / tighten_stop / scale_out / exit_full. " +
    "Inert for mean-reversion entries. Call during position-monitoring loops — Spicy's pattern: " +
    "'volume drops off while in a breakout = exit before the SL fires for a smaller loss'.",
  inputSchema: z.object({
    strategy: z
      .enum(["breakout", "mean_reversion"])
      .describe("Entry strategy. Only 'breakout' emits actionable signals."),
    baselineMeanVolUSD: z
      .number()
      .min(0)
      .describe("Mean USD volume over the entry-window candles."),
    currentMeanVolUSD: z
      .number()
      .min(0)
      .describe("Mean USD volume over the post-entry candles."),
    postEntryCandles: z
      .number()
      .int()
      .min(0)
      .describe("Number of post-entry candles in the current observation."),
    minPostEntryCandles: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Minimum post-entry candles before emitting. Default 5."),
    mildDropThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Drop fraction for 'mild' severity. Default 0.25."),
    severeDropThreshold: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Drop fraction for 'severe' severity. Default 0.50."),
  }),
  outputSchema: z.object({
    applicable: z.boolean(),
    dropFraction: z.number(),
    severity: z.enum(["none", "mild", "severe"]),
    action: z.enum([
      "hold",
      "tighten_stop",
      "scale_out",
      "exit_full",
      "not_applicable",
      "insufficient_data",
    ]),
    signal: z.boolean(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = detectVolumeExhaustion({
      strategy: input.strategy,
      baselineMeanVolUSD: input.baselineMeanVolUSD,
      currentMeanVolUSD: input.currentMeanVolUSD,
      postEntryCandles: input.postEntryCandles,
      minPostEntryCandles: input.minPostEntryCandles,
      mildDropThreshold: input.mildDropThreshold,
      severeDropThreshold: input.severeDropThreshold,
    });
    recordStructuredObservation({
      eventType: "volume_exhaustion.detected",
      workflow: "position_monitoring",
      source: "agent_tool",
      component: "detect_volume_exhaustion",
      toolName: "detect_volume_exhaustion",
      outcome: result.severity === "severe" ? "failure" : "info",
      details: {
        applicable: result.applicable,
        severity: result.severity,
        action: result.action,
        dropFraction: result.dropFraction,
        signal: result.signal,
      },
    });
    return {
      applicable: result.applicable,
      dropFraction: result.dropFraction,
      severity: result.severity,
      action: result.action,
      signal: result.signal,
      summary: result.summary,
    };
  },
});

export const volumeExhaustionTools = {
  detect_volume_exhaustion: volumeExhaustionDiagnosticTool,
};
