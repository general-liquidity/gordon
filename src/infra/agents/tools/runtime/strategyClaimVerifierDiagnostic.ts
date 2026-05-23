/**
 * Strategy-Claim Verifier Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `verifyStrategyClaims` from core/alpha/strategy-claim-verifier.ts.
 * Tom's allocator-deconstruction test: given a return series + claimed
 * attributes, mechanically verify consistency. Catches hidden beta,
 * misrepresented gamma posture, inflated Sharpe, and understated
 * drawdown claims.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { verifyStrategyClaims } from "../../../../core/alpha/strategy-claim-verifier.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const strategyClaimVerifierDiagnosticTool = createTool({
  id: "verify_strategy_claims",
  description:
    "Audit a strategy's claimed attributes against its actual return signature. Catches hidden beta " +
    "('claimed market-neutral but carries directional exposure'), misrepresented gamma posture " +
    "('claimed flat but skew + kurtosis show short-gamma'), inflated Sharpe, and understated max " +
    "drawdown. Distinct from composite-attribution (forward attribution of risk verdict) and " +
    "decisionObservabilityDiagnostic (per-decision predictions). Use for operator self-audit or " +
    "external strategy evaluation.",
  inputSchema: z.object({
    strategyReturns: z
      .array(z.number())
      .min(2)
      .describe("Strategy returns ordered oldest → newest (e.g. 0.01 = 1% per period)."),
    benchmarkReturns: z
      .array(z.number())
      .optional()
      .describe("Benchmark returns aligned 1:1. Required iff claims include beta."),
    claims: z
      .object({
        beta: z.number().optional().describe("Claimed beta (0 = market-neutral)."),
        gammaPosture: z
          .enum(["long", "short", "flat"])
          .optional()
          .describe("Claimed gamma posture."),
        sharpe: z.number().optional().describe("Claimed annualized Sharpe."),
        maxDrawdown: z
          .number()
          .min(0)
          .max(1)
          .optional()
          .describe("Claimed max drawdown as positive fraction (0..1)."),
        holdingPeriodPeriods: z
          .number()
          .positive()
          .optional()
          .describe("Claimed average holding period in periods."),
      })
      .describe("Strategy's claimed attributes. At least one must be set."),
    annualizationFactor: z
      .number()
      .positive()
      .optional()
      .describe("Sharpe annualization factor. Default 252 (US equity); use 365 for crypto."),
    betaTolerance: z
      .number()
      .min(0)
      .optional()
      .describe("Tolerance for beta consistency in absolute units. Default 0.10."),
    sharpeTolerance: z
      .number()
      .min(0)
      .optional()
      .describe("Tolerance for Sharpe consistency as fraction. Default 0.25."),
    drawdownTolerance: z
      .number()
      .min(0)
      .optional()
      .describe("Tolerance for max drawdown consistency as fraction. Default 0.25."),
    minPeriods: z
      .number()
      .int()
      .min(2)
      .optional()
      .describe("Minimum periods for verdict. Default 60."),
  }),
  outputSchema: z.object({
    sampleSize: z.number(),
    realized: z.object({
      meanReturn: z.number(),
      stdReturn: z.number(),
      annualizedReturn: z.number(),
      annualizedSharpe: z.number(),
      maxDrawdown: z.number(),
      skewness: z.number(),
      excessKurtosis: z.number(),
      beta: z.number().nullable(),
      autocorrelation: z.number(),
      impliedHoldingPeriod: z.number(),
      worstDay: z.number(),
      bestDay: z.number(),
      worstBestRatio: z.number(),
    }),
    checks: z.array(
      z.object({
        claim: z.string(),
        claimedValue: z.string(),
        realizedValue: z.string(),
        verdict: z.enum([
          "consistent",
          "inconsistent",
          "insufficient_data",
          "not_claimed",
          "missing_input",
        ]),
        reason: z.string(),
      }),
    ),
    consistentCount: z.number(),
    inconsistentCount: z.number(),
    verdict: z.enum([
      "all_consistent",
      "minor_inconsistencies",
      "major_inconsistencies",
      "insufficient_data",
    ]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = verifyStrategyClaims({
      strategyReturns: input.strategyReturns,
      benchmarkReturns: input.benchmarkReturns,
      claims: input.claims,
      annualizationFactor: input.annualizationFactor,
      betaTolerance: input.betaTolerance,
      sharpeTolerance: input.sharpeTolerance,
      drawdownTolerance: input.drawdownTolerance,
      minPeriods: input.minPeriods,
    });
    recordStructuredObservation({
      eventType: "strategy_claim.verified",
      workflow: "audit",
      source: "agent_tool",
      component: "verify_strategy_claims",
      toolName: "verify_strategy_claims",
      outcome: result.verdict === "major_inconsistencies" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        sampleSize: result.sampleSize,
        consistentCount: result.consistentCount,
        inconsistentCount: result.inconsistentCount,
      },
    });
    return {
      sampleSize: result.sampleSize,
      realized: {
        ...result.realized,
        impliedHoldingPeriod: Number.isFinite(result.realized.impliedHoldingPeriod)
          ? result.realized.impliedHoldingPeriod
          : -1,
      },
      checks: result.checks,
      consistentCount: result.consistentCount,
      inconsistentCount: result.inconsistentCount,
      verdict: result.verdict,
      summary: result.summary,
    };
  },
});

export const strategyClaimVerifierTools = {
  verify_strategy_claims: strategyClaimVerifierDiagnosticTool,
};
