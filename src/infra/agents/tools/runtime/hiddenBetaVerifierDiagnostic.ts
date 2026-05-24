/**
 * Hidden Beta Verifier Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `verifyHiddenBeta` from core/alpha/hidden-beta-verifier.ts.
 * Multi-factor regression of a claimed-neutral portfolio against an
 * operator-supplied factor universe (BTC / ALTS / SPY / etc.), with a
 * verdict identifying which factors leak beyond the neutrality
 * threshold. Operationalizes the "dirty carry trap" — vol-targeting +
 * dollar-neutrality ≠ beta-neutrality.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { verifyHiddenBeta } from "../../../../core/alpha/hidden-beta-verifier.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const hiddenBetaVerifierDiagnosticTool = createTool({
  id: "verify_hidden_beta",
  description:
    "Verify that a claimed-neutral portfolio is actually neutral. Runs multi-factor OLS regression " +
    "of portfolio returns against an operator-supplied factor universe (BTC / ALTS / SPY / etc.) and " +
    "flags factors with |β| above the threshold. Returns per-factor betas, leak summary, estimated " +
    "alpha eaten, and verdict: factor_neutral / hidden_beta_single / hidden_beta_multiple / " +
    "insufficient_data. Operationalizes the 'dirty carry trap' — vol-targeting + dollar-neutrality " +
    "does NOT guarantee beta-neutrality. Delegates math to hedgeFundReplication.",
  inputSchema: z.object({
    portfolioReturns: z
      .array(z.number())
      .min(2)
      .describe("Portfolio return series (oldest → newest)."),
    factors: z
      .array(
        z.object({
          id: z.string(),
          returns: z.array(z.number()).min(2),
        }),
      )
      .min(1)
      .describe("Factor return series to regress against."),
    hiddenBetaThreshold: z
      .number()
      .min(0)
      .optional()
      .describe("Max |β| considered neutral per factor. Default 0.10."),
    minSampleSize: z
      .number()
      .int()
      .min(10)
      .optional()
      .describe("Minimum sample size for a verdict. Default 30."),
  }),
  outputSchema: z.object({
    sampleSize: z.number(),
    factorsTested: z.number(),
    hiddenBetaThreshold: z.number(),
    factorExplainedRSquared: z.number(),
    residualVarianceFraction: z.number(),
    trackingErrorStdev: z.number(),
    perFactor: z.array(
      z.object({
        factorId: z.string(),
        beta: z.number(),
        betaMagnitude: z.number(),
        exceedsThreshold: z.boolean(),
        estimatedAlphaLeak: z.number(),
      }),
    ),
    leakingFactors: z.array(z.string()),
    totalEstimatedAlphaLeak: z.number(),
    verdict: z.enum([
      "factor_neutral",
      "hidden_beta_single",
      "hidden_beta_multiple",
      "insufficient_data",
    ]),
    neutralityConfidence: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = verifyHiddenBeta({
      portfolioReturns: input.portfolioReturns,
      factors: input.factors,
      hiddenBetaThreshold: input.hiddenBetaThreshold,
      minSampleSize: input.minSampleSize,
    });
    recordStructuredObservation({
      eventType: "hidden_beta_verifier.checked",
      workflow: "audit",
      source: "agent_tool",
      component: "verify_hidden_beta",
      toolName: "verify_hidden_beta",
      outcome: result.verdict === "factor_neutral" ? "info" : "failure",
      details: {
        verdict: result.verdict,
        leakingFactors: result.leakingFactors,
        factorExplainedRSquared: result.factorExplainedRSquared,
        totalEstimatedAlphaLeak: result.totalEstimatedAlphaLeak,
        neutralityConfidence: result.neutralityConfidence,
      },
    });
    return result;
  },
});

export const hiddenBetaVerifierTools = {
  verify_hidden_beta: hiddenBetaVerifierDiagnosticTool,
};
