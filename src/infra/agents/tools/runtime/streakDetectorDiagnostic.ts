/**
 * Streak-Detector Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `detectStreak` from core/alpha/streak-detector.ts. Connors-style
 * consecutive same-direction bar streak with historical-percentile
 * exhaustion verdict + recommended fade direction. Distinct from
 * streakCircuitBreaker (loss streaks) + hotStreakSizer (PnL streaks).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { detectStreak } from "../../../../core/alpha/streak-detector.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const streakDetectorDiagnosticTool = createTool({
  id: "detect_streak",
  description:
    "Detect a Connors-style consecutive same-direction bar streak (close-to-close). Returns current " +
    "streak length + direction, its percentile in the asset's historical streak-length distribution, " +
    "and an exhaustion verdict (weak / moderate / strong / extreme). Extreme + strong verdicts include " +
    "a recommended fade direction (up streak → short, down streak → long). Use to score mean-reversion " +
    "setups against the asset's OWN history of streaks — not generic thresholds.",
  inputSchema: z.object({
    bars: z
      .array(z.object({ close: z.number() }))
      .min(2)
      .describe("OHLC bars with close prices. Order: oldest → newest."),
    flatToleranceFraction: z
      .number()
      .min(0)
      .optional()
      .describe("|Δclose / priorClose| below this is treated as flat. Default 0."),
    minStreakLength: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Minimum streak length before exhaustion verdict is non-weak. Default 2."),
    lookback: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Lookback window for the historical distribution. Default = all bars."),
    extremePercentile: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Percentile cutoff for 'extreme' verdict. Default 0.97."),
    strongPercentile: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Percentile cutoff for 'strong' verdict. Default 0.90."),
    moderatePercentile: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Percentile cutoff for 'moderate' verdict. Default 0.75."),
  }),
  outputSchema: z.object({
    currentStreakLength: z.number(),
    currentStreakDirection: z.enum(["up", "down", "none"]),
    currentStreakPercentile: z.number(),
    historicalStreakCount: z.number(),
    historicalMeanLength: z.number(),
    historicalMaxLength: z.number(),
    verdict: z.enum([
      "extreme_exhaustion",
      "strong_exhaustion",
      "moderate_exhaustion",
      "weak_exhaustion",
      "insufficient_data",
    ]),
    recommendedFadeDirection: z.enum(["long", "short"]).nullable(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = detectStreak(input.bars, {
      flatToleranceFraction: input.flatToleranceFraction,
      minStreakLength: input.minStreakLength,
      lookback: input.lookback,
      extremePercentile: input.extremePercentile,
      strongPercentile: input.strongPercentile,
      moderatePercentile: input.moderatePercentile,
    });
    recordStructuredObservation({
      eventType: "streak.detected",
      workflow: "analysis",
      source: "agent_tool",
      component: "detect_streak",
      toolName: "detect_streak",
      outcome:
        result.verdict === "extreme_exhaustion" || result.verdict === "strong_exhaustion"
          ? "failure"
          : "info",
      details: {
        verdict: result.verdict,
        direction: result.currentStreakDirection,
        length: result.currentStreakLength,
        percentile: result.currentStreakPercentile,
        recommendedFade: result.recommendedFadeDirection,
      },
    });
    return {
      currentStreakLength: result.currentStreakLength,
      currentStreakDirection: result.currentStreakDirection,
      currentStreakPercentile: result.currentStreakPercentile,
      historicalStreakCount: result.historicalStreakCount,
      historicalMeanLength: result.historicalMeanLength,
      historicalMaxLength: result.historicalMaxLength,
      verdict: result.verdict,
      recommendedFadeDirection: result.recommendedFadeDirection,
      summary: result.summary,
    };
  },
});

export const streakDetectorTools = {
  detect_streak: streakDetectorDiagnosticTool,
};
