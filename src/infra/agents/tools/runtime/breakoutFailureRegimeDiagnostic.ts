/**
 * Breakout-Failure-Rate Regime Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `analyzeBreakoutFailureRegime` from
 * core/alpha/breakout-failure-regime.ts. Classifies the market into
 * healthy_bull / weakening / bear_like / bear_confirmed based on the
 * rolling rate at which recent universe breakouts followed through vs
 * failed. Detects bear-like regime BEFORE indexes confirm.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { analyzeBreakoutFailureRegime } from "../../../../core/alpha/breakout-failure-regime.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const breakoutFailureRegimeDiagnosticTool = createTool({
  id: "analyze_breakout_failure_regime",
  description:
    "Classify market regime by tracking breakout follow-through vs failure across a universe. " +
    "Verdicts: healthy_bull (≤30% fails) / weakening / bear_like (Zanger's warning band, 50-70% " +
    "fails) / bear_confirmed (>70%) / insufficient_data. Detects bear-like regime before index " +
    "drawdown confirms it. Distinct from marketBreadthBias (return-sign tally) and markovRegime " +
    "(HMM state inference). Compose with both for cross-confirmation.",
  inputSchema: z.object({
    events: z
      .array(
        z.object({
          symbol: z.string(),
          breakoutAt: z.number(),
          evaluatedAt: z.number().optional(),
          outcome: z.enum(["followed_through", "failed", "pending"]),
        }),
      )
      .min(1)
      .describe("Rolling log of breakout events with their evaluated outcomes."),
    minEvaluatedEvents: z.number().int().min(1).optional(),
    windowSize: z.number().int().min(1).optional(),
    healthyBullCeiling: z.number().min(0).max(1).optional(),
    weakeningCeiling: z.number().min(0).max(1).optional(),
    bearLikeCeiling: z.number().min(0).max(1).optional(),
  }),
  outputSchema: z.object({
    totalEvents: z.number(),
    evaluatedEvents: z.number(),
    pendingEvents: z.number(),
    windowUsed: z.number(),
    failed: z.number(),
    followedThrough: z.number(),
    failureRate: z.number(),
    followThroughRate: z.number(),
    verdict: z.enum([
      "healthy_bull",
      "weakening",
      "bear_like",
      "bear_confirmed",
      "insufficient_data",
    ]),
    bearishScore: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = analyzeBreakoutFailureRegime(input.events, {
      minEvaluatedEvents: input.minEvaluatedEvents,
      windowSize: input.windowSize,
      healthyBullCeiling: input.healthyBullCeiling,
      weakeningCeiling: input.weakeningCeiling,
      bearLikeCeiling: input.bearLikeCeiling,
    });
    recordStructuredObservation({
      eventType: "breakout_failure_regime.analyzed",
      workflow: "analysis",
      source: "agent_tool",
      component: "analyze_breakout_failure_regime",
      toolName: "analyze_breakout_failure_regime",
      outcome:
        result.verdict === "bear_like" || result.verdict === "bear_confirmed"
          ? "failure"
          : "info",
      details: {
        verdict: result.verdict,
        failureRate: result.failureRate,
        bearishScore: result.bearishScore,
        windowUsed: result.windowUsed,
      },
    });
    return result;
  },
});

export const breakoutFailureRegimeTools = {
  analyze_breakout_failure_regime: breakoutFailureRegimeDiagnosticTool,
};
