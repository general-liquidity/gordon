/**
 * Wipeout-Cap Sizer Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `sizeWithWipeoutCap` from core/alpha/wipeout-cap-sizer.ts.
 * Drogan / Starkiller-style position sizing: bound worst-case loss
 * to a fraction of total book based on wipeout probability. Distinct
 * from Kelly-based `position-sizer.ts` which optimizes for expected
 * utility; this bounds for worst-case.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { sizeWithWipeoutCap } from "../../../../core/alpha/wipeout-cap-sizer.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const wipeoutCapSizerDiagnosticTool = createTool({
  id: "size_with_wipeout_cap",
  description:
    "Size a position by capping worst-case wipeout loss to a fraction of book. Inputs: expected yield, " +
    "wipeout probability (in [0,1]), max acceptable book-loss fraction (default 1%), optional min/max " +
    "position fraction. Returns position size as fraction of book + worst-case + expected EV. Distinct " +
    "from Kelly sizing (expected-utility-optimal) — this is failure-probability-bounded sizing. Useful " +
    "when downside is binary (full loss vs success) or distributions are hard to estimate.",
  inputSchema: z.object({
    expectedYield: z.number().describe("Expected yield as decimal (e.g. 0.10 = 10%)."),
    wipeoutProbability: z
      .number()
      .min(0)
      .max(1)
      .describe("Probability of complete wipeout, in [0, 1]."),
    maxBookLossFraction: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Max acceptable book loss on this position. Default 0.01 (1%)."),
    minPositionFraction: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Min position fraction. Default 0."),
    maxPositionFraction: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Max position fraction regardless of math. Default 1.0."),
  }),
  outputSchema: z.object({
    positionFraction: z.number(),
    expectedBookReturn: z.number(),
    worstCaseBookLoss: z.number(),
    expectedYieldOnPosition: z.number(),
    netEv: z.number(),
    verdict: z.enum(["sized", "below_minimum", "invalid_inputs"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = sizeWithWipeoutCap(input);
    recordStructuredObservation({
      eventType: "wipeout_cap.sized",
      workflow: "execution",
      source: "agent_tool",
      component: "size_with_wipeout_cap",
      toolName: "size_with_wipeout_cap",
      outcome: result.netEv < 0 ? "failure" : "info",
      details: {
        verdict: result.verdict,
        positionFraction: result.positionFraction,
        worstCaseBookLoss: result.worstCaseBookLoss,
        netEv: result.netEv,
      },
    });
    return result;
  },
});

export const wipeoutCapSizerTools = {
  size_with_wipeout_cap: wipeoutCapSizerDiagnosticTool,
};
