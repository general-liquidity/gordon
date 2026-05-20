/**
 * Multi-Instrument Optimal Hedge Ratio Diagnostic Tool — HR1 wrapper.
 *
 * Agent-callable. Given a position's return series and a basket of
 * candidate hedge instruments' return series, returns the variance-
 * minimizing hedge weights (regression coefficients of X on Y),
 * residual + position variance, achieved variance reduction, and
 * a condition-number flag for ill-conditioned baskets.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeMultiInstrumentHedgeRatio,
  multiInstrumentHedgeRatioToPayload,
} from "../../../trading/quant/multiInstrumentHedgeRatio.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const multiInstrumentHedgeRatioDiagnosticTool = createTool({
  id: "compute_multi_instrument_hedge_ratio",
  description:
    "Compute the variance-minimizing hedge weights h* = Σ_Y⁻¹ · Σ_XY for hedging a position X with a basket " +
    "of K candidate hedge instruments. Equivalent to OLS regression coefficients of X on (Y_1, ..., Y_K). " +
    "Returns hedge weights, achieved variance reduction (R²), and a condition-number flag for ill-conditioned " +
    "candidate baskets. Use for portfolio-level hedge sizing — generalizes the single-instrument kalmanBeta " +
    "primitive to multiple correlated hedge candidates.",
  inputSchema: z.object({
    positionReturns: z
      .array(z.number())
      .min(2)
      .describe("Return series of the position to hedge (length T)."),
    candidateReturns: z
      .array(z.array(z.number()).min(2))
      .min(1)
      .describe(
        "Return series of K candidate hedge instruments. Outer length = K, each inner array length T.",
      ),
    candidateNames: z
      .array(z.string())
      .optional()
      .describe("Optional names for the K candidates. Default Y_1, Y_2, ..."),
    ridge: z
      .number()
      .min(0)
      .optional()
      .describe(
        "Ridge regularization added to diagonal of Σ_Y. Default 0. Try 1e-6 to 1e-4 for near-collinear baskets.",
      ),
  }),
  outputSchema: z.object({
    hedgeWeights: z.array(
      z.object({
        name: z.string(),
        weight: z.number(),
      }),
    ),
    residualVariance: z.number(),
    positionVariance: z.number(),
    varianceReduction: z.number(),
    conditionNumber: z.number(),
    positionMean: z.number(),
    nObservations: z.number(),
    nCandidates: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeMultiInstrumentHedgeRatio({
      positionReturns: input.positionReturns,
      candidateReturns: input.candidateReturns,
      candidateNames: input.candidateNames,
      ridge: input.ridge,
    });
    recordStructuredObservation({
      eventType: "multi_instrument_hedge_ratio.computed",
      workflow: "risk_management",
      source: "agent_tool",
      component: "compute_multi_instrument_hedge_ratio",
      toolName: "compute_multi_instrument_hedge_ratio",
      outcome: "info",
      details: { ...(multiInstrumentHedgeRatioToPayload(result) as Record<string, unknown>) },
    });
    return {
      hedgeWeights: result.hedgeWeights.map((w) => ({
        name: w.name,
        weight: Number(w.weight.toFixed(6)),
      })),
      residualVariance: Number(result.residualVariance.toFixed(8)),
      positionVariance: Number(result.positionVariance.toFixed(8)),
      varianceReduction: Number(result.varianceReduction.toFixed(6)),
      conditionNumber: Number(result.conditionNumber.toExponential(4)),
      positionMean: Number(result.positionMean.toFixed(8)),
      nObservations: result.nObservations,
      nCandidates: result.nCandidates,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const multiInstrumentHedgeRatioTools = {
  compute_multi_instrument_hedge_ratio: multiInstrumentHedgeRatioDiagnosticTool,
};
