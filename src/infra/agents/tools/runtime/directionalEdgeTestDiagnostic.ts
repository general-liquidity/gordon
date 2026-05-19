/**
 * Directional-Edge Test Diagnostic Tool — agent-internal, no slash command.
 *
 * Wraps `runDirectionalEdgeTest` so the researcher/executor agents can
 * sanity-check whether a strategy's reported Sharpe comes from genuine
 * directional information or from random sign luck. Complementary to
 * `compute_stationary_bootstrap` (parameter fragility) — together they
 * cover the two main "is this overfit?" questions.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  runDirectionalEdgeTest,
  directionalEdgeTestToPayload,
} from "../../../trading/quant/directionalEdgeTest.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const directionalEdgeTestDiagnosticTool = createTool({
  id: "compute_directional_edge_test",
  description:
    "Sign-randomization validation for a strategy return series. " +
    "Tests whether |Sharpe| sits above what random sign-flips would produce. " +
    "Verdicts: real_edge (p ≥ 0.95) / marginal_edge (p ≥ 0.80) / noise (below). " +
    "Use during backtest analysis or research-loop critique to catch directional overfitting.",
  inputSchema: z.object({
    returns: z
      .array(z.number())
      .min(30)
      .describe("Per-period strategy returns as decimals (e.g. 0.012 = +1.2%)."),
    samples: z.number().int().positive().default(500).describe("Sign-randomization samples. Default 500."),
    periodsPerYear: z.number().positive().default(252).describe("Periods per year. Default 252."),
    seed: z.number().int().optional().describe("Optional deterministic seed."),
  }),
  outputSchema: z.object({
    verdict: z.enum(["real_edge", "marginal_edge", "noise"]),
    realizedSharpe: z.number(),
    edgePercentile: z.number(),
    nullMedianAbsSharpe: z.number(),
    nullCi05: z.number(),
    nullCi95: z.number(),
    samples: z.number(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = runDirectionalEdgeTest({
      returns: input.returns,
      samples: input.samples,
      periodsPerYear: input.periodsPerYear,
      seed: input.seed,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "directional_edge_test.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_directional_edge_test",
      toolName: "compute_directional_edge_test",
      outcome: result.verdict === "noise" ? "failure" : "info",
      details: { ...(directionalEdgeTestToPayload(result) as Record<string, unknown>) },
    });
    return {
      verdict: result.verdict,
      realizedSharpe: Number(result.realizedSharpe.toFixed(4)),
      edgePercentile: Number(result.edgePercentile.toFixed(4)),
      nullMedianAbsSharpe: Number(result.nullMedianAbsSharpe.toFixed(4)),
      nullCi05: Number(result.nullCi05.toFixed(4)),
      nullCi95: Number(result.nullCi95.toFixed(4)),
      samples: result.samples,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const directionalEdgeTestTools = {
  compute_directional_edge_test: directionalEdgeTestDiagnosticTool,
};
