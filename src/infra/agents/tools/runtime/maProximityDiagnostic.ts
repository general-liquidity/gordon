/**
 * MA-Proximity Surf Classifier Diagnostic — agent-callable wrapper.
 *
 * Wraps `classifyMaProximity` from core/alpha/ma-proximity.ts.
 * Qullamaggie's "surfing the MA" hierarchy: which rising MA price is
 * hugging (within 1×ADR) + tightest stop ≤ 3% rule + R:R tier.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import { classifyMaProximity } from "../../../../core/alpha/ma-proximity.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const maProximityDiagnosticTool = createTool({
  id: "classify_ma_proximity",
  description:
    "Classify the trade-readiness of a setup by checking which rising MA (10/21/50 SMA) price is " +
    "hugging closely enough that a stop placed just below the MA implies risk ≤ 3% of price. " +
    "Returns surfingMa label (10/21/50/extended), stopUnderMaPct, readyForBreakout boolean, and an " +
    "R:R tier (premium/good/acceptable/wide/extended). The 'extended' verdict means MAs haven't " +
    "caught up to price yet — operator should wait.",
  inputSchema: z.object({
    price: z.number().positive().describe("Current price."),
    adr: z.number().positive().describe("Average Daily Range in price units."),
    sma10: z.number().positive().optional().describe("Current 10-period SMA value."),
    sma21: z.number().positive().optional().describe("Current 21-period SMA value."),
    sma50: z.number().positive().optional().describe("Current 50-period SMA value."),
    maxStopPct: z.number().positive().optional().describe("Max stop %% for 'ready'. Default 3.0."),
    stopBufferAbsolute: z.number().min(0).optional().describe("Buffer below MA (price units). Default 0."),
    proximityAdrMultiple: z.number().positive().optional().describe("× ADR proximity band. Default 1.0."),
  }),
  outputSchema: z.object({
    surfingMa: z.enum(["10", "21", "50", "extended"]),
    chosenMa: z.number().nullable(),
    stopUnderMaPct: z.number(),
    extensionPct: z.number().nullable(),
    readyForBreakout: z.boolean(),
    rrTier: z.enum(["premium", "good", "acceptable", "wide", "extended"]),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = classifyMaProximity({
      price: input.price,
      adr: input.adr,
      sma10: input.sma10,
      sma21: input.sma21,
      sma50: input.sma50,
      maxStopPct: input.maxStopPct,
      stopBufferAbsolute: input.stopBufferAbsolute,
      proximityAdrMultiple: input.proximityAdrMultiple,
    });
    recordStructuredObservation({
      eventType: "ma_proximity.classified",
      workflow: "analysis",
      source: "agent_tool",
      component: "classify_ma_proximity",
      toolName: "classify_ma_proximity",
      outcome: result.readyForBreakout ? "info" : "failure",
      details: {
        surfingMa: result.surfingMa,
        stopUnderMaPct: result.stopUnderMaPct,
        rrTier: result.rrTier,
        ready: result.readyForBreakout,
      },
    });
    return {
      surfingMa: result.surfingMa,
      chosenMa: result.chosenMa,
      stopUnderMaPct: Number.isFinite(result.stopUnderMaPct) ? result.stopUnderMaPct : -1,
      extensionPct: result.extensionPct,
      readyForBreakout: result.readyForBreakout,
      rrTier: result.rrTier,
      summary: result.summary,
    };
  },
});

export const maProximityTools = {
  classify_ma_proximity: maProximityDiagnosticTool,
};
