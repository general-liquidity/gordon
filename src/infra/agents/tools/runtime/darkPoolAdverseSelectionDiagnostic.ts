/**
 * Dark-Pool Adverse-Selection Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `scoreDarkPoolAdverseSelection` from
 * core/alpha/dark-pool-adverse-selection.ts. Venue-level batch
 * analytics on dark-pool fills measuring the implicit adverse-
 * selection fee + comparing to the nominal lit-market saving.
 * Distinct from the per-fill adverseSelectionDetector (Wright Ch3
 * style) — this aggregates and gives a net economic verdict.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { scoreDarkPoolAdverseSelection } from "../../../../core/alpha/dark-pool-adverse-selection.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const darkPoolAdverseSelectionDiagnosticTool = createTool({
  id: "score_dark_pool_adverse_selection",
  description:
    "Score a batch of dark-pool fills for the implicit adverse-selection fee vs the nominal " +
    "lit-market saving (half the bid-ask spread). Each fill: side, fillPrice, quantity, " +
    "midPriceAfterWindow, litMarketSpread at time of fill. Returns avg adverse move + avg nominal " +
    "saving + net (both as bps) + verdict (net_benefit / breakeven / net_loss). Distinct from the " +
    "per-fill adverse-selection detector — this measures venue-level economics over many fills.",
  inputSchema: z.object({
    fills: z
      .array(
        z.object({
          side: z.enum(["buy", "sell"]),
          fillPrice: z.number().positive(),
          quantity: z.number().min(0),
          midPriceAfterWindow: z.number().positive(),
          litMarketSpread: z.number().min(0),
        }),
      )
      .min(1)
      .describe("Dark-pool fills with post-fill reference price + lit-market spread."),
    minFills: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Minimum fills for a verdict. Default 20."),
    breakevenBandBps: z
      .number()
      .min(0)
      .optional()
      .describe("Tolerance band in bps for breakeven verdict. Default 1."),
  }),
  outputSchema: z.object({
    fillCount: z.number(),
    totalQuantity: z.number(),
    avgAdverseMovePerShare: z.number(),
    avgAdverseMoveBps: z.number(),
    avgNominalSavingPerShare: z.number(),
    avgNominalSavingBps: z.number(),
    netPerShare: z.number(),
    netBps: z.number(),
    verdict: z.enum(["net_benefit", "breakeven", "net_loss", "insufficient_data"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = scoreDarkPoolAdverseSelection(input.fills, {
      minFills: input.minFills,
      breakevenBandBps: input.breakevenBandBps,
    });
    recordStructuredObservation({
      eventType: "dark_pool_adverse_selection.scored",
      workflow: "analysis",
      source: "agent_tool",
      component: "score_dark_pool_adverse_selection",
      toolName: "score_dark_pool_adverse_selection",
      outcome: result.verdict === "net_loss" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        fillCount: result.fillCount,
        netBps: result.netBps,
        avgAdverseMoveBps: result.avgAdverseMoveBps,
      },
    });
    return result;
  },
});

export const darkPoolAdverseSelectionTools = {
  score_dark_pool_adverse_selection: darkPoolAdverseSelectionDiagnosticTool,
};
