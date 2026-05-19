/**
 * PCA Concentration Diagnostic Tool — exposed via /pca-concentration.
 *
 * Wraps `computePcaConcentration` so the operator can run the
 * hidden-factor check against a set of strategy return series. The
 * complement to /effective-n: effectiveN counts independent signals;
 * pca-concentration measures whether one PC absorbs most variance.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computePcaConcentration,
  pcaConcentrationToPayload,
} from "../../../trading/quant/pcaConcentration.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const pcaConcentrationDiagnosticTool = createTool({
  id: "compute_pca_concentration",
  description:
    "Run PCA on strategy return series to detect hidden-factor concentration. " +
    "Use when the operator asks `/pca-concentration`, or when accepting/rejecting a strategy into the live book. " +
    "Returns verdict (diverse | concentrated | critical), PC1 explained-variance ratio, top-loading strategies, and high-correlation pairs.",
  inputSchema: z.object({
    series: z
      .array(
        z.object({
          strategyId: z.string(),
          returns: z.array(z.number()).min(2),
        }),
      )
      .min(2)
      .describe("Aligned per-period return series for each strategy."),
    concentratedThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.5)
      .describe("PC1 explained-variance threshold for the concentrated verdict. Default 0.5."),
    criticalThreshold: z
      .number()
      .min(0)
      .max(1)
      .default(0.75)
      .describe("PC1 explained-variance threshold for the critical verdict. Default 0.75."),
    cumulativeTarget: z
      .number()
      .min(0)
      .max(1)
      .default(0.9)
      .describe("Cumulative variance fraction used for the `nForCumulativeTarget` report. Default 0.9."),
    topK: z
      .number()
      .int()
      .positive()
      .default(5)
      .describe("Number of top-loading strategies to return for PC1. Default 5."),
  }),
  outputSchema: z.object({
    verdict: z.enum(["diverse", "concentrated", "critical"]),
    rawN: z.number(),
    pc1ExplainedRatio: z.number(),
    nForCumulativeTarget: z.number(),
    pc1TopLoadings: z.array(z.object({ strategyId: z.string(), loading: z.number() })),
    highCorrelationPairs: z.array(
      z.object({ a: z.string(), b: z.string(), correlation: z.number() }),
    ),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computePcaConcentration({
      series: input.series,
      concentratedThreshold: input.concentratedThreshold,
      criticalThreshold: input.criticalThreshold,
      cumulativeTarget: input.cumulativeTarget,
      topK: input.topK,
    });

    const summary =
      `PCA verdict: ${result.verdict} — PC1 explains ${(result.pc1ExplainedRatio * 100).toFixed(1)}% of variance ` +
      `across ${result.rawN} strategies (need ${result.nForCumulativeTarget} PCs for ${(input.cumulativeTarget * 100).toFixed(0)}%). ` +
      result.reasoning;

    recordStructuredObservation({
      eventType: "pca_concentration.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_pca_concentration",
      toolName: "compute_pca_concentration",
      outcome: result.verdict === "critical" ? "failure" : result.verdict === "concentrated" ? "info" : "success",
      details: { ...(pcaConcentrationToPayload(result) as Record<string, unknown>) },
    });

    return {
      verdict: result.verdict,
      rawN: result.rawN,
      pc1ExplainedRatio: Number(result.pc1ExplainedRatio.toFixed(4)),
      nForCumulativeTarget: result.nForCumulativeTarget,
      pc1TopLoadings: result.pc1TopLoadings.map((l) => ({
        strategyId: l.strategyId,
        loading: Number(l.loading.toFixed(4)),
      })),
      highCorrelationPairs: result.highCorrelationPairs.slice(0, 20).map((p) => ({
        a: p.a,
        b: p.b,
        correlation: Number(p.correlation.toFixed(4)),
      })),
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const pcaConcentrationTools = {
  compute_pca_concentration: pcaConcentrationDiagnosticTool,
};
