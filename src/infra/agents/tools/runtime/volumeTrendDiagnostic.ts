/**
 * Volume-Trend Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `analyzeVolumeTrend` from core/alpha/volume-trend.ts. Quantifies
 * Spicy's cheat sheet — increasing volume favors breakouts, decreasing
 * favors reversals — with intensity bands. Returns a directional verdict
 * the agent can fold into its setup-grading.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { analyzeVolumeTrend } from "../../../../core/alpha/volume-trend.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const volumeTrendDiagnosticTool = createTool({
  id: "analyze_volume_trend",
  description:
    "Quantify recent USD-volume slope as a breakout/reversal-friendly verdict. " +
    "Returns direction (increasing/decreasing/flat) + intensity (intense/moderate/weak/flat) → verdict band. " +
    "Increasing volume favors momentum/breakout entries; decreasing favors mean-reversion. " +
    "Use after a liquidity gate passes — answers 'what KIND of setup does the volume profile favor?'.",
  inputSchema: z.object({
    candles: z
      .array(
        z.object({
          close: z.number().positive(),
          volume: z.number().min(0),
        }),
      )
      .min(2)
      .describe("Recent OHLCV candles with close + volume (contract units, not USD)."),
    window: z.number().int().min(2).optional().describe("Lookback window in candles. Default 20."),
    minCandles: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Minimum candles required for a verdict. Default 10."),
    intenseThresholdPct: z
      .number()
      .positive()
      .optional()
      .describe("|slope %/candle| ≥ this → intense. Default 10."),
    moderateThresholdPct: z
      .number()
      .positive()
      .optional()
      .describe("|slope %/candle| ≥ this → moderate (below intense). Default 3."),
  }),
  outputSchema: z.object({
    windowSize: z.number(),
    meanVolUSD: z.number(),
    slopeUSDPerCandle: z.number(),
    slopePctPerCandle: z.number(),
    direction: z.enum(["increasing", "decreasing", "flat"]),
    intensity: z.enum(["intense", "moderate", "weak", "flat"]),
    verdict: z.enum([
      "strongly_breakout_friendly",
      "moderately_breakout_friendly",
      "weakly_breakout_friendly",
      "neutral",
      "weakly_reversal_friendly",
      "moderately_reversal_friendly",
      "strongly_reversal_friendly",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = analyzeVolumeTrend(input.candles, {
      window: input.window,
      minCandles: input.minCandles,
      intenseThresholdPct: input.intenseThresholdPct,
      moderateThresholdPct: input.moderateThresholdPct,
    });
    recordStructuredObservation({
      eventType: "volume_trend.analyzed",
      workflow: "analysis",
      source: "agent_tool",
      component: "analyze_volume_trend",
      toolName: "analyze_volume_trend",
      outcome: "info",
      details: {
        verdict: result.verdict,
        direction: result.direction,
        intensity: result.intensity,
        slopePctPerCandle: result.slopePctPerCandle,
        windowSize: result.windowSize,
      },
    });
    return {
      windowSize: result.windowSize,
      meanVolUSD: result.meanVolUSD,
      slopeUSDPerCandle: result.slopeUSDPerCandle,
      slopePctPerCandle: result.slopePctPerCandle,
      direction: result.direction,
      intensity: result.intensity,
      verdict: result.verdict,
      summary: result.summary,
    };
  },
});

export const volumeTrendTools = {
  analyze_volume_trend: volumeTrendDiagnosticTool,
};
