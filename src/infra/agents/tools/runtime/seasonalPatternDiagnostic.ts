/**
 * Seasonal Pattern Diagnostic Tool — exposed via /seasonality.
 *
 * Wraps `computeSeasonalPattern` (TS14) — monthly/weekday return
 * aggregations with 95% confidence intervals.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeSeasonalPattern,
  seasonalReportToPayload,
} from "../../../trading/quant/seasonalPattern.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

const bucketSchema = z.object({
  bucket: z.string(),
  count: z.number(),
  meanReturn: z.number(),
  stdDev: z.number(),
  fractionUp: z.number(),
  confidence95Low: z.number(),
  confidence95High: z.number(),
});

export const seasonalPatternDiagnosticTool = createTool({
  id: "compute_seasonal_pattern",
  description:
    "Aggregate daily returns into monthly and weekday buckets with mean, stdev, fraction-up, and 95% confidence intervals. " +
    "Use when the operator asks `/seasonality`, or when scanning for calendar-bias filters. " +
    "Returns per-month and per-weekday stats plus the strongest-bias bucket (≥5 samples).",
  inputSchema: z.object({
    returns: z
      .array(z.object({ t: z.number().int(), ret: z.number() }))
      .min(1)
      .describe("Daily returns with unix-ms timestamps."),
  }),
  outputSchema: z.object({
    monthly: z.array(bucketSchema),
    weekday: z.array(bucketSchema),
    strongestBias: bucketSchema.nullable(),
    sampleSize: z.number(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeSeasonalPattern(input.returns);
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "seasonal_pattern.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_seasonal_pattern",
      toolName: "compute_seasonal_pattern",
      outcome: "info",
      details: { ...(seasonalReportToPayload(result) as Record<string, unknown>) },
    });
    return {
      monthly: result.monthly,
      weekday: result.weekday,
      strongestBias: result.strongestBias,
      sampleSize: result.sampleSize,
      summary,
    };
  },
});

export const seasonalPatternTools = { compute_seasonal_pattern: seasonalPatternDiagnosticTool };
