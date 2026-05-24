/**
 * Fill-Quality Probe Diagnostic Tool — agent-callable wrapper.
 *
 * Wraps `analyzeFillQualityProbe` from core/alpha/fill-quality-probe.ts.
 * Interprets the quality of a probe order (completeness / slippage /
 * latency) as a supply-demand barometer: poor fills = institutions
 * hoarding; clean fills = supply available.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { analyzeFillQualityProbe } from "../../../../core/alpha/fill-quality-probe.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const fillQualityProbeDiagnosticTool = createTool({
  id: "analyze_fill_quality_probe",
  description:
    "Interpret a probe order's fill quality as a supply/demand barometer. Operator submits a small " +
    "probe order; this tool scores 3 axes (completeness / slippage / latency) and returns a verdict: " +
    "aggressive_demand (institutions hoarding) / easy_fill (supply available) / neutral_fill / " +
    "insufficient_data. Distinct from dark-pool-adverse-selection (venue post-fill) and " +
    "implementation-shortfall (4-bucket cost TCA). Use to confirm an institutional bid before sizing up.",
  inputSchema: z.object({
    side: z.enum(["BUY", "SELL"]),
    intendedQty: z.number().positive(),
    filledQty: z.number().min(0),
    submitMidPrice: z.number().positive(),
    avgFillPrice: z.number().positive(),
    expectedSlippageBps: z.number().min(0),
    latencyMs: z.number().min(0),
    latencyBudgetMs: z.number().positive(),
    poorFillRatioThreshold: z.number().min(0).max(1).optional(),
    poorSlippageMultiple: z.number().min(0).optional(),
    poorLatencyMultiple: z.number().min(0).optional(),
    cleanFillRatioThreshold: z.number().min(0).max(1).optional(),
    cleanSlippageMultiple: z.number().min(0).optional(),
    cleanLatencyMultiple: z.number().min(0).optional(),
  }),
  outputSchema: z.object({
    side: z.enum(["BUY", "SELL"]),
    fillRatio: z.number(),
    realizedSlippageBps: z.number(),
    slippageExcessBps: z.number(),
    latencyRatio: z.number(),
    axes: z.array(
      z.object({
        axis: z.enum(["completeness", "slippage", "latency"]),
        observed: z.number(),
        classification: z.enum(["poor", "neutral", "clean"]),
        description: z.string(),
      }),
    ),
    poorAxesCount: z.number(),
    cleanAxesCount: z.number(),
    verdict: z.enum(["aggressive_demand", "neutral_fill", "easy_fill", "insufficient_data"]),
    demandScore: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = analyzeFillQualityProbe(
      {
        side: input.side,
        intendedQty: input.intendedQty,
        filledQty: input.filledQty,
        submitMidPrice: input.submitMidPrice,
        avgFillPrice: input.avgFillPrice,
        expectedSlippageBps: input.expectedSlippageBps,
        latencyMs: input.latencyMs,
        latencyBudgetMs: input.latencyBudgetMs,
      },
      {
        poorFillRatioThreshold: input.poorFillRatioThreshold,
        poorSlippageMultiple: input.poorSlippageMultiple,
        poorLatencyMultiple: input.poorLatencyMultiple,
        cleanFillRatioThreshold: input.cleanFillRatioThreshold,
        cleanSlippageMultiple: input.cleanSlippageMultiple,
        cleanLatencyMultiple: input.cleanLatencyMultiple,
      },
    );
    recordStructuredObservation({
      eventType: "fill_quality_probe.analyzed",
      workflow: "analysis",
      source: "agent_tool",
      component: "analyze_fill_quality_probe",
      toolName: "analyze_fill_quality_probe",
      outcome: result.verdict === "aggressive_demand" ? "info" : "info",
      details: {
        verdict: result.verdict,
        demandScore: result.demandScore,
        poorAxes: result.poorAxesCount,
        cleanAxes: result.cleanAxesCount,
      },
    });
    return result;
  },
});

export const fillQualityProbeTools = {
  analyze_fill_quality_probe: fillQualityProbeDiagnosticTool,
};
