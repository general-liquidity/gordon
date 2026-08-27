/**
 * Time-Based Early-Exit Diagnostic Tool — TM2 wrapper.
 *
 * Agent-callable. Given how long a position has been open and the
 * average winning-trade duration for the strategy, returns a hold/cut
 * verdict based on a configurable multiplier. Cuts "outlier" trades
 * that are behaving abnormally (sitting open way too long) before
 * they have a chance to grind out a worse loss.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeTimeBasedExit,
  timeBasedExitToPayload,
} from "../../../trading/quant/timeBasedExit.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const timeBasedExitDiagnosticTool = createTool({
  id: "evaluate_time_based_exit",
  description:
    "Evaluate whether an open position should be cut early because it has been open abnormally long compared " +
    "to the strategy's average winning trade duration. Returns the duration-ratio and a hold/cut verdict. " +
    "Typical thresholds: 5–10× average winning duration.",
  inputSchema: z.object({
    timeInTrade: z
      .number()
      .min(0)
      .describe("Time the position has been open. Any consistent unit (seconds, minutes, ms)."),
    avgWinningDuration: z
      .number()
      .positive()
      .describe(
        "Average duration of historical winning trades for this strategy. Same unit as timeInTrade.",
      ),
    thresholdMultiplier: z
      .number()
      .gt(1)
      .optional()
      .describe("Cut when timeInTrade ≥ avgWinningDuration × this multiplier. Default 5."),
  }),
  outputSchema: z.object({
    durationRatio: z.number(),
    thresholdMultiplier: z.number(),
    thresholdCrossed: z.boolean(),
    verdict: z.enum(["hold", "cut"]),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeTimeBasedExit({
      timeInTrade: input.timeInTrade,
      avgWinningDuration: input.avgWinningDuration,
      thresholdMultiplier: input.thresholdMultiplier,
    });
    recordStructuredObservation({
      eventType: "time_based_exit.requested",
      workflow: "position_management",
      source: "agent_tool",
      component: "evaluate_time_based_exit",
      toolName: "evaluate_time_based_exit",
      outcome: "info",
      details: { ...(timeBasedExitToPayload(result) as Record<string, unknown>) },
    });
    return {
      durationRatio: Number(result.durationRatio.toFixed(4)),
      thresholdMultiplier: result.thresholdMultiplier,
      thresholdCrossed: result.thresholdCrossed,
      verdict: result.verdict,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const timeBasedExitTools = {
  evaluate_time_based_exit: timeBasedExitDiagnosticTool,
};
