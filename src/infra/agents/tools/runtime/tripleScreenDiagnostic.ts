/**
 * Elder Triple Screen Diagnostic Tool — exposed via /triple-screen.
 *
 * Wraps `evaluateTripleScreen` (TS4) — composition gate for
 * multi-timeframe entries. Caller passes the per-frame verdicts; the
 * tool returns the entry decision.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  evaluateTripleScreen,
  tripleScreenToPayload,
} from "../../../trading/quant/tripleScreen.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const tripleScreenDiagnosticTool = createTool({
  id: "evaluate_triple_screen",
  description:
    "Elder's Triple Screen: gate an entry on the combination of a long-frame trend, a middle-frame oscillator state, and a short-frame trigger. " +
    "Use when the operator asks `/triple-screen`, or when composing multi-timeframe filters before sizing a trade. " +
    "Returns long_entry / short_entry / wait / no_trade with the blocking screen identified.",
  inputSchema: z.object({
    majorTrend: z
      .enum(["up", "down", "flat"])
      .describe("Long-frame trend direction (e.g. weekly MACD slope)."),
    oscillator: z
      .enum(["overbought", "oversold", "neutral"])
      .describe("Mid-frame oscillator state (Elder-Ray, Force Index, stochastic)."),
    entryTrigger: z
      .enum(["buy", "sell", "none"])
      .describe("Short-frame entry trigger (intraday breakout, etc.)."),
  }),
  outputSchema: z.object({
    verdict: z.enum(["long_entry", "short_entry", "wait", "no_trade"]),
    blockedBy: z.enum(["trend", "oscillator", "trigger"]).nullable(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = evaluateTripleScreen({
      majorTrend: input.majorTrend,
      oscillator: input.oscillator,
      entryTrigger: input.entryTrigger,
    });
    const summary = `${result.verdict}: ${result.reasoning}`;
    recordStructuredObservation({
      eventType: "triple_screen.evaluated",
      workflow: "execution",
      source: "agent_tool",
      component: "evaluate_triple_screen",
      toolName: "evaluate_triple_screen",
      outcome: result.verdict.endsWith("_entry") ? "success" : "info",
      details: { ...(tripleScreenToPayload(result) as Record<string, unknown>) },
    });
    return {
      verdict: result.verdict,
      blockedBy: result.blockedBy,
      reasoning: result.reasoning,
      summary,
    };
  },
});

export const tripleScreenTools = { evaluate_triple_screen: tripleScreenDiagnosticTool };
