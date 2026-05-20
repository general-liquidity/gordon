/**
 * Trendline Detection Diagnostic Tool — TL1 wrapper.
 *
 * Agent-callable. Given a series of price bars (high + low), returns
 * upper and lower trendlines (slope, intercept, r², touch count,
 * endpoint values) via peel-off envelope detection (default) or
 * plain OLS. Use when a strategy thesis references a sloped
 * support/resistance line and the agent needs a concrete computed
 * reference, or when feeding trendline slope as a regime/state
 * feature.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  detectTrendlines,
  trendlineDetectionToPayload,
} from "../../../trading/quant/trendlineDetection.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const BAR_SCHEMA = z.object({
  high: z.number().finite(),
  low: z.number().finite(),
});

const FIT_SCHEMA = z.object({
  side: z.enum(["upper", "lower"]),
  slope: z.number(),
  intercept: z.number(),
  rSquared: z.number(),
  nInliers: z.number(),
  touchCount: z.number(),
  startValue: z.number(),
  endValue: z.number(),
});

export const trendlineDetectionDiagnosticTool = createTool({
  id: "detect_trendlines",
  description:
    "Compute upper and lower trendlines for a series of price bars. " +
    "Method 'peel_off' (default) iteratively peels bars off the wrong side of an OLS fit until " +
    "only envelope points remain — gives sloped support/resistance lines. Method 'ols' returns " +
    "plain best-fit lines through highs/lows — gives general trend direction. " +
    "Returns slope (Δprice/bar), intercept, r², touch count, and line endpoints for both sides.",
  inputSchema: z.object({
    bars: z
      .array(BAR_SCHEMA)
      .min(3)
      .describe("Price bars in chronological order. Index 0 is oldest."),
    method: z
      .enum(["peel_off", "ols"])
      .optional()
      .describe("'peel_off' (default, envelope) or 'ols' (general trend)."),
    minInliers: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Peel-off termination floor. Default 3."),
    touchTolerance: z
      .number()
      .nonnegative()
      .optional()
      .describe("Relative tolerance for touch counting. Default 0.002 (0.2%)."),
  }),
  outputSchema: z.object({
    upper: FIT_SCHEMA,
    lower: FIT_SCHEMA,
    method: z.enum(["peel_off", "ols"]),
    nBars: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = detectTrendlines({
      bars: input.bars,
      method: input.method,
      minInliers: input.minInliers,
      touchTolerance: input.touchTolerance,
    });
    recordStructuredObservation({
      eventType: "trendline.detected",
      workflow: "quant_diagnostic",
      source: "agent_tool",
      component: "detect_trendlines",
      toolName: "detect_trendlines",
      outcome: "info",
      details: { ...(trendlineDetectionToPayload(result) as Record<string, unknown>) },
    });
    return {
      ...result,
      summary: result.reasoning,
    };
  },
});

export const trendlineDetectionTools = {
  detect_trendlines: trendlineDetectionDiagnosticTool,
};
