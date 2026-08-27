/**
 * Highest-Volume-Ever Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `detectHighestVolume` from core/alpha/highest-volume-ever.ts.
 * Qullamaggie's HVE/HV1 institutional-conviction signal: latest bar's
 * volume vs the full series + 252-bar window + 60-bar window, gated
 * by closing range, gap-up, and optional float.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { detectHighestVolume } from "../../../../core/alpha/highest-volume-ever.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const highestVolumeEverDiagnosticTool = createTool({
  id: "detect_highest_volume",
  description:
    "Detect HVE (highest volume ever in series) / HV1 (highest in trailing ~1 year) / HV_SHORT " +
    "(highest in trailing ~3 months) on the latest bar, with closing-range + gap-up + optional " +
    "float gates. Use to flag institutional-conviction earnings/news gaps — when the latest bar " +
    "is HV1 or HVE with high conviction, the gap IS the new base. Distinct from volume-trend " +
    "(slope), usdVolumeGate (threshold), fake-liquidity (move-per-dollar outliers).",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          open: z.number().positive(),
          high: z.number().positive(),
          low: z.number().positive(),
          close: z.number().positive(),
          volume: z.number().min(0),
        }),
      )
      .min(2)
      .describe("OHLCV bars ordered oldest → newest. Latest bar is the one being tested."),
    hv1WindowBars: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("HV1 lookback in bars. Default 252."),
    shortWindowBars: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Short-window lookback. Default 60."),
    minClosingRange: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Min closing-range fraction. Default 0.75."),
    floatShares: z.number().positive().optional().describe("Optional float for fast-mover gate."),
    maxFloat: z.number().positive().optional().describe("Float gate max. Default 150,000,000."),
    minGapFraction: z
      .number()
      .min(0)
      .optional()
      .describe("Min gap-up size vs prior close. Default 0.02."),
  }),
  outputSchema: z.object({
    latestVolume: z.number(),
    ranks: z.object({
      overall: z.number(),
      inHv1Window: z.number(),
      inShortWindow: z.number(),
    }),
    isHve: z.boolean(),
    isHv1: z.boolean(),
    isHvShort: z.boolean(),
    isGapUp: z.boolean(),
    closingRange: z.number(),
    closingRangePassed: z.boolean(),
    floatGate: z.enum(["passed", "failed", "not_supplied"]),
    verdict: z.enum(["hve", "hv1", "hv_short", "not_hv", "insufficient_data"]),
    conviction: z.enum(["high", "medium", "low", "fail"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = detectHighestVolume(input.bars, {
      hv1WindowBars: input.hv1WindowBars,
      shortWindowBars: input.shortWindowBars,
      minClosingRange: input.minClosingRange,
      floatShares: input.floatShares,
      maxFloat: input.maxFloat,
      minGapFraction: input.minGapFraction,
    });
    recordStructuredObservation({
      eventType: "highest_volume.detected",
      workflow: "analysis",
      source: "agent_tool",
      component: "detect_highest_volume",
      toolName: "detect_highest_volume",
      outcome: result.verdict === "hve" && result.conviction === "high" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        conviction: result.conviction,
        isHve: result.isHve,
        isHv1: result.isHv1,
        isGapUp: result.isGapUp,
      },
    });
    return result;
  },
});

export const highestVolumeEverTools = {
  detect_highest_volume: highestVolumeEverDiagnosticTool,
};
