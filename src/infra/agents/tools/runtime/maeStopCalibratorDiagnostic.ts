/**
 * MAE Stop Calibrator Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `calibrateMaeStop` from core/alpha/mae-stop-calibrator.ts.
 * Consumes a closed-trade ledger and recommends an empirically-derived
 * tight stop based on the P95 (or configurable percentile) of winner
 * MAE. Companion to TM1 `faeFtaCut` (LIVE decision tool that consumes a
 * pre-calibrated threshold).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { calibrateMaeStop } from "../../../../core/alpha/mae-stop-calibrator.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const distributionSchema = z
  .object({
    count: z.number(),
    mean: z.number(),
    median: z.number(),
    p75: z.number(),
    p90: z.number(),
    p95: z.number(),
    p99: z.number(),
    min: z.number(),
    max: z.number(),
  })
  .nullable();

export const maeStopCalibratorDiagnosticTool = createTool({
  id: "calibrate_mae_stop",
  description:
    "Calibrate a tight stop from a closed-trade ledger by computing winner-MAE distribution and " +
    "recommending P95 (configurable). Returns winner/loser MAE+MFE distributions, recommended stop, " +
    "and a counterfactual (if currentStopPct supplied): how many winners preserved, losers cut " +
    "earlier, and saved fraction. Verdict: tighten_stop_recommended / current_stop_is_appropriate / " +
    "widen_stop_needed / insufficient_data. Companion to faeFtaCut (TM1) which consumes the " +
    "threshold this primitive produces.",
  inputSchema: z.object({
    trades: z
      .array(
        z.object({
          tradeId: z.string(),
          side: z.enum(["LONG", "SHORT"]),
          entryPrice: z.number().positive(),
          exitPrice: z.number().positive(),
          maxAdverseExcursionPct: z.number().min(0).optional(),
          maxFavorableExcursionPct: z.number().min(0).optional(),
          highWhileOpen: z.number().positive().optional(),
          lowWhileOpen: z.number().positive().optional(),
          outcome: z.enum(["winner", "loser", "breakeven"]).optional(),
        }),
      )
      .min(1)
      .describe(
        "Closed-trade ledger. Each trade needs either pre-computed MAE/MFE percentages OR " +
          "highWhileOpen + lowWhileOpen so the primitive can compute them.",
      ),
    tightStopPercentile: z
      .number()
      .min(0.5)
      .max(1)
      .optional()
      .describe("Percentile of winner MAE used as the recommended stop. Default 0.95."),
    currentStopPct: z
      .number()
      .min(0)
      .optional()
      .describe("Current stop as positive fraction (e.g. 0.05 = 5%). Unlocks counterfactual."),
    minWinners: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Minimum winners for a recommendation. Default 10."),
    appropriateToleranceFraction: z
      .number()
      .min(0)
      .max(1)
      .optional()
      .describe("Tolerance band for 'current_stop_is_appropriate'. Default 0.15."),
    breakevenEpsilon: z
      .number()
      .min(0)
      .optional()
      .describe("PnL fraction below which trade is breakeven. Default 0.0005."),
  }),
  outputSchema: z.object({
    totalTrades: z.number(),
    winners: z.number(),
    losers: z.number(),
    breakevens: z.number(),
    perTrade: z.array(
      z.object({
        tradeId: z.string(),
        side: z.enum(["LONG", "SHORT"]),
        outcome: z.enum(["winner", "loser", "breakeven"]),
        mae: z.number(),
        mfe: z.number(),
      }),
    ),
    winnerMae: distributionSchema,
    loserMae: distributionSchema,
    winnerMfe: distributionSchema,
    loserMfe: distributionSchema,
    recommendedTightStopPct: z.number().nullable(),
    currentStopPct: z.number().nullable(),
    counterfactual: z
      .object({
        winnersPreservedAtNewStop: z.number(),
        winnersLostAtNewStop: z.number(),
        losersCutEarlierAtNewStop: z.number(),
        estimatedSavedFractionOnLosers: z.number(),
      })
      .nullable(),
    verdict: z.enum([
      "tighten_stop_recommended",
      "current_stop_is_appropriate",
      "widen_stop_needed",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = calibrateMaeStop(input.trades, {
      tightStopPercentile: input.tightStopPercentile,
      currentStopPct: input.currentStopPct,
      minWinners: input.minWinners,
      appropriateToleranceFraction: input.appropriateToleranceFraction,
      breakevenEpsilon: input.breakevenEpsilon,
    });
    recordStructuredObservation({
      eventType: "mae_stop_calibrator.calibrated",
      workflow: "audit",
      source: "agent_tool",
      component: "calibrate_mae_stop",
      toolName: "calibrate_mae_stop",
      outcome: result.verdict === "tighten_stop_recommended" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        winners: result.winners,
        losers: result.losers,
        recommendedTightStopPct: result.recommendedTightStopPct,
        currentStopPct: result.currentStopPct,
        savedFraction:
          result.counterfactual?.estimatedSavedFractionOnLosers ?? null,
      },
    });
    return result;
  },
});

export const maeStopCalibratorTools = {
  calibrate_mae_stop: maeStopCalibratorDiagnosticTool,
};
