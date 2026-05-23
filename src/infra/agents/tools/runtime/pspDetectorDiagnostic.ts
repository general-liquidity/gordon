/**
 * PSP Detector Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `detectPsp` from core/alpha/psp-detector.ts. Same-bar
 * one-vs-rest candle-close direction divergence across N correlated
 * assets. Distinct from reversal-timing (time-series correlation) and
 * smt-divergence (level-anchored sweep test).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { detectPsp } from "../../../../core/alpha/psp-detector.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const pspDetectorDiagnosticTool = createTool({
  id: "detect_psp",
  description:
    "Detect a Precision Swing Point: one of N correlated assets closes a bar in the OPPOSITE direction " +
    "to the majority on the SAME timeframe at the SAME close time. Pure cross-sectional snapshot check. " +
    "Returns psp_detected when exactly one dissenter exists with a clear majority; all_bullish / " +
    "all_bearish when assets agree; split when no clear majority or multiple dissenters. Caller " +
    "ensures bars are aligned in time + timeframe before calling.",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          symbol: z.string(),
          open: z.number().positive(),
          close: z.number().positive(),
        }),
      )
      .min(2)
      .describe("Same-bar snapshot across N assets: symbol + open + close."),
    dojiToleranceFraction: z
      .number()
      .min(0)
      .optional()
      .describe("|close-open|/open below this is treated as doji. Default 0."),
    dojiCountsTowardMajority: z
      .boolean()
      .optional()
      .describe("Treat dojis as majority members. Default false."),
  }),
  outputSchema: z.object({
    totalAssets: z.number(),
    bullishCount: z.number(),
    bearishCount: z.number(),
    dojiCount: z.number(),
    majorityDirection: z.enum(["bullish", "bearish", "split"]),
    dissenters: z.array(z.string()),
    pspAsset: z.string().nullable(),
    recommendedDirection: z.enum(["long", "short"]).nullable(),
    verdict: z.enum([
      "psp_detected",
      "all_bullish",
      "all_bearish",
      "split",
      "insufficient_data",
    ]),
    assetStatuses: z.array(
      z.object({
        symbol: z.string(),
        direction: z.enum(["bullish", "bearish", "doji"]),
        changeFraction: z.number(),
        isDissenter: z.boolean(),
      }),
    ),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = detectPsp(input.bars, {
      dojiToleranceFraction: input.dojiToleranceFraction,
      dojiCountsTowardMajority: input.dojiCountsTowardMajority,
    });
    recordStructuredObservation({
      eventType: "psp.detected",
      workflow: "analysis",
      source: "agent_tool",
      component: "detect_psp",
      toolName: "detect_psp",
      outcome: result.verdict === "psp_detected" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        majority: result.majorityDirection,
        dissenters: result.dissenters,
        pspAsset: result.pspAsset,
      },
    });
    return result;
  },
});

export const pspDetectorTools = {
  detect_psp: pspDetectorDiagnosticTool,
};
