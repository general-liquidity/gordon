/**
 * Level Freshness Diagnostic Tool — LV2 wrapper.
 *
 * Agent-callable. Given a price level and recent OHLC history,
 * classifies the level as `fresh` (0–1 touches in recent window) or
 * `recycled` (2+ touches). Use to grade any level produced by
 * Gordon's level-extraction tools (supply-demand-zones, order-blocks,
 * fibonacci, camarilla, smc-patterns) before deciding whether to
 * trade it as momentum/breakout (fresh) or mean-reversion (recycled).
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  evaluateLevelFreshness,
  levelFreshnessToPayload,
} from "../../../trading/quant/levelFreshness.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const levelFreshnessDiagnosticTool = createTool({
  id: "evaluate_level_freshness",
  description:
    "Classify a price level as fresh (0-1 touches in recent window) or recycled (2+ touches). " +
    "Use to grade any S/R level: fresh levels favor momentum/breakout trades; recycled levels favor " +
    "mean-reversion. Defaults: 6-hour window, 0.1% tolerance band, 2+ touches → recycled. " +
    "All thresholds parameterizable for different timeframes / venues.",
  inputSchema: z.object({
    level: z.number().positive().describe("The price level to classify."),
    candles: z
      .array(
        z.object({
          timestamp: z.number().describe("Timestamp in milliseconds (ms epoch)."),
          high: z.number(),
          low: z.number(),
        }),
      )
      .min(1)
      .describe("Recent OHLC history (only high/low + timestamp needed)."),
    windowMinutes: z
      .number()
      .positive()
      .optional()
      .describe("Window length in minutes. Default 360 (6 hours)."),
    touchTolerancePct: z
      .number()
      .positive()
      .optional()
      .describe("Touch tolerance as fraction of level. Default 0.001 (0.1%)."),
    recycledThreshold: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("Touch count at which level is classified as recycled. Default 2."),
    windowEndMs: z
      .number()
      .optional()
      .describe("End-of-window timestamp (ms). Default = latest candle timestamp."),
  }),
  outputSchema: z.object({
    classification: z.enum(["fresh", "recycled"]),
    touchCount: z.number(),
    windowStartMs: z.number(),
    windowEndMs: z.number(),
    toleranceBand: z.object({
      lower: z.number(),
      upper: z.number(),
    }),
    touchTimestamps: z.array(z.number()),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = evaluateLevelFreshness({
      level: input.level,
      candles: input.candles,
      windowMinutes: input.windowMinutes,
      touchTolerancePct: input.touchTolerancePct,
      recycledThreshold: input.recycledThreshold,
      windowEndMs: input.windowEndMs,
    });
    recordStructuredObservation({
      eventType: "level_freshness.evaluated",
      workflow: "setup_filter",
      source: "agent_tool",
      component: "evaluate_level_freshness",
      toolName: "evaluate_level_freshness",
      outcome: "info",
      details: { ...(levelFreshnessToPayload(result) as Record<string, unknown>) },
    });
    return {
      classification: result.classification,
      touchCount: result.touchCount,
      windowStartMs: result.windowStartMs,
      windowEndMs: result.windowEndMs,
      toleranceBand: {
        lower: Number(result.toleranceBand.lower.toFixed(8)),
        upper: Number(result.toleranceBand.upper.toFixed(8)),
      },
      touchTimestamps: result.touchTimestamps,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const levelFreshnessTools = {
  evaluate_level_freshness: levelFreshnessDiagnosticTool,
};
