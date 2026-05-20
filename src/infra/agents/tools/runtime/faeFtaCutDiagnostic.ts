/**
 * FTA Early-Cut Diagnostic Tool — TM1 wrapper.
 *
 * Agent-callable. During an open position's lifetime, the agent calls
 * this with the entry/SL/current price + an FTA threshold (in R units)
 * and gets back a hold/cut verdict + MAE/MFE statistics. Designed to
 * catch trades that are behaving worse than typical winners before
 * they hit the full stoploss.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeFaeFtaCut,
  faeFtaCutToPayload,
} from "../../../trading/quant/faeFtaCut.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const faeFtaCutDiagnosticTool = createTool({
  id: "evaluate_fta_early_cut",
  description:
    "Evaluate whether an open position should be cut early based on the FTA (First Trouble Area) rule. " +
    "Returns the trade's current excursion in R units, MAE/MFE if priceHistory provided, and a hold/cut verdict. " +
    "Use during the position's lifetime — typically called on candle close — to catch trades behaving worse than " +
    "typical winners before they hit the full stoploss.",
  inputSchema: z.object({
    entryPrice: z.number().positive(),
    stoplossPrice: z.number().positive(),
    currentPrice: z
      .number()
      .positive()
      .describe("Latest evaluation price (typically most-recent closed-candle close)."),
    side: z.enum(["BUY", "SELL"]),
    ftaThresholdR: z
      .number()
      .positive()
      .describe(
        "FTA threshold magnitude in R units. E.g., 0.5 means cut if R ≤ −0.5. Calibrate from observed MAE of historical winners.",
      ),
    priceHistory: z
      .array(z.number().positive())
      .optional()
      .describe("Optional closed-candle close prices during the trade (excluding entry). Used to compute MAE/MFE."),
  }),
  outputSchema: z.object({
    riskUnit: z.number(),
    currentR: z.number(),
    maeR: z.number(),
    mfeR: z.number(),
    ftaCrossed: z.boolean(),
    verdict: z.enum(["hold", "cut"]),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeFaeFtaCut({
      entryPrice: input.entryPrice,
      stoplossPrice: input.stoplossPrice,
      currentPrice: input.currentPrice,
      side: input.side,
      ftaThresholdR: input.ftaThresholdR,
      priceHistory: input.priceHistory,
    });
    recordStructuredObservation({
      eventType: "fae_fta_cut.requested",
      workflow: "position_management",
      source: "agent_tool",
      component: "evaluate_fta_early_cut",
      toolName: "evaluate_fta_early_cut",
      outcome: "info",
      details: { ...(faeFtaCutToPayload(result) as Record<string, unknown>) },
    });
    return {
      riskUnit: Number(result.riskUnit.toFixed(6)),
      currentR: Number(result.currentR.toFixed(4)),
      maeR: Number(result.maeR.toFixed(4)),
      mfeR: Number(result.mfeR.toFixed(4)),
      ftaCrossed: result.ftaCrossed,
      verdict: result.verdict,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const faeFtaCutTools = {
  evaluate_fta_early_cut: faeFtaCutDiagnosticTool,
};
