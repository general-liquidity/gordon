/**
 * Market Profile Diagnostic Tool — exposed via /market-profile.
 *
 * Wraps `computeMarketProfile` (TS3) — Steidlmayer's TPO/value-area
 * construction. Distinct from Gordon's volume-profile (which measures
 * volume at price); Market Profile measures time at price.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  computeMarketProfile,
  marketProfileToPayload,
} from "../../../trading/quant/marketProfile.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const marketProfileDiagnosticTool = createTool({
  id: "compute_market_profile",
  description:
    "Compute Steidlmayer Market Profile: time-at-price TPO distribution with point-of-control (POC) and 70% value area. " +
    "Use when the operator asks `/market-profile`, or to identify support/resistance from the prior session's value area. " +
    "Returns POC, value-area high/low, and day-type classification (normal / trending / non-trending).",
  inputSchema: z.object({
    bars: z
      .array(
        z.object({
          high: z.number(),
          low: z.number(),
          timestamp: z.number().int().describe("Unix ms timestamp."),
        }),
      )
      .min(1)
      .describe("Intraday bars sorted by timestamp."),
    tpoBlockMs: z
      .number()
      .int()
      .positive()
      .default(30 * 60 * 1000)
      .describe("TPO block size in ms. Default 30 min."),
    tickSize: z.number().positive().optional().describe("Price bin size. Default auto from range."),
    valueAreaFraction: z
      .number()
      .min(0)
      .max(1)
      .default(0.7)
      .describe("Fraction of total TPOs in the value area. Default 0.7."),
  }),
  outputSchema: z.object({
    pointOfControl: z.number().nullable(),
    valueAreaHigh: z.number().nullable(),
    valueAreaLow: z.number().nullable(),
    totalTpos: z.number(),
    valueAreaTpoCount: z.number(),
    dayType: z.enum(["normal", "trending", "non-trending", "insufficient"]),
    pocSkew: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = computeMarketProfile({
      bars: input.bars,
      tpoBlockMs: input.tpoBlockMs,
      tickSize: input.tickSize,
      valueAreaFraction: input.valueAreaFraction,
    });
    const summary = result.reasoning;
    recordStructuredObservation({
      eventType: "market_profile.requested",
      workflow: "execution",
      source: "agent_tool",
      component: "compute_market_profile",
      toolName: "compute_market_profile",
      outcome: "info",
      details: { ...(marketProfileToPayload(result) as Record<string, unknown>) },
    });
    return {
      pointOfControl: result.pointOfControl,
      valueAreaHigh: result.valueAreaHigh,
      valueAreaLow: result.valueAreaLow,
      totalTpos: result.totalTpos,
      valueAreaTpoCount: result.valueAreaTpoCount,
      dayType: result.dayType,
      pocSkew: Number(result.pocSkew.toFixed(4)),
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const marketProfileTools = { compute_market_profile: marketProfileDiagnosticTool };
