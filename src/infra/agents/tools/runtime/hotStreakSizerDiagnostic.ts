/**
 * Hot-Streak Sizing Diagnostic Tool — D1 wrapper.
 *
 * Agent-callable. Given the operator's recent realized P&L and
 * optional threshold parameters, returns streak classification +
 * suggested multiplier + effective multiplier (governed by mode).
 *
 * Default mode is informational — the agent gets the observation but
 * the effective multiplier stays at 1.0. The operator must explicitly
 * call with `mode: "active"` to apply the multiplier to actual sizing.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeHotStreakSizing,
  hotStreakSizerToPayload,
} from "../../../trading/quant/hotStreakSizer.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const hotStreakSizerDiagnosticTool = createTool({
  id: "evaluate_hot_streak_sizing",
  description:
    "Evaluate Druckenmiller's 'bet big when hot' sizing rule against the operator's recent realized P&L. " +
    "Returns streak classification (hot / neutral_positive / neutral_negative / cold), suggested multiplier, " +
    "and effective multiplier. Default mode is informational — effective stays at 1.0 and suggested is " +
    "returned as an observation only. Use mode='active' to apply the multiplier to actual sizing decisions.",
  inputSchema: z.object({
    recentRealizedPnLPct: z
      .number()
      .describe(
        "Recent realized P&L as a fraction (e.g., 0.20 = +20%) over a caller-defined window.",
      ),
    hotThresholdPct: z
      .number()
      .positive()
      .optional()
      .describe("Positive P&L threshold above which 'hot' engages. Default 0.20."),
    coolThresholdPct: z
      .number()
      .negative()
      .optional()
      .describe("Negative P&L threshold below which 'cold' engages. Default -0.05."),
    maxMultiplier: z
      .number()
      .min(1)
      .optional()
      .describe("Cap on suggested multiplier when hot. Default 1.5."),
    coldMultiplier: z
      .number()
      .min(0)
      .optional()
      .describe("Multiplier applied when cold. Default 0.5. Set to 0 to refuse entirely."),
    mode: z
      .enum(["informational", "active"])
      .optional()
      .describe(
        "informational (default) → observation only; active → apply the suggested multiplier.",
      ),
  }),
  outputSchema: z.object({
    classification: z.enum(["hot", "neutral_positive", "neutral_negative", "cold"]),
    suggestedMultiplier: z.number(),
    effectiveMultiplier: z.number(),
    mode: z.enum(["informational", "active"]),
    recommendedAction: z.enum([
      "hold",
      "size_up_unlocked",
      "size_up_suggested_informational",
      "size_down",
      "size_down_suggested_informational",
      "minimum_probe_only",
      "refuse",
    ]),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeHotStreakSizing({
      recentRealizedPnLPct: input.recentRealizedPnLPct,
      hotThresholdPct: input.hotThresholdPct,
      coolThresholdPct: input.coolThresholdPct,
      maxMultiplier: input.maxMultiplier,
      coldMultiplier: input.coldMultiplier,
      mode: input.mode,
    });
    recordStructuredObservation({
      eventType: "hot_streak_sizer.requested",
      workflow: "sizing",
      source: "agent_tool",
      component: "evaluate_hot_streak_sizing",
      toolName: "evaluate_hot_streak_sizing",
      outcome: "info",
      details: { ...(hotStreakSizerToPayload(result) as Record<string, unknown>) },
    });
    return {
      classification: result.classification,
      suggestedMultiplier: Number(result.suggestedMultiplier.toFixed(4)),
      effectiveMultiplier: Number(result.effectiveMultiplier.toFixed(4)),
      mode: result.mode,
      recommendedAction: result.recommendedAction,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const hotStreakSizerTools = {
  evaluate_hot_streak_sizing: hotStreakSizerDiagnosticTool,
};
