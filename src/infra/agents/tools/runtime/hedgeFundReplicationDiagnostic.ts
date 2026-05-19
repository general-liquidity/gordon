/**
 * Hedge Fund Replication Diagnostic Tool — exposed via /replicate-fund.
 *
 * Wraps `computeHedgeFundReplication` (TS13) — constrained OLS that
 * discovers the allocation weights minimizing tracking error against
 * a target return series.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeHedgeFundReplication,
  replicationToPayload,
} from "../../../trading/quant/hedgeFundReplication.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const hedgeFundReplicationDiagnosticTool = createTool({
  id: "replicate_hedge_fund",
  description:
    "Solve for the allocation weights that best replicate a target return series given a basket of factor returns. " +
    "Use when the operator asks `/replicate-fund`, or when reverse-engineering a published track or sector basket. " +
    "Returns weights per factor, tracking-error stdev, and R². Refuses with `singular` if the factors are collinear.",
  inputSchema: z.object({
    targetReturns: z.array(z.number()).min(4).describe("Target return series, newest last."),
    factors: z
      .array(
        z.object({
          id: z.string(),
          returns: z.array(z.number()),
        }),
      )
      .min(1)
      .describe("Factor return series; each must align with targetReturns."),
    normalizeWeights: z
      .boolean()
      .default(false)
      .describe("Renormalize weights to sum to 1 after solving. Default false."),
  }),
  outputSchema: z.object({
    weights: z.array(z.object({ id: z.string(), weight: z.number() })),
    rSquared: z.number().nullable(),
    trackingErrorStdev: z.number().nullable(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeHedgeFundReplication({
      targetReturns: input.targetReturns,
      factors: input.factors,
      normalizeWeights: input.normalizeWeights,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "hedge_fund_replication.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "replicate_hedge_fund",
      toolName: "replicate_hedge_fund",
      outcome: Number.isFinite(result.rSquared) ? "success" : "failure",
      details: { ...(replicationToPayload(result) as Record<string, unknown>) },
    });
    return {
      weights: result.weights.map((w) => ({ id: w.id, weight: Number(w.weight.toFixed(5)) })),
      rSquared: Number.isFinite(result.rSquared) ? Number(result.rSquared.toFixed(4)) : null,
      trackingErrorStdev: Number.isFinite(result.trackingErrorStdev)
        ? Number(result.trackingErrorStdev.toFixed(6))
        : null,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const hedgeFundReplicationTools = {
  replicate_hedge_fund: hedgeFundReplicationDiagnosticTool,
};
