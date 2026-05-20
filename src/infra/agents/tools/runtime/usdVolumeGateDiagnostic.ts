/**
 * USD Volume Gate Diagnostic Tool — LV1 wrapper.
 *
 * Agent-callable. Filters symbols by rolling USD volume rather than
 * raw contract count. Use as a pre-scan / pre-plan gate to reject
 * illiquid symbols before any setup analysis or sizing runs.
 */

import { createTool } from "@mastra/core/tools";
import { z } from "zod";

import {
  evaluateUsdVolumeGate,
  usdVolumeGateToPayload,
} from "../../../trading/quant/usdVolumeGate.ts";
import { recordStructuredObservation } from "../../../platform/observability/structured.ts";

export const usdVolumeGateDiagnosticTool = createTool({
  id: "evaluate_usd_volume_gate",
  description:
    "Filter a symbol by USD-denominated rolling volume rather than raw contract count. Returns " +
    "tradeable/skip based on whether the rolling MA of (close × volume) exceeds a USD threshold. " +
    "Default 60-period MA, $100K threshold (ZCT convention for Binance 1-minute crypto perps). " +
    "Use as a pre-scan gate — illiquid symbols drain edge through slippage no matter how perfect the setup.",
  inputSchema: z.object({
    candles: z
      .array(
        z.object({
          close: z.number().positive(),
          volume: z.number().min(0),
        }),
      )
      .min(1)
      .describe("Recent candles with close + volume (volume in contract / base-asset units, NOT USD)."),
    maPeriod: z
      .number()
      .int()
      .min(1)
      .optional()
      .describe("MA window. Default 60."),
    thresholdUSD: z
      .number()
      .positive()
      .optional()
      .describe("USD liquidity threshold. Default 100000 ($100K). Tune per venue/timeframe."),
  }),
  outputSchema: z.object({
    rollingAvgVolUSD: z.number(),
    latestVolUSD: z.number(),
    thresholdUSD: z.number(),
    tradeable: z.boolean(),
    verdict: z.enum(["tradeable", "skip"]),
    effectiveMaPeriod: z.number(),
    candleCount: z.number(),
    reasoning: z.string(),
    summary: z.string(),
  }),
  execute: async (input) => {
    const result = evaluateUsdVolumeGate({
      candles: input.candles,
      maPeriod: input.maPeriod,
      thresholdUSD: input.thresholdUSD,
    });
    recordStructuredObservation({
      eventType: "usd_volume_gate.evaluated",
      workflow: "universe_filter",
      source: "agent_tool",
      component: "evaluate_usd_volume_gate",
      toolName: "evaluate_usd_volume_gate",
      outcome: "info",
      details: { ...(usdVolumeGateToPayload(result) as Record<string, unknown>) },
    });
    return {
      rollingAvgVolUSD: Number(result.rollingAvgVolUSD.toFixed(2)),
      latestVolUSD: Number(result.latestVolUSD.toFixed(2)),
      thresholdUSD: result.thresholdUSD,
      tradeable: result.tradeable,
      verdict: result.verdict,
      effectiveMaPeriod: result.effectiveMaPeriod,
      candleCount: result.candleCount,
      reasoning: result.reasoning,
      summary: result.reasoning,
    };
  },
});

export const usdVolumeGateTools = {
  evaluate_usd_volume_gate: usdVolumeGateDiagnosticTool,
};
