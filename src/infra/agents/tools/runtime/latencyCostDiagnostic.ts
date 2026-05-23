/**
 * Latency-Cost Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `estimateLatencyCost` from core/alpha/latency-cost.ts.
 * Moallemi-style execution-quality cost of trading at a given
 * latency, anchored to (volatility, spread, latency, horizon,
 * optional commission). Operator-facing answer: usually "negligible
 * vs commissions" for retail, validating Gordon's positioning above
 * the latency tier.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { estimateLatencyCost } from "../../../../core/alpha/latency-cost.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const latencyCostDiagnosticTool = createTool({
  id: "estimate_latency_cost",
  description:
    "Quantify execution-quality cost of trading at a given latency. Inputs: annualized volatility, " +
    "bid-ask spread, latency in ms, time horizon in seconds, optional commission per share. Returns " +
    "per-share cost + fraction of spread + fraction of commission + verdict (negligible/marginal/" +
    "material/dominant). Headline: for retail, commissions dwarf latency cost almost always — this " +
    "tool mechanically verifies that for the operator's specific configuration. Distinct from " +
    "venueMevExposure (sniping-tax) and adverseSelectionDetector (per-fill toxic-flow).",
  inputSchema: z.object({
    annualizedVolatility: z
      .number()
      .min(0)
      .describe("Annualized volatility as decimal (e.g. 0.30 = 30%)."),
    bidAskSpread: z
      .number()
      .min(0)
      .describe("Bid-ask spread in price units (e.g. $0.01)."),
    latencyMs: z.number().min(0).describe("Operator's end-to-end latency in milliseconds."),
    timeHorizonSeconds: z
      .number()
      .positive()
      .describe("Trade horizon in seconds (e.g. 10 = 10s execution)."),
    commissionPerShare: z
      .number()
      .min(0)
      .optional()
      .describe("Optional commission per share for comparison verdict."),
    scalingConstant: z
      .number()
      .positive()
      .optional()
      .describe("Model scaling constant. Default 1.0."),
  }),
  outputSchema: z.object({
    latencyCostPerShare: z.number(),
    latencyCostAsFractionOfSpread: z.number(),
    latencyCostAsFractionOfCommission: z.number().nullable(),
    expectedDriftPerLatencyWindow: z.number(),
    verdict: z.enum(["negligible", "marginal", "material", "dominant"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = estimateLatencyCost({
      annualizedVolatility: input.annualizedVolatility,
      bidAskSpread: input.bidAskSpread,
      latencyMs: input.latencyMs,
      timeHorizonSeconds: input.timeHorizonSeconds,
      commissionPerShare: input.commissionPerShare,
      scalingConstant: input.scalingConstant,
    });
    recordStructuredObservation({
      eventType: "latency_cost.estimated",
      workflow: "analysis",
      source: "agent_tool",
      component: "estimate_latency_cost",
      toolName: "estimate_latency_cost",
      outcome: result.verdict === "dominant" ? "failure" : "info",
      details: {
        verdict: result.verdict,
        latencyMs: input.latencyMs,
        latencyCostPerShare: result.latencyCostPerShare,
        spreadFraction: result.latencyCostAsFractionOfSpread,
      },
    });
    return result;
  },
});

export const latencyCostTools = {
  estimate_latency_cost: latencyCostDiagnosticTool,
};
