/**
 * Stationary Bootstrap Diagnostic Tool — exposed via /bootstrap.
 *
 * Wraps `runStationaryBootstrap` to surface a strategy's fragility via
 * block-resampled return distributions.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  runStationaryBootstrap,
  bootstrapToPayload,
} from "../../../trading/quant/stationaryBootstrap.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const bootstrapDiagnosticTool = createTool({
  id: "compute_stationary_bootstrap",
  description:
    "Run a stationary block-bootstrap fragility test on a return series. " +
    "Use when the operator asks `/bootstrap`, or when a strategy's reported Sharpe needs a robustness check. " +
    "Returns Sharpe/mean/max-drawdown confidence bands plus a fragility verdict (robust / borderline / fragile).",
  inputSchema: z.object({
    returns: z
      .array(z.number())
      .min(30)
      .describe("Per-period strategy returns as decimals (e.g. 0.012 = +1.2%)."),
    resamples: z.number().int().positive().default(500).describe("Bootstrap resamples. Default 500."),
    blockResetProbability: z
      .number()
      .min(0)
      .max(1)
      .default(0.1)
      .describe("Block reset probability (mean block ~1/p). Default 0.1."),
    periodsPerYear: z.number().positive().default(252).describe("Periods per year. Default 252."),
    seed: z.number().int().optional().describe("Optional deterministic seed."),
  }),
  outputSchema: z.object({
    verdict: z.enum(["robust", "borderline", "fragile"]),
    realizedSharpe: z.number(),
    sharpePercentile: z.number(),
    sharpeBand: z.object({
      median: z.number(),
      ci05: z.number(),
      ci25: z.number(),
      ci75: z.number(),
      ci95: z.number(),
    }),
    resamples: z.number(),
    sampleSize: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = runStationaryBootstrap({
      returns: input.returns,
      resamples: input.resamples,
      blockResetProbability: input.blockResetProbability,
      periodsPerYear: input.periodsPerYear,
      seed: input.seed,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "stationary_bootstrap.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_stationary_bootstrap",
      toolName: "compute_stationary_bootstrap",
      outcome: result.verdict === "fragile" ? "failure" : "info",
      details: { ...(bootstrapToPayload(result) as Record<string, unknown>) },
    });
    return {
      verdict: result.verdict,
      realizedSharpe: Number(result.realizedSharpe.toFixed(4)),
      sharpePercentile: Number(result.sharpePercentile.toFixed(4)),
      sharpeBand: {
        median: Number(result.sharpeBand.median.toFixed(4)),
        ci05: Number(result.sharpeBand.ci05.toFixed(4)),
        ci25: Number(result.sharpeBand.ci25.toFixed(4)),
        ci75: Number(result.sharpeBand.ci75.toFixed(4)),
        ci95: Number(result.sharpeBand.ci95.toFixed(4)),
      },
      resamples: result.resamples,
      sampleSize: result.sampleSize,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const bootstrapTools = { compute_stationary_bootstrap: bootstrapDiagnosticTool };
